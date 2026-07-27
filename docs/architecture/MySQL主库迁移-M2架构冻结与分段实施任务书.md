# MySQL 主库迁移 — M2 架构冻结与分段实施任务书

> 状态：**架构冻结完成。只授权数据 / Application / Repository 工程师实施 M2-A；M2-B 未授权。**
>
> 本文以现有 Contracts、IndexedDB Repository 与 M1 Schema v1 为准。不得由 MySQL 的表、外键或实现便利反向改变既有业务语义。

## 【技术结论：有条件可行】

M2 可按冻结顺序实施，且必须串行：

```text
M2-A：Item Repository 与状态历史可信写入
→ QA + 架构稳定审阅通过
→ 才允许 M2-B：Review 基础持久化与 BackupData 原子导入导出
```

持续冻结的事实：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository，只用于开发与合成测试
SQLite    = 保留的实验 / 测试资产
```

M2 验证的是 MySQL 对既有 Contracts 的候选实现等价性；它不授权 API 业务接口、前端切换、真实导入、双写或主库切换。

---

## 【M2-A 技术边界与 Contracts 映射】

### 允许实现

新增 `MySqlItemRepository implements ItemRepository`，仅映射：

| Contract 方法 | M2-A MySQL 行为 |
|---|---|
| `create` | 校验标题非空、trim；写 `items` 与初始 `item_status_events`。 |
| `getById` | 以 ID 读取 Item；可返回回收站 Item，与既有 Contract 一致。 |
| `list` | 只返回 `deleted_at IS NULL` 的 Item。 |
| `listDeleted` | 只返回 `deleted_at IS NOT NULL` 的 Item。 |
| `listStatusEvents` | 按 `created_at ASC, id ASC` 返回指定 Item 事件，保证同毫秒稳定顺序。 |
| `changeStatus` | 依现有 `assertTransition` 执行合法状态迁移；Item 更新和事件插入同一事务。 |
| `startExecution` | 合法迁移至 `doing`；只允许首次设置非空 `startAction`；Item 更新和事件插入同一事务。 |
| `updateContent` | 仅活跃 Item；trim 内容；更新 `updated_at`。 |
| `delete` | 仅软删除；已删除或不存在时无操作。 |
| `restore` | 仅允许回收站 Item；清除 `deleted_at` 并更新 `updated_at`。 |
| `purgeDeletedBefore` | 仅清理无方法结构化关联的过期 Item；遇关联时全事务安全拒绝。 |

不得实现：

```text
ReviewWorkflowRepository.complete()
MethodRepository
MethodApplicationRepository
SearchRepository
DashboardRepository
业务 HTTP API
```

### M2-A 的关键契约细节

1. 使用现有 Contracts 的 ID 生成、字段 trim、错误语义与 `assertTransition`；不得复制或重新定义状态机。
2. `create()` 同样属于状态历史可信写入：Item 与初始 `fromStatus = undefined` 的状态事件必须原子提交。
3. 所有时间由 Repository 生成 UTC ISO-8601 字符串，再映射为 MySQL `DATETIME(3)`；读取时必须还原规范 UTC ISO 字符串。不得依赖宿主时区或 MySQL 隐式时区。
4. 持久化 `start_action` 时：未设置为 SQL `NULL`；读取 SQL `NULL` 时 Contract 对象不得出现 `startAction` 属性。不得伪造空字符串。
5. 所有目标 Item 的写事务先以 `SELECT ... FOR UPDATE` 重新读取；不得拿事务外旧快照写回，避免 `updateContent()`、状态切换和删除/恢复之间的旧值覆盖。

---

## 【M2-A Schema / 事务 / 清理策略】

### Schema 裁决

**M2-A 不新增或修改 MySQL Schema migration。**

M1 `001_initial_schema.sql` 已具备 M2-A 所需的：

```text
items
item_status_events
reviews
method_evidence
method_versions
method_applications
item_links
```

M2-A 不得因为查询便利增删列、增设 cascade、修改现有外键或追加方法生命周期表逻辑。

### 精确事务边界

| 操作 | 事务内步骤 | 失败语义 |
|---|---|---|
| `create` | INSERT Item → INSERT 初始事件 → COMMIT | 任一步失败，Item 与事件均不存在。 |
| `changeStatus` | `SELECT ... FOR UPDATE` → 合法性校验 → UPDATE Item → INSERT 事件 → COMMIT | 状态和事件全有或全无。 |
| `startExecution` | 锁定 Item → 状态 / startAction 校验 → UPDATE status/start_action → INSERT 事件 → COMMIT | `doing`、startAction 与事件全有或全无。 |
| `updateContent` | 锁定 Item → 活跃校验 → UPDATE content/updated_at → COMMIT | 不覆盖并发已提交的 status、startAction 或 deletedAt。 |
| `delete` | 锁定 Item → 若活跃则 UPDATE deleted_at/updated_at → COMMIT | 只软删除，不删关联。 |
| `restore` | 锁定 Item → 必须已删除 → UPDATE deleted_at=NULL/updated_at → COMMIT | 恢复失败不改变任何字段。 |
| `purgeDeletedBefore` | 查询并锁定候选 Item → 预检关联 → 删除允许清理的附属记录 → 删除 Review / Item → COMMIT | 任一对象或关联不能安全处理，整个调用零变化。 |

`runInMySqlTransaction()` 必须用于上述写路径；只允许 DML，不得让 M2-A 调用 migration runner。

### 删除、恢复和永久清理

1. `delete()` 是软删除；**不得**删除 Review、事件、链接、方法证据或应用。
2. `restore()` 只恢复 Item 本身；不得重建、猜测或改写任何关联。
3. `purgeDeletedBefore(cutoff)` 的 Item 选取条件为：

   ```sql
   deleted_at IS NOT NULL AND deleted_at <= ?
   ```

4. 对每个候选 Item，事务内必须预检三类真实结构化关联：

   ```text
   method_applications.item_id = item.id
   method_evidence.review_id = review.id
   method_versions.source_review_id = review.id
   ```

5. 任一上述关联存在时，必须抛出稳定错误：

   ```text
   MySQL 方法关联清理尚未实施
   ```

   并 rollback；不得清空、置空、猜测、部分删除或复活数据。

6. `MethodTombstone` 没有 `itemId` 或 `reviewId` 的可信结构化引用，因此**孤立墓碑不得阻断**无关联 Item 的永久清理。
7. 无上述方法关联时，清理顺序为：

   ```text
   item_links（source_review_id / target_item_id）
   → item_status_events
   → reviews
   → items
   ```

   全部在同一事务中执行。M1 物理外键默认 RESTRICT；Repository 必须显式按此顺序清理，禁止添加 `ON DELETE CASCADE`。

---

## 【M2-A 自动化测试矩阵与验收门】

### 测试隔离

- 只在 MySQL 集成环境执行；缺 `.env` 时明确 `skip`，不得将 skip 记为通过。
- 每个测试使用随机、唯一 ID；用 app 用户通过 Repository 写合成业务数据。
- schema 由 migrator 在测试前准备；测试后按依赖逆序清理该测试 ID 数据。
- 失败注入可用临时 **测试专用 trigger** 或受控 Repository test hook；测试结束必须在 `finally` 删除 trigger。不得修改正式 migration，不得使用 root 绕过 app Repository 权限。
- 事务回滚断言必须比较完整受影响集合快照，不能只断言 Item 是否存在。

### 必测矩阵

| 类别 | 最小证据 |
|---|---|
| 基础 Item | create trim、标题空拒绝、初始状态事件、活跃 / 回收站列表过滤、UTC 映射。 |
| 状态 | 每个合法 / 非法迁移；已删除 Item 拒绝；Item UPDATE 成功后事件 INSERT 失败时完整 rollback。 |
| `startExecution` | 迁移至 doing、可选 startAction、重复 startAction 拒绝；最终事件失败时 Item/status/startAction/event 零变化。 |
| 内容与交错 | updateContent 后 changeStatus 保留 content；删除后内容更新拒绝且不复活；旧读取快照不得覆盖后提交字段。 |
| 软删除 / 恢复 | delete 幂等；restore 仅允许已删除；恢复与 purge 交错后已恢复 Item 不得误删。 |
| 永久清理正向 | 无方法关联的过期 Item 连同普通 Review、事件、双向 ItemLink 被一次事务清理；孤立 tombstone 不受影响。 |
| 永久清理拒绝 | Application、Evidence、Version-source 三种关联分别触发稳定拒绝；调用前后完整业务快照相等。 |
| 回归 | M1 integration、既有 IndexedDB 全量测试、typecheck、test、build:h5、git diff --check。 |

### M2-A 退出门

只有同时满足以下条件，M2-A 才可交 QA 与架构稳定审阅：

```text
所有 M2-A 集成测试在实际 MySQL 环境通过
P0 事务失败注入证明无半写入
永久清理正向和三类安全拒绝均具备完整快照证据
未修改 apps/client、Contracts 业务语义、业务 API、前端或 IndexedDB 主路径
工程验证与每日贡献记录完成
```

M2-A 通过不自动授权 M2-B；必须由 QA 验证后重新回架构师审阅。

---

## 【M2-B 技术边界与 Contracts 映射】

M2-B 仅在 M2-A 封板后开始。

### 允许实现

| Contract | M2-B 范围 |
|---|---|
| `ReviewRepository` | `create`、`getById`、`getByItemId`、`delete` 的基础持久化。 |
| `BackupRepository` | `exportData` 与 `replaceData`。 |
| `BackupApplicationService` | 仅复用既有 `parseAndValidate()` / `restoreBackup()`；不改其 JSON format、v1/v2 兼容或引用校验语义。 |

Review 约束：

- `create()` 只校验既有 Contract 所要求的 `actualAction`、`result`，且所有文本 trim；
- `itemId` 必须是存在的 Item；
- 同一 Item 只能有一个 Review，依赖现有唯一约束；重复 Review 转为现有错误 `该事项已经完成复盘`；
- `delete()` 仅按 Review ID 删除；如果未来方法关系存在，M2-B 不猜测清理，必须安全拒绝并留给后续方法生命周期阶段。

`completeReview()`、方法、证据、版本、方法应用、搜索和 Dashboard 仍不进入 M2-B。

---

## 【M2-B BackupData 与 system_metadata 策略】

### Schema 裁决：需要一个最小 migration

M1 Schema v1 缺少基础设施私有元数据表。M2-B **仅允许新增**：

```text
migrations/002_add_system_metadata.sql
```

最小 DDL：

```sql
CREATE TABLE system_metadata (
  `key` VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
```

边界：

```text
只新增 system_metadata
不修改九个业务表
不新增业务字段、触发器、cascade、索引或权限
不变更 BackupData / JSON 文档结构
```

该 migration 必须以 M1 已冻结方式执行：migrator + advisory lock + checksum。MySQL DDL 不能承诺 rollback；失败策略为 fail-fast、禁止写 schema_migrations 成功记录、人工检查后前向修复，绝不篡改已执行 migration。

### 九集合真实映射

| BackupData 集合 | MySQL 表 | 关键映射 |
|---|---|---|
| `items` | `items` | `startAction` ↔ `start_action NULL`；deletedAt ↔ `deleted_at NULL`。 |
| `reviews` | `reviews` | itemId ↔ `item_id`，唯一 Item Review。 |
| `methods` | `methods` | validationCount/version/deletedAt 完整保留。 |
| `methodEvidence` | `method_evidence` | relation 可空、methodVersion 可空。 |
| `methodVersions` | `method_versions` | `(method_id, version)` 唯一；可选 sourceReviewId 保留解析后的结果。 |
| `methodApplications` | `method_applications` | itemId 受硬 FK；method 关系由墓碑生命周期解释，不设错误硬 FK。 |
| `itemStatusEvents` | `item_status_events` | fromStatus 可空。 |
| `itemLinks` | `item_links` | sourceReviewId / targetItemId 受硬 FK。 |
| `methodTombstones` | `method_tombstones` | versions 数组以 JSON 原样结构化保存。 |

`system_metadata`：

```text
不属于 BackupData
exportData() 不读取、不导出
replaceData() 不 DELETE、不 INSERT、不 UPDATE
JSON restore 不得伪造、恢复或覆盖其记录
```

### `exportData()` 读一致性

在单一只读一致性事务中读取所有九集合，映射为现有 Contract 字段。导出排序必须确定：至少各集合以主键排序；版本按 `(method_id, version)`；状态事件按 `(item_id, created_at, id)`。排序只为稳定测试与 JSON 可比性，不改变业务事实。

---

## 【M2-B 原子恢复与失败回滚策略】

### 先校验、后进入 SQL

```text
原始 JSON
→ BackupApplicationService.parseAndValidate()
→ 合法 BackupData
→ MySqlBackupRepository.replaceData()
```

若 `parseAndValidate()` 失败：

```text
不得调用 replaceData()
不得获取业务写事务
MySQL 候选数据保持原样
```

### replaceData 单事务

`replaceData(data)` 使用 app 用户、单一 MySQL DML transaction；不得调用 migrator 或 root。

清空顺序（子表优先）：

```text
item_links
→ item_status_events
→ method_applications
→ method_evidence
→ method_versions
→ method_tombstones
→ reviews
→ methods
→ items
```

导入顺序（满足硬 FK）：

```text
items
→ methods
→ reviews
→ method_versions
→ method_evidence
→ method_applications
→ method_tombstones
→ item_links
→ item_status_events
```

附加约束：

1. 所有插入使用参数化 SQL 和 batch 分块；分块不是分事务。
2. 任一集合、任一行写入失败必须 rollback 整个业务替换；替换前的完整九集合保持不变。
3. 不允许 `SET FOREIGN_KEY_CHECKS = 0`；业务备份必须由现有 `parseAndValidate()` 和真实物理约束共同保护。
4. 不允许 TRUNCATE；MySQL `TRUNCATE` 隐式提交，会破坏 replaceData 的原子性。只使用事务内 `DELETE FROM`。
5. `system_metadata` 永远不在删除和写入语句中。
6. v1 缺失集合、`startAction` 与断裂可选 `MethodVersion.sourceReviewId` 的受限归一化，仍只由既有 `parseAndValidate()` 决定；MySQL Repository 不重猜、不补造。

---

## 【M2-B 自动化测试矩阵与验收门】

| 类别 | 最小证据 |
|---|---|
| Review 基础 | create/get/getByItemId/delete；文本 trim；空 actualAction/result 拒绝；缺失 Item 拒绝；同 Item 重复 Review 拒绝。 |
| Backup 导出 | 九集合含 startAction、回收站、版本、应用、墓碑的逐字段规范化等价；稳定排序。 |
| v2 恢复 | `parseAndValidate → replaceData → exportData` 九集合等价。 |
| v1 兼容 | 复用既有 v1 归一化：缺失集合、startAction、历史版本规则与可选断裂 sourceReviewId。 |
| 非法备份 | 重复 ID、非法状态、必填引用断裂、Method/Tombstone 同 ID、非法 tombstone versions、非字符串 startAction：解析期拒绝且 Repository 写入未发生。 |
| SQL 末端失败 | 在最后 `item_status_events` 写入注入失败；完整 MySQL BackupData 回滚至替换前快照。 |
| metadata 隔离 | 预置 `system_metadata` 实际值；export / replace 前后 value 不变，且导出 JSON 中不存在它。 |
| 约束 / 权限 | app 只能 DML；无 `FOREIGN_KEY_CHECKS`、DDL、跨库、root/migrator 绕过。 |
| 回归 | M1 + M2-A + M2-B MySQL 集成、既有 IndexedDB 全量、typecheck、test、build:h5、git diff --check。 |

### M2-B 退出门

```text
002 migration 在干净 MySQL 环境可执行、可重复验证且 checksum 受保护
Review 基础 Contract 通过
BackupData 九集合 import/export 等价通过
非法备份零写入、SQL 中途失败全量 rollback 均有实证
system_metadata 真实值在 export/replace 前后保持不变
当前前端与 IndexedDB 主路径未改动
```

---

## 【允许修改的文件或层】

### M2-A 当前授权

```text
packages/storage-mysql/**
tests/mysql-m2a*.test.ts 或 tests/mysql-m2*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

可新增 test-only 辅助文件；不得修改 M1 migration。

### M2-B 待 M2-A 通过后另行授权

```text
packages/storage-mysql/**
migrations/002_add_system_metadata.sql
apps/api/src/migrate.ts（仅必要命令编排，不增加业务 API）
tests/mysql-m2b*.test.ts 或 tests/mysql-m2*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

---

## 【明确禁止事项】

```text
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
IndexedDB → MySQL 真实迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
修改现有 Contracts 的业务语义
修改或删除 SQLite 实验资产
M2-A 期间新增 Schema migration
M2-B 之外新增业务 Schema / 权限 / trigger / cascade
SET FOREIGN_KEY_CHECKS = 0
TRUNCATE 作为 replaceData 实现
Kubernetes、云端同步、远程访问或协作能力
```

---

## 【风险与保护策略】

1. **MySQL 隔离级别是 READ COMMITTED。** 目标 Item 写操作必须 `SELECT ... FOR UPDATE`；仅依赖先读后写会造成旧快照覆盖。
2. **批量 purge 的交错风险。** 候选 Item 必须在同一事务内再次锁定并检查 `deleted_at`，restore 已提交后不可被旧 purge 误删。
3. **方法生命周期未完成。** M2-A 遇 MethodApplication、MethodEvidence 或 MethodVersion 的真实 Item/Review 关联必须安全拒绝；不得为了“对齐清理”越过阶段边界。
4. **MySQL DDL 不具备业务 rollback。** `002` 只允许新增私有 metadata 表；任何破坏性 Schema 演进重新评审。
5. **只读导出不是备份恢复演练。** M2-B 证明候选 Repository 等价，不是现实迁移、灾难恢复或主库切换证明。
6. **集成测试环境必须真实。** 没有 MySQL `.env` 的 skip 只能说明测试未运行，不能作为阶段验收。

---

## 【交付给数据 / Application / Repository 工程师的实施任务书】

### 当前任务：仅实施 M2-A

1. 在 `packages/storage-mysql/**` 实现 `MySqlItemRepository`，严格实现上述 `ItemRepository` 映射。
2. 复用现有 Contracts、状态机和输入规则；不得改 Contracts 或 Application 运行组合。
3. 所有 Item 写入以 app pool 的单一 DML transaction 完成；目标 Item 写前 `SELECT ... FOR UPDATE`。
4. 实现无方法关联 Item 的永久清理；对三类方法结构化关联使用稳定错误安全拒绝并 rollback。
5. 编写真实 MySQL 集成测试，包含 P0 失败注入、完整快照回滚、删除/恢复交错和权限边界。
6. 不新增 migration、不实现 Review/Backup、不修改前端/API/IndexedDB。
7. 运行并报告：

   ```text
   corepack pnpm -C Knowledge_Base test --run <M2-A tests>
   corepack pnpm -C Knowledge_Base typecheck
   corepack pnpm -C Knowledge_Base test
   corepack pnpm -C Knowledge_Base build:h5
   git -C Knowledge_Base diff --check
   ```

8. 每轮工程验证后追加 `docs/daily-contributions/YYYY-MM-DD.md`。

### M2-A 完成后的流转

```text
数据 / Application / Repository 工程师
→ QA：按 M2-A 测试矩阵复验
→ 架构师：稳定审阅
→ 仅在 M2-A 封板后，授权实施 M2-B
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，但仅限 M2-A。**
