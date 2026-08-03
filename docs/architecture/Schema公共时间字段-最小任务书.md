# Schema 公共时间字段——最小架构任务书

> 日期：2026-08-03
>
> 状态：架构范围已冻结；待产品经理书面评审并按本文件范围单独授权编码与 Migration 执行窗口。
>
> 依据：`docs/product/Schema公共时间字段-产品立项与架构评审授权.md`；运行事实以 `docs/product/当前运行事实.md` 为准。
>
> 本文件**不授权编码**；架构师未实施任何业务代码或 Migration。

## 【技术结论：有条件可行】

产品要求的「全业务 base table 具备 `id` / `created_at` / `updated_at` 语义」在**不改写已应用 001–006**、以新 Migration `007` 前进的前提下可行。但现状并非「统一缺一列」：

- 部分表已完整具备三者；
- 多数账户/事件/关联表仅有 `created_at`；
- 个别表主键**不是**名为 `id` 的列（`system_metadata.key`、`method_tombstones.method_id`、`user_roles` 复合主键）；
- 大量表为**只追加**写模型，业务上几乎不存在 UPDATE。

因此实施必须：**Schema 用 `007` 补齐可空/回填后的 `updated_at`（及少数 `created_at`）**；写路径在可变表强制刷新；只追加表在 INSERT 时令 `updated_at = created_at`；身份列**不强制改名为 `id`**，而以「稳定主键」满足产品 `id` 语义。Backup JSON **默认不升主版本**；恢复时对缺字段实体用 `created_at` 推导写入新列。

**不可行/需产品二次确认的越界项**（本任务书明确排除）：用户改删、超管、注册可选角色、改写 001–006、触发器强制 `ON UPDATE CURRENT_TIMESTAMP` 作为唯一刷新手段（与现有应用层 `DATETIME(3)` 赋值风格不一致，且难测）。

## 【可复用现有能力】

- Migration runner：`runMySqlMigrations` + `schema_migrations` 记账与 checksum。
- 已有可变实体写路径对 `updated_at` 的应用层赋值（`items` / `methods` / `reviews` / `exploration_tracks`）。
- `MYSQL_REQUIRED_SCHEMA_VERSION` 启动门与 `/health` 的 `schemaVersion`。
- Backup 的显式列 INSERT（恢复链必须随新列更新，但可读模型可继续从 `created_at` 推导）。
- 随机临时库 MySQL 集成测试与两运行库只读快照惯例。

## 【表级盘点（基于 migrations 001–006；实施前须用 information_schema 对日常库复核）】

共 17 张业务相关 base table + 基础设施表 `schema_migrations`（**排除**：非业务表，不纳入本项字段对齐）。

| 表 | 主键形态 | created_at | updated_at | 删除相关 | 分类 |
|---|---|---|---|---|---|
| items | id | 有 | 有 | deleted_at | 已对齐（须审计软删是否同时刷新 updated_at） |
| reviews | id | 有 | 有 | 无 | 已对齐 |
| methods | id | 有 | 有 | deleted_at | 已对齐（同上） |
| exploration_tracks | id | 有 | 有 | deleted_at | 已对齐（同上） |
| users | id | 有 | **无** | 无 | **007 补 updated_at**；可变（未来改密等另案） |
| user_sessions | id | 有 | **无** | revoked_at | **007 补 updated_at**；撤销会话时刷新 |
| initial_owner_claims | id | 有 | **无** | 无 | 只追加；007 补列，INSERT 双写相等 |
| method_versions | id | 有 | **无** | 无 | 只追加不可变版本；007 补列 |
| method_evidence | id | 有 | **无** | 无 | 只追加；007 补列 |
| method_applications | id | 有 | **无** | 无 | 只追加（现行无更新）；007 补列 |
| item_status_events | id | 有 | **无** | 无 | 只追加事件；007 补列 |
| item_links | id | 有 | **无** | 无 | 只追加；007 补列 |
| security_audit_events | id | 有 | **无** | 无 | 只追加审计；007 补列 |
| user_roles | (user_id, role_code) | 有 | **无** | 撤销为 DELETE 行 | **007 补 updated_at**；INSERT 赋值；DELETE 无行可更新（见例外） |
| system_metadata | **key**（非 id） | **无** | 有 | 无 | **有界例外**：保留 `key` 为身份；**007 补 created_at**（回填自 updated_at） |
| method_tombstones | **method_id**（非 id） | **无** | **无** | permanently_deleted_at | **有界例外**：保留 method_id；007 补 created_at/updated_at，回填自 permanently_deleted_at |
| schema_migrations | version | applied_at | — | — | **排除**（基础设施） |

### 提请产品书面确认的有界例外（编码授权前必须勾选）

1. **身份列命名**：`system_metadata.key`、`method_tombstones.method_id`、`user_roles` 复合主键 **不重命名为 `id`**，视为已满足产品「id」语义的稳定主键。
2. **只追加表**：无 UPDATE/软删路径；`updated_at` 仅在 INSERT 时等于 `created_at`，即满足「写操作刷新」的退化形式。
3. **user_roles 撤销**：现行为物理 DELETE；删除后无行可写 `updated_at`。不在本项改为软删角色（属权限模型变更）。授予时写入 `updated_at=created_at` 即可。
4. **Backup JSON**：本项**不**将 Backup 主版本升为 V4；缺 `updatedAt` 的导出对象恢复时，Repository 用 `createdAt`（或 tombstone 的 `permanentlyDeletedAt`）填 DB `updated_at`。
5. **API/OpenAPI/H5**：本项默认**不**强制所有 DTO 新增 `updatedAt` 字段；以 DB 可观测 + Repository 写正确为验收主口径。若产品要求对外暴露，另开切片。

## 【最小新增能力与实施切片】

建议拆成**两个顺序切片**（各需独立产品编码授权；不可在无授权下偷跑）：

### 切片 1 — Schema 007 与启动门（存储结构）

1. 新增 `migrations/007_add_common_audit_timestamps.sql`（名称可微调，版本号必须为 7）。
2. 对缺列的表 `ADD COLUMN updated_at DATETIME(3) NULL`，按规则 `UPDATE ... SET updated_at = <源>` 回填，再 `MODIFY updated_at DATETIME(3) NOT NULL`。
3. `system_metadata` 增加 `created_at`，回填自 `updated_at` 后 NOT NULL。
4. `method_tombstones` 增加 `created_at`、`updated_at`，回填自 `permanently_deleted_at` 后 NOT NULL。
5. 将 `MYSQL_REQUIRED_SCHEMA_VERSION` 升为 `7`；同步启动诊断单测中的 required=7 期望。
6. **禁止**改 001–006 文件；禁止触发器作为本切片唯一刷新机制。

回填源规则（冻结）：

- 有 `created_at` 的表：`updated_at := created_at`
- `system_metadata`：`created_at := updated_at`
- `method_tombstones`：`created_at := permanently_deleted_at`，`updated_at := permanently_deleted_at`

### 切片 2 — Repository 写路径与 Backup 恢复列清单

1. 可变表：所有 UPDATE / 软删 / 会话 `revoked_at` 赋值路径同步设置 `updated_at`（与业务操作同一时钟来源，沿用现有 ISO→MySQL DATETIME(3) 工具）。
2. 只追加表：INSERT 增加 `updated_at` 绑定，值等于该行 `created_at`。
3. `MySqlBackupRepository`（及测试）恢复 INSERT 列清单补齐新列；导出 map 可不扩散到 Contracts，恢复时推导填列。
4. 审计既有 `items`/`methods`/`exploration_tracks` 软删是否已刷新 `updated_at`；若有遗漏，仅最小补丁。
5. **不**在本切片强制抽取全局 TypeScript「三字段基类」横扫全仓；允许在 `storage-mysql` 内增加小的日期赋值辅助函数，避免复制错误。

## 【数据可信边界】

- 以当次连接的 `DATABASE()` 与 `schema_migrations` 为准，不从文档/端口推断。
- `updated_at` / `created_at` 仅表示行级审计时间，不推导业务关系、权限或状态机。
- 前端不得用本地时钟覆盖服务端时间字段（本项若不暴露 DTO 则无新风险）。

## 【实施方案】

1. 编码授权后先对目标库做只读列盘点，确认与上表一致再写 007。
2. 007 在单连接迁移锁内执行；失败不得留下半套 NOT NULL 列（语句顺序：加可空列 → 回填 → 改 NOT NULL）。
3. 应用层刷新优先；不引入跨表触发器。
4. 切片 1 合并后 API 在未迁移库上应稳定 `schema-version-behind` / required=7；迁移后再 ready。
5. 切片 2 以 Repository 单测 + 既有 MySQL 集成回归证明写路径；Backup 往返用临时库。

## 【是否涉及 Schema / Migration / 备份】

- **涉及**：新 Migration `007`；`MYSQL_REQUIRED_SCHEMA_VERSION = 7`。
- **涉及 Backup 恢复 SQL 列**：不强制 Backup 文件格式版本升级。
- **不涉及**：改 001–006；运行库在无产品 Migration 窗口时禁止执行 `db:migrate`。

## 【运行库隔离与风险保护策略】

- 自动化测试只用随机临时 database / 临时账号；`finally` 清理。
- 对日常 `knowledge_base` 与 UAT `knowledge_base_uat` 执行 007 前：产品单独打开迁移窗口；前后只读深度快照；显式加载对应 `.env` / `.env.uat`；先 `/health` 记录 database 与 schemaVersion。
- 禁止删 `mysql-data`、禁止 `compose down -v`、禁止手工改 `schema_migrations`。
- 开发空库可在窗口内一次跑齐 001–007；已有 Schema 6 库只跑 007。

## 【允许修改的文件或层】（供后续编码授权逐条勾选）

### 切片 1 建议允许

- `migrations/007_*.sql`（新建）
- `packages/storage-mysql/src/index.ts`（`MYSQL_REQUIRED_SCHEMA_VERSION` 与启动诊断 required 文案/单测期望）
- `tests/api-startup-diagnostics.test.ts`、`tests/api-schema6-startup.integration.test.ts`（版本门改为 7；文件名可保留或另授权重命名）
- `docs/product/当前运行事实.md`、`docs/daily-contributions/YYYY-MM-DD.md`、本任务书对应 QA/授权记录

### 切片 2 建议允许（精确清单在编码授权时由实施前再核对 import 写点）

- `packages/storage-mysql/src/account-repository.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`（若触碰 user_roles）
- `packages/storage-mysql/src/backup-repository.ts`
- 其它确有 INSERT/UPDATE 缺列的 `packages/storage-mysql/src/*-repository.ts`
- 对应 `tests/mysql-*.integration.test.ts` / 定向 storage 测试
- 必要记录文件

**默认不改**：`apps/client/**`、Contracts Backup V3 形状、Hono 路由 DTO（除非产品追加「对外暴露 updatedAt」切片）、Docker/Compose、`.env*`。

## 【自动化测试与 UAT 建议】

1. 临时库：迁移到 6 后跑 007，断言缺列→有列、回填非空、checksum 记账 version=7。
2. 启动门：临时库停在 6 时 API 拒绝且诊断含 required=7；7 后 ready。
3. 可变表：更新/软删/撤会话后 `updated_at` 严格大于操作前。
4. 只追加表：INSERT 后 `updated_at = created_at`。
5. Backup：旧备份恢复到 Schema 7 临时库成功；新列有值。
6. 工程门：`typecheck`、相关 `test`、`git diff --check`。
7. 浏览器 UAT：切片 1/2 默认不强制；若未暴露 DTO，以 API/SQL 证据为准。

## 【交付给产品经理的授权条件】

1. 书面确认五条「有界例外」（身份命名、只追加退化、user_roles DELETE、Backup 不升版、DTO 不强制暴露）。
2. 分开签发切片 1 / 切片 2 的**产品编码授权**，列出允许文件；切片 1 须显式写明是否允许对日常库和/或 UAT 执行 `007` 及快照要求。
3. 确认不授权用户 CRUD/超管等另案需求混入本项。
4. 确认实施会话不得在无 QA/验收门时宣称封板。

## 【编码前置检查清单】（实施岗开工前）

- [ ] 产品已勾选例外并签发对应切片编码授权
- [ ] 只读确认目标库 `schemaVersion` 与列现状
- [ ] 两运行库只读快照已保留（若动运行库）
- [ ] 不修改 001–006
- [ ] 临时库证明 007 与启动门后再考虑运行库窗口

## 【下一责任岗】

产品经理：评审本任务书 → 确认例外 → 签发切片编码授权（可先只批切片 1）。
