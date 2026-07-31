# 平台角色与最小权限管理 V1：切片 2 独立 QA 报告

日期：2026-07-30
结论：通过；认证角色刷新、初始管理员 CLI 与 Schema 6 启动保护符合冻结契约，建议转产品经理验收。真实 006 Migration、服务重启与切片 3–5 仍禁止。

## 测试范围

- `AuthUser.roles`、`AuthCredentialRecord`、认证 Application 与 MySQL Auth Repository。
- 初始管理员 Application、Repository 原语和受控 CLI。
- API 主入口及 CLI 的 Schema 6 启动/写入保护。
- 既有 owner 隔离、认证 HTTP、H5 登录门与完整 MySQL 回归。
- 两个运行库只读深度快照、临时数据库/账号清理和敏感字段边界。

未执行真实 006、运行库 DDL/DML、服务重启、注册、claim、Backup 恢复或切片 3–5 工作。

## 环境与版本

- 工作目录：`C:\Users\Administrator\Desktop\mikey\Knowledge_Base`。
- MySQL 测试显式加载 `.env`，仅由测试创建随机独立数据库、app/migrator 账号和随机密码。
- 临时 migrator 仅在临时库执行 001–006；完整 MySQL 套件严格串行。
- 日常与 UAT 运行库在测试前后均保持 15 个 base table、schemaVersion 5，平台表不存在。

## 通过场景

- 注册固定返回 `roles:['member']`；登录及每次旧 Cookie 会话读取均从 `user_roles` 取得最新角色，授予/撤销后下一请求立即生效。
- 角色固定按 `member`、`platform_admin` 排序；缺 member、仅 platform_admin、未知角色或缺表均失败关闭。
- `AuthCredentialRecord` 为 `{ user, passwordHash }`；Application 仅把 `record.user` 放入 AuthSession，HTTP 响应不含密码、哈希、token、会话秘密或摘要。
- `CurrentUserScope` 仍仅含 userId；platform_admin 访问其他用户资源继续返回既有 404，未绕过 owner 隔离。
- CLI 参数在环境读取和数据库连接前校验；缺失、重复、未知、位置参数、错误数据库、Schema 5、缺表、用户不存在及缺 member 均稳定拒绝并零写入。
- CLI 首次初始化只写入一个 platform_admin 和一条 `platform_admin_granted` 审计，`granted_by_user_id`、`actor_user_id` 均为 NULL；同目标重复执行只读返回 `already-initialized`。
- 不同目标并发仅一次成功；同目标并发为一次 `granted`、一次 `already-initialized`。
- beforeCommit 失败整体回滚；afterCommit 失败不重试，可通过 operationId 和角色重读确认唯一已提交事实。
- API 主入口在 Schema 5 时不创建服务器或监听；Schema 6 且平台表可读时才进入监听步骤。直接构造服务器的 Schema 5 `/health` 为脱敏 503。
- H5 仅适配新增 roles 字段，未出现管理员入口或既有登录门行为变化。
- 文件范围符合冻结授权；未修改 006、`apps/api/src/index.ts`、`apps/client/src/**`、业务 Repository、Backup、根 package、Docker、脚本或配置。

## 实际命令与结果

1. 切片 2 定向测试：

   `corepack pnpm vitest run --no-file-parallelism tests/api-auth.integration.test.ts tests/api-owner-isolation.integration.test.ts tests/mysql-platform-administration-repository.integration.test.ts tests/authentication-role-application.test.ts tests/initial-platform-admin-cli.integration.test.ts tests/api-schema6-startup.integration.test.ts`

   结果：6 文件 / 19 项通过。

2. CLI 独立定向复跑：

   `corepack pnpm vitest run --no-file-parallelism tests/initial-platform-admin-cli.integration.test.ts`

   结果：1 文件 / 3 项通过。

3. 完整 MySQL 回归：

   `corepack pnpm test:mysql:integration`

   结果：13 文件 / 135 项通过。

4. 既有 H5 认证测试：

   `corepack pnpm vitest run --no-file-parallelism tests/authentication-h5-gate.test.ts tests/authentication-h5-flow.test.ts`

   结果：2 文件 / 18 项通过。

5. `corepack pnpm typecheck`：通过。

6. `corepack pnpm --filter @knowledge-base/client build:h5`：通过，仅有既有 Sass legacy API 弃用警告。

7. `git diff --check`：通过，仅有既有 LF/CRLF 提示。

## 零污染证据

- `knowledge_base` PRE/POST：`efdd20e2630c655ebf877aca937f9ee85af9adbc597297834fdbfcef050500b2`。
- `knowledge_base_uat` PRE/POST：`2e19b990cbb6e38bfeaca7bde239ff4c350c8772a553fbf461c543083934c39f`。
- 两库均保持 15 个 base table、schemaVersion 5、平台表数量 0；结论为 `SNAPSHOTS_IDENTICAL`。
- 测试前与最终所有额外 `kb_*` 临时数据库均为 0，所有 `kb_*` 临时账号均为 0。

## 失败场景

无。

## 问题清单

本轮未发现 P0–P3 缺陷。

## 回归风险

- 当前两个运行库仍为 Schema 5，新源码认证与 API 主入口依赖 Schema 6；真实 006 获得独立运行授权前严禁重启、部署或替换当前 API。
- 切片 2 没有管理 HTTP API、H5 管理入口或认证角色授权判断；这些能力不得由本结论推断为已实现。
- 本轮只在随机临时库验证 CLI，不构成对任何真实账户授予管理员或运行库接入授权。

## QA 裁决

- 是否建议切片 2 产品验收：通过。
- 下一责任岗：产品经理执行切片 2 最终验收。
- QA 通过不等于真实 006、服务重启或切片 3 授权；切片 3–5 继续禁止。
