# 平台角色与最小权限管理 V1：切片 1 独立 QA 报告

日期：2026-07-30
结论：通过；`last-platform-admin` 最小契约修复已独立复测通过，建议转产品经理验收，切片 2–5 与真实 006 Migration 仍禁止。

## 测试范围

- `migrations/006_add_platform_roles_and_security_audit.sql`
- `packages/contracts/src/index.ts`
- `packages/storage-mysql/src/account-repository.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `packages/storage-mysql/src/index.ts`
- 两个指定 MySQL 随机临时库集成测试
- 既有完整 MySQL 回归、typecheck、`git diff --check` 与运行库零污染检查

未执行真实 006、运行库 DDL/DML、Migration、注册、claim、Backup 恢复或 API/H5 写入。

## 通过项

- 仓库仅存在一个 `006_add_platform_roles_and_security_audit.sql`。
- `user_roles`、`security_audit_events` 的列序、类型、索引、CHECK、唯一约束及 RESTRICT 外键与冻结记录一致。
- 既有用户仅回填 `member`，没有自动创建 `platform_admin`。
- 固定 role/action code 与 Contracts 一致；`AuthUser`、`AuthSession`、`CurrentUserScope` 未修改。
- 新用户与 `member` 同事务写入，member 失败时用户回滚。
- 用户列表固定 20 条、literal substring 搜索、稳定排序、固定角色顺序和脱敏字段通过。
- 非管理员、目标不存在、自操作、operationId 冲突、重复角色操作均在写入前拒绝或返回零写入结果。
- 管理写入按管理员索引范围、actor/target userId、operationId 的顺序锁定；并发互撤后仍保留一个管理员。
- 角色/会话变更与审计同事务；审计失败和 beforeCommit 失败整体回滚。
- afterCommit 失败不重试，显式 operationId 查询能读取已提交脱敏审计。
- 已过期未撤销会话参与全部撤销，零会话仍写入审计。

## 实际命令与结果

1. 定向测试：

   `corepack pnpm vitest run --no-file-parallelism tests/mysql-platform-security-schema.integration.test.ts tests/mysql-platform-administration-repository.integration.test.ts`

   结果：2 文件 / 8 项通过。

2. 完整 MySQL：

   `corepack pnpm test:mysql:integration`

   串行结果：13 文件 / 135 项通过。

   QA 首轮曾将定向套件和完整套件并行启动，两个进程争用全局 `knowledge_base_schema_migration` GET_LOCK，导致 M1 两项固定 5 秒超时；其余 12 文件 / 133 项通过。按原命令串行复跑后全部通过，该编排冲突不计为产品缺陷。

3. `corepack pnpm typecheck`：通过。

4. `git diff --check`：通过，仅有既有 LF/CRLF 提示。

## 零污染证据

- `knowledge_base`：
  - PRE/POST：`5a2ad2989d1046d4d7bd093ae9aa5eee3dfe63ff40c2c9b2936c4c75e6542090`
  - 15 个 base table，schemaVersion 5，平台两表 0。
- `knowledge_base_uat`：
  - PRE/POST：`719ca5726ea0dd4860d7ace108e3c1eae7cebb4fb21a1172b5561727095f0ae1`
  - 15 个 base table，schemaVersion 5，平台两表 0。
- 最终 `kb_platform_*` 临时数据库：0。
- 最终 `kb_platform_*` 临时账号：0。

本报告摘要由 QA 的固定只读结构/全量记录算法独立生成，因此不沿用交接材料中的其他摘要值；同一算法的 PRE/POST 精确一致。

## 历史问题清单（已关闭）

### P2：冻结的 `last-platform-admin` Repository 错误码不可达（已关闭）

复现：

1. 仅存在一个管理员时调用 `revokePlatformAdmin`。
2. 由于 actor 必须是管理员，actor 与唯一管理员 target 必然是同一用户。
3. `lockContext` 在返回管理员集合前先执行自操作检查并抛出 `self-role-change`；后续 `adminUserIds.size === 1` 判断无法执行。
4. 两个管理员并发互撤时，一个请求成功后，另一个请求重新获得管理员范围锁；其 actor 已被撤销，因此返回 `actor-not-platform-admin`，同样不会返回 `last-platform-admin`。

实际结果：

- 最后管理员不会被删除，安全不变量得到保护。
- Contracts 暴露并冻结了 `last-platform-admin`，Repository 也保留该分支，但当前公开输入、actor 规则及校验顺序下没有请求能观察到该错误码。
- 并发测试只断言一成功、一失败和最终剩一名管理员，没有断言失败 code，因此未发现此契约缺口。

期望结果：

- 产品先明确以下二者之一：
  - `last-platform-admin` 仅表示安全不变量，不作为可观察错误；相应修订冻结 Contracts、Repository 分支与测试。
  - `last-platform-admin` 必须是稳定可观察错误；则须重新定义与“管理员不可自操作”兼容的 actor/target 或错误优先级，并增加直接及并发错误码断言。

关闭依据：产品已选择第一种语义并同步冻结记录；公开 Contracts 已移除该错误码，Repository 已删除不可达分支。单管理员自撤精确返回 `self-role-change` 且角色不变；双管理员并发互撤精确为一次 `revoked`、一次 `actor-not-platform-admin`，最终至少保留一名管理员且仅产生一条成功撤销审计。

## 最小修复独立复测（2026-07-30）

- 静态核对：Contracts、Repository 与直接测试中 `last-platform-admin` 零命中；管理员集合范围锁、固定用户锁序、事务审计、operationId、回滚及 unknown-outcome 路径保持不变。
- Repository 定向测试：`corepack pnpm vitest run --no-file-parallelism tests/mysql-platform-administration-repository.integration.test.ts`，1 文件 / 6 项通过。
- 切片 1 定向测试：`corepack pnpm vitest run --no-file-parallelism tests/mysql-platform-security-schema.integration.test.ts tests/mysql-platform-administration-repository.integration.test.ts`，2 文件 / 8 项通过。
- 完整 MySQL 回归：`corepack pnpm test:mysql:integration`，13 文件 / 135 项通过。
- `corepack pnpm typecheck`：通过。
- `git diff --check`：通过，仅输出既有 LF/CRLF 提示。
- `knowledge_base` 只读深度摘要 PRE/POST 均为 `efdd20e2630c655ebf877aca937f9ee85af9adbc597297834fdbfcef050500b2`。
- `knowledge_base_uat` 只读深度摘要 PRE/POST 均为 `2e19b990cbb6e38bfeaca7bde239ff4c350c8772a553fbf461c543083934c39f`。
- 两库均为 15 个 base table、schemaVersion 5，`user_roles` 与 `security_audit_events` 均不存在于运行库，按平台集合计数为 0；本轮未执行真实 006。
- 最终 `kb_platform_*` 临时数据库 0、临时账号 0；结论为 `SNAPSHOTS_IDENTICAL`。
- 本轮新增缺陷：无（P0–P3 均无）。

## 回归风险

- 当前两个运行库仍为 Schema 5，而 `MySqlAuthRepository.createUser` 已依赖 006 的 `user_roles`。在真实 006 获授权部署前，不得用当前源码重启/部署注册链路，否则新注册会因缺表失败；本切片测试通过不等于当前运行库已兼容新 Repository。
- 当前没有 Application、API、H5 或认证角色刷新，尚不能验证未来 HTTP 403 映射和真实会话角色生效。
- 切片 2–5 与真实 006 Migration 继续禁止。

## QA 裁决

- 是否建议切片 1 产品验收：通过。
- 下一责任岗：产品经理执行切片 1 最终验收。
- QA 通过不等于产品验收或真实 006 部署授权；当前仍不得授权切片 2–5。
