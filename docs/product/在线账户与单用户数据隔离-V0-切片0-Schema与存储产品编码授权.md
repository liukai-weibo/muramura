# 在线账户与单用户数据隔离 V0：切片 0 Schema 与存储产品编码授权

日期：2026-07-29  
状态：产品验收通过并归档；切片 1 可开始，切片 2–5 不得开始

## 范围

- 在新增 migration 中建立 `users`、`user_sessions`、`initial_owner_claims`，并为十个现有业务集合增加 `owner_user_id`；逐字遵循架构已冻结的类型、列顺序、约束、索引和 `RESTRICT` 外键。
- `owner_user_id` 在本切片固定为 `NULL DEFAULT NULL`；不创建账户、不回填、不执行 claim、不启用用户过滤或任何隔离行为。

## 允许修改

- 仅允许将既有未归档草案 `migrations/005_add_online_account_owner_scope.sql` 修订并更名为唯一的 `migrations/005_add_accounts_sessions_and_owner_columns.sql`；不得保留、复制或新增第二个 005 migration。
- 仅新增 `tests/mysql-account-ownership-schema.integration.test.ts`。
- 必要切片 0 架构/QA/产品记录与当天贡献记录。

## 硬边界与验收

- 密码哈希契约固定为 scrypt `N=32768, r=8, p=1, dkLen=64`、16-byte salt、`VARCHAR(255)` 编码；绝不保存或输出明文。
- 会话原始秘密固定为 32-byte 随机值，数据库仅存 SHA-256 `BINARY(32)`；绝不保存或输出原始秘密。
- 不得写入、迁移或初始化 `knowledge_base`、`knowledge_base_uat`、云端运行库；自动化测试仅使用随机临时数据库与独立账号，finally 清理。
- 禁止修改 Repository、API、Application、H5、Contracts、Backup、Docker、配置或业务状态机；不创建注册/登录路由。
- 工作区既有 `packages/contracts/src/index.ts` 与 `packages/domain/src/index.ts` 改动不属于本切片，必须保留原样且不得混入、覆盖或依赖。
- 保留 `exploration_tracks_normalized_name_unique`；按用户名称唯一只能在切片 2 scope 全量启用时通过独立 migration 原子替换。
- 必须覆盖 schema、索引/约束、十集合 owner 列、哈希/会话秘密不泄露及临时库零污染；通过定向测试、typecheck、`git diff --check` 后转 QA。

## 产品验收与归档（2026-07-29）

验收通过。QA 已在仅连接 `127.0.0.1` MySQL 的随机 `kb_accounts_<UUID>` 临时数据库和独立临时 app/migrator 账号中验证：唯一 005 migration、账户/会话/claim/十集合 owner 列的冻结 Schema 契约、会话仅存 SHA-256 `BINARY(32)` 摘要，以及测试后临时库和账号零残留。`knowledge_base` 与 `knowledge_base_uat` 前后只读摘要一致；定向集成测试 1 文件 2 用例、typecheck 和 `git diff --check` 均通过。

本结论只验收切片 0 的 Schema 与测试隔离；未验收注册、登录、claim、owner 回填或用户过滤。切片 1 条件授权现生效；切片 2–5 继续不得开始。
