# MySQL 主库迁移 — M3 架构冻结与分段实施任务书

> 状态：**架构冻结完成。暂不授权编码；产品确认任务书后，数据 / Application / Repository 工程师仅可从 M3-A 开始实施。**
>
> M3 是“方法生命周期候选 Repository 等价验证”，不是 MySQL 运行时接入、Review Workflow 或真实迁移。

## 【技术结论：有条件可行】

M1 Schema v1 已有 M3 所需的九个业务表，但尚不完全表达既有 Contract 的唯一性、Review 引用和高频结构化关联查询。因此 M3 允许一条受限的 `003_method_lifecycle_constraints.sql` migration。

实施必须串行：

```text
M3-A：Schema 003 + Method / Version / Evidence 基础生命周期
→ QA + 架构稳定审阅
→ M3-B：MethodApplication、Tombstone、Item / Review / Method 永久清理编排
→ QA + 架构稳定审阅
→ M3-C：完整方法生命周期 BackupData 等价与原子恢复回归
→ QA + 架构最终封板
```

M3-A、M3-B、M3-C 不得并行混做。M3-C 不新增 Repository 业务能力，只验证已实现生命周期在 BackupData 闭环中等价。

持续冻结：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository，仅用于开发与合成测试
SQLite    = 保留的实验 / 测试资产
```

---

## 【现有能力与 M3 缺口】

### 已有能力

- M1：MySQL 8.4、最小权限、migration runner、Schema v1、named volume 与 `/health`。
- M2-A：MySqlItemRepository，状态历史、软删除、恢复、无方法关联 Item 的安全永久清理。
- M2-B：MySqlReviewRepository 基础读写与关联删除安全拒绝；MySqlBackupRepository 九集合原子替换；`system_metadata` 私有隔离。
- 现有 MySQL 表已包含 `methods`、`method_versions`、`method_evidence`、`method_applications`、`method_tombstones`。

### M3 缺口

```text
MySqlMethodRepository
MySqlMethodApplicationRepository
方法 / 版本 / 证据 / 应用 / 墓碑生命周期事务
Item / Review 永久清理从“安全拒绝”升级为完整编排
结构化上下文与批量来源读模型
既有方法生命周期关系的 BackupData 闭环测试
```

`completeReview()` 不在本阶段。M3 的 `createFromReview()` 和 `validateFromReview()` 仅是既有 `MethodRepository` 单一方法生命周期操作；不得借它们拼装复盘闭环、派生事项、ItemLink 写入或 `reviewed` 状态迁移。

---

## 【Contracts 与 MySQL Repository 映射】

### `MySqlMethodRepository implements MethodRepository`

| Contract | MySQL 映射与冻结语义 |
|---|---|
| `createFromReview(input, reviewId)` | 同一事务锁定并确认 Review 存在；写 `methods` v1、`method_versions` v1、`method_evidence(relation=formation, method_version=1)`。 |
| `list()` / `listDeleted()` | 从 `methods` 分别读取 `deleted_at IS NULL` / `IS NOT NULL`；确定性按时间、ID 排序。 |
| `listByReviewId(reviewId)` | 只由 `method_evidence.review_id` 找 Method；只返回当前活跃 Method；不按标题、版本或时间猜测。 |
| `listVersions(methodId)` | 仅 `method_versions.method_id`，按 `version ASC, id ASC`。 |
| `listEvidenceDetails(methodId)` | Evidence → Review → Item 的真实结构化 join/read model；缺失历史对象以既有固定降级文案展示，不补造引用。 |
| `moveToTrash(methodId)` | 锁定活跃 Method；设置 `deleted_at`、`updated_at`；不删版本、证据、应用。 |
| `restore(methodId)` | 锁定且必须在回收站；仅清除 `deleted_at`、更新 `updated_at`。 |
| `purgeDeletedBefore(cutoff)` | 由 Method、Version、Evidence、Application、Tombstone 同一事务创建可信墓碑并清理正文/版本。 |
| `validateFromReview(methodId, reviewId, revision?)` | 锁定活跃 Method 与存在 Review；拒绝同 `(methodId, reviewId)` 重复证据；更新验证次数；revision 时新增版本并更新正文；写 Evidence。 |

### `MySqlMethodApplicationRepository implements MethodApplicationRepository`

| Contract | MySQL 映射与冻结语义 |
|---|---|
| `createItem(input)` | 锁定活跃 Method 和其当前 Version；同一事务创建 Item、初始状态事件及一条 Application；不创建 ItemLink。 |
| `getContextByItemId(itemId)` | 只在真实 Application、Method、Version 全部存在且 Method 活跃时返回上下文；其他状态返回 `undefined`。 |
| `getContextResultByItemId(itemId)` | 仅以 Application.methodId / methodVersion 连接 Method、Version、Tombstone；完整映射 `available`、`method-in-trash`、`method-purged`、三类 `unavailable`、`no-association`。 |
| `listSourceDisplaysForItems(itemIds)` | 集合化批量读模型；逐 Item 只根据结构化 Application/Method/Version/Tombstone 返回既有显示 Contract。不得 N+1 地以标题或时间补关系。 |

### 关键语义

1. Method、Evidence、Version、Application 和 Tombstone 的关系只由现有 ID / version 结构化字段建立。
2. `method_evidence.method_id`、`method_applications.method_id` **不得**对 `methods` 设置硬外键：Method 正文永久清理后，这些历史记录需由 Tombstone 解释。
3. `method_versions.method_id` 同样不设 Method 外键：永久清理时版本先被显式删除，不能把生命周期交给 cascade。
4. 形成、验证、修订均必须先证明真实 Review 存在；不存在 Review 统一拒绝：

   ```text
   关联复盘不存在
   ```

5. 当前 Method 不存在或在回收站时，验证 / 应用创建统一拒绝：

   ```text
   选择的方法不存在
   ```

---

## 【Schema 与 Migration 策略】

### 唯一允许的 M3 migration

```text
migrations/003_method_lifecycle_constraints.sql
```

该 migration 只允许补足 Contract 已有约束与关联读取索引：

```sql
ALTER TABLE method_evidence
  ADD UNIQUE KEY method_evidence_method_review_unique (method_id, review_id),
  ADD KEY method_evidence_review_id_idx (review_id),
  ADD CONSTRAINT method_evidence_review_fk
    FOREIGN KEY (review_id) REFERENCES reviews(id);

ALTER TABLE method_versions
  ADD KEY method_versions_source_review_id_idx (source_review_id),
  ADD CONSTRAINT method_versions_source_review_fk
    FOREIGN KEY (source_review_id) REFERENCES reviews(id);

ALTER TABLE method_applications
  ADD UNIQUE KEY method_applications_item_id_unique (item_id),
  ADD KEY method_applications_method_version_idx (method_id, method_version);
```

约束解释：

- `method_evidence(method_id, review_id)` 与既有 Repository 的“同一复盘不能重复验证同一方法”一致。
- Evidence / Version 对 Review 使用默认 `RESTRICT` 外键；Review 清理必须显式先删除 Evidence、并在必要时显式清空 `source_review_id` 或删除 Version。
- Application 只允许一个 Item 一个方法应用，匹配现有 Contract 和备份校验。
- **不**新增 Method 外键、cascade、trigger、业务字段或新的备份集合。

### Migration 执行与失败策略

- 仅 migrator 身份执行；app 用户无 DDL。
- 复用 M1 checksum、advisory lock、版本顺序与 fail-fast 机制。
- migration 前，M3 集成测试应使用干净随机临时 database；对于长期候选库，执行前必须先做预检：重复 Evidence、重复 Application Item、断裂 Review 引用均应使 migration 停止而不是静默修复。
- MySQL DDL 有隐式提交；不承诺 rollback。失败时不得写成功的 `schema_migrations` 记录，不得编辑已执行 migration；采用人工诊断与前向修复 migration。

---

## 【事务、锁与永久清理策略】

### 通用锁规则

所有多表写入必须通过 app pool 的 `runInMySqlTransaction()`：

- 锁定目标 `methods`、`reviews`、`items` 使用 `SELECT ... FOR UPDATE`；
- 对可能冲突的 Evidence / Application / Version 关系，在同一事务内查锁或依赖唯一约束后捕获并翻译稳定错误；
- 读取模型使用单一只读一致性事务；批量来源显示不可跨多次随意读造成混合快照；
- 所有 SQL 参数化；不得读取事务外旧对象后覆盖写入。

### 方法创建与验证

```text
createFromReview
锁 Review
→ 校验输入
→ INSERT Method(v1)
→ INSERT MethodVersion(v1, sourceReviewId)
→ INSERT MethodEvidence(formation, v1)
→ COMMIT
```

```text
validateFromReview
锁 Method + Review
→ Method 活跃、Review 存在、Evidence 未重复
→ revision：UPDATE Method + INSERT Version
  或 validation：UPDATE validationCount
→ INSERT Evidence(validation/revision)
→ COMMIT
```

任一失败时 Method、Version、Evidence、计数和正文均回滚。

### Method trash / restore

```text
moveToTrash：锁 Method → 必须活跃 → 更新 deleted_at / updated_at → COMMIT
restore：锁 Method → 必须 deleted_at 非空 → 清 deleted_at / 更新 updated_at → COMMIT
```

不改写 Version、Evidence、Application 或 Tombstone。

### Method 永久清理

对过期回收站 Method，事务内：

```text
锁 Method
→ 锁 / 读取其 Versions、Applications、Evidence、既有 Tombstone
→ 检查每个 Application.methodVersion 均存在于当前 Versions
→ 否则拒绝：方法应用引用了无法证明的历史版本
→ INSERT Tombstone(methodId, 当前 title, versions[])
→ DELETE MethodVersions
→ DELETE Method
→ COMMIT
```

- Evidence、Application 是历史事实，永久清理 Method 时**保留**。
- Tombstone 与删除正文 / Version 必须全有或全无。
- 若 Tombstone 已存在、Method 不存在、重复清理或版本无法证明，必须 fail-safe，不覆盖墓碑。

### Item / Review 永久清理：M3-B 对 M2-A 的受控升级

M2-A 的“存在方法关联则安全拒绝”在 M3-B 后由完整编排替代；不得两种策略共存。

对每个过期软删除 Item，在同一事务中锁 Item、Review、关联 Evidence / Applications / Versions：

1. 收集该 Item 的 Review ID、Item Application、Review Evidence 和 `source_review_id` Version；
2. 删除与这些 Review / Item 有关的 `item_links`，以及该 Item 的状态事件；
3. 删除该 Item 的 MethodApplication；
4. 删除这些 Review 的 MethodEvidence；
5. 对受影响 Method：
   - 若剩余 Evidence 和 Application 都为零：删除其所有 Version 与 Method；
   - 若仍有任一历史 Evidence/Application：只把待删 Review 指向的 `MethodVersion.source_review_id` 设为 `NULL`；
6. 对每个 Tombstone：仅当其 Method ID 已无 Evidence 且无 Application 时，删除该 Tombstone；
7. 删除 Review；
8. 删除 Item。

每步均在一个 MySQL DML transaction 内；任一约束、SQL 或测试注入失败，完整业务快照必须恢复。不得使用 `CASCADE`、`FOREIGN_KEY_CHECKS = 0`、标题推断或半清理。

### Review 删除

`MySqlReviewRepository.delete()` 的 M2-B 安全拒绝在 M3-B 保持：只要 Evidence 或 Version-source 存在，即拒绝：

```text
复盘存在方法关联，暂不能删除
```

M3 不把单独 Review 删除扩张成跨对象清理入口；完整方法关系清理只由 Item 永久清理编排处理。

---

## 【墓碑与可信降级策略】

### 墓碑创建和保留

`method_tombstones` 仅在 Method 永久清理时创建，字段来自被删除 Method 的真实 title 与已验证 Version 列表：

```text
method_id
+ title
+ permanently_deleted_at
+ versions: [{ version }]
```

墓碑不得由当前标题、应用文案、时间或版本计数猜测生成。

### 可用性降级

对 Application 的 `(methodId, methodVersion)`：

| 结构化事实 | Contract 状态 |
|---|---|
| Method 活跃且 Version 存在 | `available` |
| Method 在回收站且 Version 存在 | `method-in-trash` |
| Method 不存在，Tombstone 包含该 version | `method-purged` |
| Method / Version 缺失但无法由墓碑证明 | `unavailable`，按缺失对象给出既有 reason |
| 无 Application | `no-association` |

标题只可来自真实 Method、真实 Version 或真实 Tombstone；Method 与 Version 均缺失时 `unavailable` 不得伪造 title。

### 墓碑最终清理

墓碑不是 Item purge 的独立阻断条件。仅在同一 Method ID 已无任何 `method_evidence` 且无任何 `method_applications` 时，才可在 Item 永久清理事务内删除墓碑。

---

## 【BackupData 映射与原子恢复约束】

M2-B 的 `MySqlBackupRepository` 继续为唯一 Backup Repository；M3 不得改 JSON 文档、`parseAndValidate()`、v1/v2 规则或 `system_metadata` 边界。

| 集合 | 表 | M3 约束 |
|---|---|---|
| `methods` | `methods` | 当前正文、version、validationCount、deletedAt 完整保留。 |
| `methodVersions` | `method_versions` | Method 必须存在；sourceReviewId 已由 parser 受限归一化后才写入。 |
| `methodEvidence` | `method_evidence` | Method 可为 active 或 Tombstone；Review 必须存在。 |
| `methodApplications` | `method_applications` | Item 必须存在；Method active 或 Tombstone；Version 必须由 Method Version 或 Tombstone versions 证明。 |
| `methodTombstones` | `method_tombstones` | 不得与 active Method 同 ID；versions 必须有效。 |

`replaceData()` 继续：

```text
parseAndValidate
→ app 用户单一 DML transaction
→ DELETE：links / events / applications / evidence / versions / tombstones / reviews / methods / items
→ INSERT：items / methods / reviews / versions / evidence / applications / tombstones / links / events
→ COMMIT
```

补充约束：

- 003 外键要求 Reviews 在 Evidence / Version 之前写入，顺序已满足；清理时 Evidence / Version 在 Review 之前删除，顺序已满足。
- 不使用 `TRUNCATE`、`FOREIGN_KEY_CHECKS = 0`、root 或 migrator 写业务数据。
- `system_metadata` 永不参与以上 DELETE / INSERT / export。
- 导出必须对 Method 生命周期集合维持确定性排序：Method、Evidence、Application 按主键；Version 按 `method_id, version, id`；Tombstone 按 `method_id`。

---

## 【M3 分段实施任务书】

### M3-A：Method / Version / Evidence 基础生命周期

允许：

```text
003 migration
MySqlMethodRepository：createFromReview、list、listDeleted、listByReviewId、listVersions、listEvidenceDetails、moveToTrash、restore、validateFromReview
```

必须：

- 创建 / 验证 / 修订先锁并验证真实 Review；
- 实证 Method、Version、Evidence 的单一事务回滚；
- 实证重复 `(methodId, reviewId)` 证据拒绝；
- 不实现 Method purge、Application、Item purge 升级或 Backup 改造。

**M3-A 退出门：** 003 在真实临时 MySQL database 的最小权限 migrator 下成功；全部基础生命周期 P0 测试通过；QA 通过并经架构审阅，才可 M3-B。

### M3-B：Application、Tombstone 与永久清理编排

允许：

```text
MySqlMethodApplicationRepository 全 Contract
MySqlMethodRepository.purgeDeletedBefore
MySqlItemRepository.purgeDeletedBefore 的 M3 生命周期编排替代
```

必须：

- Application 创建 Item、初始事件、Application 同一事务；
- Method purge 的 Tombstone 与正文 / Version 删除同一事务；
- Item purge 实现本文的跨对象清理顺序；
- 不实现独立 Review 的跨对象强制清理。

**M3-B 退出门：** 完整清理交错、墓碑降级、错误版本拒绝和所有失败注入均经 QA 验证；架构审阅后才可 M3-C。

### M3-C：方法生命周期 BackupData 等价性

允许：

```text
仅 packages/storage-mysql 的必要映射补正
仅 mysql-m3c 集成测试与文档
```

必须：

- 九集合含完整生命周期关系的 `parse → replace → export` 规范化等价；
- v1 / v2 兼容、必填引用拒绝、可选 sourceReviewId 受限清空；
- 末端失败全量 rollback，metadata 真实值不变。

**M3-C 退出门：** M1–M3 定向真实 MySQL 集成、IndexedDB 回归、typecheck、全量 test、build:h5、diff check 均通过；QA 通过后交架构最终封板。

---

## 【自动化测试矩阵与验收门】

| 切片 | 必测证据 |
|---|---|
| M3-A 创建 | 空标题 / applicable / steps 拒绝；不存在 Review 零写入；Method + v1 + formation Evidence 全有或全无。 |
| M3-A 验证修订 | 活跃 Method / Review 锁定；validation 计数；revision 新版本；重复 Evidence 拒绝；任一 SQL 失败完整回滚。 |
| M3-A 读取 | 活跃 / 回收站 list；按真实 Evidence 的 review list；Versions 有序；Evidence detail 对缺失 Review/Item 的固定可信降级。 |
| M3-B 应用 | 当前 Method / Version 真实读取；创建 Item / 事件 / Application 原子性；重复 Item Application 拒绝。 |
| M3-B 墓碑 | 版本可证明时创建 Tombstone；保留 Evidence/Application；无法证明 Application version 拒绝且零变化；purged / trash / unavailable 状态逐项测试。 |
| M3-B Item purge | Application、Evidence、Version-source、links、events、review、method、version、tombstone 的正向和交错路径；中途失败全快照回滚。 |
| M3-B Review delete | 两类关联拒绝、无关联删除正向路径、完整零副作用。 |
| M3-C Backup | 全生命周期九集合 v2 等价；v1 兼容；非法必填引用 / Method-Tombstone 冲突 / 错误 tombstone version / 重复 application Item 拒绝；末事件失败回滚；metadata 隔离。 |
| 全程 | app DML-only；migrator 003 DDL only；真实随机临时 database；无 `.env` 时明确 skip，不作为通过。 |

失败注入仅允许测试专用临时 trigger 或受控 Repository test hook；必须在 `finally` 清理。每个 rollback 断言必须比较完整受影响业务快照，不得只检查单表。

---

## 【允许修改的文件或层】

### M3-A 当前授权范围（待本任务书确认后）

```text
migrations/003_method_lifecycle_constraints.sql
packages/storage-mysql/**
tests/mysql-m3a*.test.ts 或 tests/mysql-m3*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

### M3-B / M3-C

仅在前一切片 QA + 架构通过后，另行授权同一范围中必要部分。

---

## 【明确禁止事项】

```text
completeReview / ReviewWorkflowRepository.complete
派生事项、ItemLink 新写入流程
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
Application 运行组合切换
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
004 或额外 Schema migration
修改既有 Contracts、BackupData、JSON format 或 v1/v2 语义
删除或改造 SQLite 实验资产
Kubernetes、云端同步、远程访问或协作
```

---

## 【风险与保护策略】

1. **M3 触及跨对象清理。** 这是最高风险路径；M3-B 前 M2-A 的安全拒绝继续有效，M3-B 后必须整体替换为已测试的完整事务编排，不得局部放开。
2. **数据库约束不是生命周期引擎。** 外键保护必填 Review 引用，不能取代 Tombstone、Evidence/Application 保留或显式清理顺序；禁止 cascade。
3. **锁顺序必须一致。** 多对象事务统一以 Item → Review → Method → Version/Evidence/Application → Tombstone 的顺序锁定，降低死锁；遇 deadlock 只将错误上抛给候选测试，不自动重试并伪造成功。
4. **Method 与 Tombstone 互斥。** 导入与生命周期写入均不得覆盖已有 Tombstone 或让两者并存。
5. **备份解析仍是边界。** Repository 只持久化经过 `parseAndValidate()` 的结构化事实，不承担补关系、猜关系或修复非法备份的职责。
6. **MySQL 候选通过不等于运行切换。** 当前业务工作台仍只使用 IndexedDB。

---

## 【M4 前置条件】

只有 M3-C 封板后，产品经理才可发起 M4“完整 Review Workflow 候选实现”评审。M4 必须重新冻结：

```text
completeReview 的全对象事务边界
Review + Method + Evidence + Version + Application + 派生 Item + ItemLink + 状态事件
失败回滚与用户意图保护
是否存在真实产品需求
```

M3 通过不授权 M4 代码，更不授权前端或主库切换。

---

## 【交付给数据 / Application / Repository 工程师的实施任务书】

### 当前任务：仅 M3-A

1. 新建并验证 `003_method_lifecycle_constraints.sql`，严格只含本文指定约束 / 索引；不得改已执行 migration。
2. 在 `packages/storage-mysql/**` 实现 M3-A 范围内的 `MySqlMethodRepository`。
3. 所有形成、验证、修订在 app 用户单一 DML transaction 中锁定真实 Review 和 Method；失败完整 rollback。
4. 新增真实随机临时 MySQL database 集成测试，覆盖 M3-A 矩阵和 migration 权限边界。
5. 不实施 Application、Tombstone purge、Item purge 升级、Backup 改造、前端/API 或 M4。
6. 完成后运行并报告：

   ```text
   corepack pnpm -C Knowledge_Base test --run <M3-A tests>
   corepack pnpm -C Knowledge_Base typecheck
   corepack pnpm -C Knowledge_Base test
   corepack pnpm -C Knowledge_Base build:h5
   git -C Knowledge_Base diff --check
   ```

7. 每轮工程验证后追加 `docs/daily-contributions/YYYY-MM-DD.md`。

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，但仅限 M3-A。**
