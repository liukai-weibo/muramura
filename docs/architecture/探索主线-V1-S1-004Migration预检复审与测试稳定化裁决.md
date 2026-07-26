# 探索主线 V1 S1：004 Migration 预检复审与测试稳定化裁决

> 日期：2026-07-24
>
> 结论：**004 DDL 前预检实现通过架构复审；P2 MySQL 全量并发稳定性必须先作最小测试调度补正。补正复验通过后，书面授权新增 `004_add_exploration_tracks.sql`；在此之前仍不得创建、执行或提交 004 SQL 或基础 Contracts。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-004Migration预检授权裁决.md`、`packages/storage-mysql/src/index.ts`、`tests/mysql-s1-exploration-tracks.integration.test.ts`。

## 【复审结论】

预检实现符合上一轮冻结要求：

```text
同一 migration advisory-lock connection
→ 004 尚未执行
→ 以 table_schema = DATABASE() 查询 information_schema
→ 表 / 列 / 三个冻结索引 / 外键必须全部不存在
→ 任一冲突在执行任一 004 statement 前抛出“004 migration 预检失败”
→ 不写 schema_migrations 004
```

QA 的 6/6 随机临时库证据、001–003 保持、无额外目标对象、app DDL 被拒绝，以及未触及 `knowledge_base` / `knowledge_base_uat`，足以确认预检语义与最小权限边界。预检补正本身**通过**。

但全量 `pnpm test` 的 278/280 不可作为稳定绿灯：`mysql-m3a` 与 S1 列冲突场景各发生一次 Vitest 默认 5 秒超时。它们不是断言语义失败，也不足以否定定向预检证据；但目前不能用“定向通过”掩盖真实的共享 MySQL 测试资源竞争。

该问题分级为 **P2：MySQL 集成测试调度稳定性**。其根因推定为多个集成测试文件默认 file-parallelism 下同时创建随机 database、账户、执行 migration DDL / advisory lock，争用单一本地 MySQL 容器资源；尚未有证据表明 004 预检、003 预检或业务实现存在数据正确性缺陷。

## 【本次最小授权：仅测试调度补正】

允许修改范围仅为：

```text
vitest.config.ts
package.json（仅测试 script 的显式调度入口；若可只改 vitest.config.ts 则不得改 package.json）
tests/mysql-s1-exploration-tracks.integration.test.ts（仅为消除测试文件自身不必要的并发 / 资源泄漏；不得改业务断言）
tests/mysql-m3a.integration.test.ts（仅为消除测试文件自身不必要的并发 / 资源泄漏；不得改业务断言）
docs/daily-contributions/YYYY-MM-DD.md（实际完成验证后追加）
```

优先方案：**对真实 MySQL 集成测试建立显式串行文件调度入口**，而非提高全局测试超时、删减预检场景、降低断言或将 004 测试标记为跳过。可采用 Vitest 已有的 `--no-file-parallelism` 方式，作为独立 MySQL integration suite / script；普通单元测试维持既有并行度。

不允许：

```text
增加全局 timeout 以掩盖资源争用
删除或合并 003 / 004 任一预检失败场景
弱化 schema_migrations、DDL 前失败、DDL-only / DML-only 断言
修改 runMySqlMigrations()、migrations/** 或任何生产业务代码
修改 Contracts、Repository、Application、API、H5、Backup
触及 knowledge_base 或 knowledge_base_uat
```

## 【测试稳定化验收门】

补正后必须同时证明：

1. 常规全量 `corepack pnpm test` 在加载 MySQL 集成环境时稳定通过，不再出现上述 MySQL 文件默认 5 秒超时；若本项目约定全量测试在无 `.env` 下执行，则必须新增并执行明确的 MySQL 串行集成 suite，不能把无 `.env` 跳过作为稳定性证据。
2. MySQL 串行集成 suite 至少包含现有 M1–M5、`mysql-m3a.integration.test.ts` 与 `mysql-s1-exploration-tracks.integration.test.ts`；使用 `--no-file-parallelism`，不增加 timeout、不减少测试数。
3. S1 定向 6 个预检场景持续通过，003 预检场景持续通过。
4. `typecheck`、无 MySQL 环境的既有全量测试、`git diff --check` 通过。
5. 不产生正式 004 SQL、不会执行或改动 `knowledge_base` / `knowledge_base_uat`。

若串行 suite 后仍有超时，必须记录具体阻塞位置、MySQL 错误与资源证据，重新进行架构裁决；不得擅自提高超时或继续授权 004。

## 【004 SQL 独立授权前置条件】

以下全部满足后，架构上**允许产品 / 架构签发下一份独立 004 SQL 授权**：

```text
[已满足] 004 专属预检 QA 定向通过。
[已满足] 预检在同一 migration lock connection 且 DDL 前执行。
[已满足] 预检失败不写 004、未触及日常 / UAT 实库。
[待满足] P2 MySQL 集成测试串行调度补正与稳定复验通过。
[待满足] 004 SQL 的最终 DDL、checksum 测试预期与应用顺序在独立授权中再次确认。
```

下一份授权只能覆盖：

```text
migrations/004_add_exploration_tracks.sql
tests/mysql-s1-exploration-tracks.integration.test.ts（成功路径、checksum、幂等与 DDL 事实测试）
必要的 migration runner 测试基线断言
```

它不会自动授权基础 Contracts；Contracts 必须与 004 SQL 通过 QA / 架构复审后再单独进入 S1 后段。S2、S3 和前端继续冻结。
