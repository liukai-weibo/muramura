# Schema 公共时间字段——原子切片产品编码授权

> 日期：2026-08-03
>
> 状态：已授权编码与随机临时库验证；不授权迁移日常库或 UAT 库。

## 【结论】

产品确认按 `docs/architecture/Schema公共时间字段-最小任务书.md` 实施，并确认以下五项有界例外：

1. `system_metadata.key`、`method_tombstones.method_id`、`user_roles` 复合主键保留，不强制改名为 `id`。
2. 只追加表创建时 `updated_at = created_at`，没有业务 UPDATE 时不制造虚假刷新。
3. `user_roles` 撤销继续物理 DELETE，不改成软删除。
4. Backup 保持 V3，不升级格式；恢复时从既有创建/永久删除时间推导数据库新列。
5. 本切片不强制 API/H5 DTO 暴露 `updatedAt`，只统一 MySQL 结构与写入语义。

MySQL 不支持把三列定义为可自动展开的复合标量。本切片采用“每表显式列 + 复用日期转换 + 全库结构守卫”：三列保持可查询、可索引、可约束；未来新增业务表若缺少稳定主键、`created_at` 或 `updated_at`，随机临时库 Schema 测试必须失败。

## 【当前阶段与编码门判断】

用户已明确同意五项例外并要求开始。Migration 与 Repository 写路径必须原子完成，避免 Schema 7 已要求 NOT NULL 字段而生产写入仍停留旧列清单。本授权只打开源码、Migration 与随机临时库自动化测试门；当前 `knowledge_base` 与 `knowledge_base_uat` 仍保持 Schema 6，迁移窗口另行确认。

## 【允许修改的文件】

生产与 Migration：

- 新增 `migrations/007_add_common_audit_timestamps.sql`
- `packages/storage-mysql/src/index.ts`
- `packages/storage-mysql/src/account-repository.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `packages/storage-mysql/src/initial-owner-claim-repository.ts`
- `packages/storage-mysql/src/backup-repository.ts`
- `packages/storage-mysql/src/item-repository.ts`
- `packages/storage-mysql/src/method-repository.ts`
- `packages/storage-mysql/src/method-application-repository.ts`
- `packages/storage-mysql/src/review-workflow-repository.ts`
- `packages/storage-mysql/src/exploration-track-repository.ts`

直接测试：

- 新增 `tests/mysql-common-audit-fields.integration.test.ts`
- `tests/api-startup-diagnostics.test.ts`
- `tests/api-schema6-startup.integration.test.ts`
- `tests/mysql-account-ownership-schema.integration.test.ts`
- `tests/mysql-platform-security-schema.integration.test.ts`
- `tests/api-auth.integration.test.ts`
- `tests/api-owner-isolation.integration.test.ts`
- `tests/api-platform-administration.integration.test.ts`
- `tests/initial-platform-admin-cli.integration.test.ts`
- `tests/mysql-m2a.integration.test.ts`
- `tests/mysql-m2b.integration.test.ts`
- `tests/mysql-m3a.integration.test.ts`
- `tests/mysql-m3b.integration.test.ts`
- `tests/mysql-m3c.integration.test.ts`
- `tests/mysql-m4c.integration.test.ts`
- `tests/mysql-owner-claim-backup.integration.test.ts`
- `tests/mysql-platform-administration-repository.integration.test.ts`
- 因 Migration 007 进入最新集合而直接失败的既有 `tests/mysql-*.integration.test.ts`，仅允许调整字段列清单、Schema 版本期望与审计时间断言，不得改变业务断言。

必要记录：

- `docs/architecture/Schema公共时间字段-最小任务书.md`
- `docs/product/当前运行事实.md`
- `docs/development/本机迁移与一键启动.md`（仅同步源码最低 Schema 版本与运行库尚未迁移的提示）
- `docs/daily-contributions/2026-08-03.md`
- 本授权对应 QA/验收记录

## 【不允许项】

- 不修改 Migration 001–006、migration record、`.env*`、Docker/Compose、Contracts、Application、API 路由或 H5。
- 不对 `knowledge_base`、`knowledge_base_uat` 执行 DDL/DML，不停止、迁移或重启当前 API/MySQL。
- 不新增触发器，不用 JSON 审计对象替代真实列，不引入 ORM 或全局基类重写。
- 不新增用户 CRUD、超级管理员、角色语义、业务状态、关联、路由或 Backup V4。

## 【验收标准】

1. 最新 Migration 为 007，Schema 6 启动被拒绝且 required=7，Schema 7 才能 ready。
2. 除 `schema_migrations` 外，全部 16 张业务 base table 均有稳定主键、`created_at DATETIME(3) NOT NULL`、`updated_at DATETIME(3) NOT NULL`。
3. Migration 007 可在部分列已存在时安全继续；历史回填规则与架构任务书一致。
4. 所有生产 INSERT/UPDATE/软删/会话撤销/owner claim/Backup 恢复写入新字段；只追加表创建时两时间相等。
5. 新表结构守卫自动覆盖未来业务 base table，不依赖人工维护完整表名单；基础设施表排除必须显式。
6. 随机临时库测试、相关回归、typecheck 与 `git diff --check` 通过；两运行库前后只读摘要一致且临时资源零残留。

## 【下一责任岗】

数据 / Application / Repository 工程师实施；完成后只转独立 QA，不自动迁移运行库或构成产品验收。

## 【是否允许写代码】

是，仅限上述文件、字段语义与随机临时库验证。
