# MySQL 主库迁移 — M4 架构冻结与分段实施任务书

> 状态：**架构冻结完成。暂不授权编码；产品确认后，数据 / Application / Repository 工程师仅可从 M4-A 串行实施。**
>
> M4 是“完整 ReviewWorkflow 候选实现与跨对象原子性验证”，不是 MySQL 运行接入、真实数据迁移或主库切换。

## 【技术结论：有条件可行】

现有 `CompleteReviewInput`、`ReviewWorkflowRepository`、M1～M3 MySQL Schema 与候选 Repository 已具备 M4 所需的业务对象和结构化关系。M4 可新增 `MySqlReviewWorkflowRepository implements ReviewWorkflowRepository`，以单一 app 用户 InnoDB DML transaction 等价实现当前 IndexedDB 的 `completeReview()`。

**M4 不需要 Schema / Migration。** 现有 `reviews.item_id` 唯一约束、`item_links` 外键、`item_status_events` 外键、M3 Schema 003 的 Review 外键及既有 Method 生命周期表已足以承接当前 Contract。任何发现的 Schema 缺口都必须停止实施并重新经过产品与架构评审；不得在 M4 中新增或修改 migration。

必须严格串行：

```text
M4-A：无方法关联的复盘、Review / Item / 状态事件原子闭环
→ QA + 架构审阅
→ M4-B：形成、验证、修订方法的原子闭环
→ QA + 架构审阅
→ M4-C：派生事项 / ItemLink、失败注入、重复请求与 BackupData 回归
→ QA + 架构总体封板
```

M4-A、M4-B、M4-C 不得并行混做。候选 Workflow 不得接入 Application 运行组合。

持续边界：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository，仅用于开发与合成测试
SQLite    = 保留的实验 / 测试资产
```

## 【现有 completeReview() 业务语义与调用链】

调用链为：

```text
ReviewApplicationService.completeReview(input)
→ ReviewWorkflowRepository.complete(input)
→ IndexedDbReviewWorkflowRepository.complete(input)
```

当前运行路径只绑定 IndexedDB。M4 只新增 MySQL 候选实现和合成测试；不得改动 `ReviewApplicationService`、服务组装、前端调用方或 IndexedDB 运行路径。

现有完整 Contract 语义按以下顺序表达：

```text
锁定并读取 Item
→ Item 存在、未删除且状态为 waiting_review
→ 确认该 Item 尚无 Review
→ 拒绝同时传入 method 与 existingMethod
→ 创建并校验 Review
→ 可选：形成 Method，或验证 / 修订既有 Method
→ 可选：由 Review.newIdeas 首行创建 idea_to_try Item
→ 可选：创建 Review → 派生 Item 的 derived_from_review ItemLink
→ Item 状态 waiting_review → reviewed
→ 写入 ItemStatusEvent
→ COMMIT
```

既有输入语义：

- `actualAction` 与 `result` trim 后必填，缺失时抛出 `请填写：实际行动、结果` 等既有组合错误；
- `method` 与 `existingMethod` 互斥，冲突时抛出 `不能同时形成新方法和验证已有方法`；
- 新方法标题、适用情况、具体步骤 trim 后必填，缺失时抛出 `请完成方法标题、适用情况和具体步骤`；
- `existingMethod` 只可引用活跃 Method；不存在或在回收站时抛出 `选择的方法不存在`；
- `newIdeas` trim 后仅首行、最多 120 字符作为派生 Item 标题；若全文不等于标题，全文作为派生 Item 内容；
- 无 `method`、无 `existingMethod`、无有效 `newIdeas` 均是有效复盘路径；
- 原事项最终只允许从 `waiting_review` 迁移至 `reviewed`，且必须新增对应状态事件。

## 【Contracts 与 MySQL 实现映射】

| 既有 Contract / 事实 | M4 MySQL 映射 | 冻结语义 |
|---|---|---|
| `ReviewWorkflowRepository.complete(input)` | `MySqlReviewWorkflowRepository.complete(input)` | 单一 transaction 编排；不调用事务外 Repository 公共写方法来拼接。 |
| `CompleteReviewInput` | 输入校验、参数化 SQL | 不增加 requestId、字段或新业务语义。 |
| `ReviewRepository.create` | `reviews` INSERT | 复用既有字段 trim / 必填语义；`reviews.item_id` 唯一约束为最终并发保护。 |
| `ItemRepository.changeStatus` | 锁定 `items` 后 UPDATE + `item_status_events` INSERT | 必须在 Workflow 同一 transaction 内实现，不能嵌套新 transaction。 |
| `method` 形成 | `methods` + `method_versions` + `method_evidence` | Method v1、formation Evidence 与 Review 原子写入。 |
| `existingMethod` 验证 | 锁 `methods` + `method_evidence` INSERT | validationCount +1，写 validation Evidence。 |
| `existingMethod.revision` | `methods` UPDATE + `method_versions` + `method_evidence` | 新 Version、正文和 revision Evidence 与 Review 原子写入。 |
| `newIdeas` 派生 | `items` + 初始 `item_status_events` | 派生 Item 状态固定为 `idea_to_try`；不创建 MethodApplication。 |
| `derived_from_review` | `item_links` INSERT | 仅当派生 Item 已真实创建时写入；不得新增其他 ItemLink 类型或流程。 |
| `CompleteReviewResult` | transaction 内读写对象映射 | 返回 reviewed Item、Review、可选 Method、可选 createdIdea。 |
| M3 Tombstone / Application | 只作为既有 Method 读取、活跃性与历史事实边界 | M4 不创建、删除、重建 Tombstone 或 Application；不得修改其历史关系。 |

## 【M4 最小新增能力】

允许新增：

```text
MySqlReviewWorkflowRepository
workflow 专用的 transaction-scoped SQL helper
测试专用、受控的阶段失败注入 hook
MySQL M4 集成测试和架构文档
```

不允许将 `MySqlReviewRepository`、`MySqlItemRepository`、`MySqlMethodRepository` 的公开方法在事务外串联后宣称原子。Workflow 必须持有同一 transaction connection，并在 transaction 内执行所有锁、校验、写入与映射。

## 【是否需要 Schema / Migration】

**不需要。**

已验证可复用：

```text
reviews.item_id UNIQUE
reviews.item_id → items.id FK
item_status_events.item_id → items.id FK
item_links.source_review_id → reviews.id FK
item_links.target_item_id → items.id FK
method_evidence.review_id → reviews.id FK
method_versions.source_review_id → reviews.id FK
method_evidence(method_id, review_id) UNIQUE
method_versions(method_id, version) UNIQUE
```

M4 不得添加 `004` migration、触发器、cascade、额外索引、幂等表或业务字段。MySQL DDL 不能作为解决 Workflow 原子性问题的替代品。

## 【事务边界、锁策略与幂等 / 重试策略】

### 单一事务边界

所有 M4 成功路径必须由一次 `runInMySqlTransaction()` 完成：

```text
BEGIN
→ SELECT Item FOR UPDATE
→ SELECT Review by item_id FOR UPDATE
→ 可选 SELECT Method FOR UPDATE
→ 可选 SELECT current MethodVersion / Evidence FOR UPDATE
→ INSERT Review
→ 可选 Method / Version / Evidence 写入
→ 可选 INSERT derived Item + initial event + ItemLink
→ UPDATE original Item reviewed
→ INSERT original ItemStatusEvent
→ COMMIT
```

对同一 Item 的锁顺序固定为：

```text
original Item → existing Review → Method → Version / Evidence
→ derived Item → ItemLink → original ItemStatusEvent
```

所有读取后写入均在事务内重新读取。所有 SQL 必须参数化。死锁、网络断连、约束冲突和驱动异常必须原样或经稳定业务错误翻译后抛出；不得返回空结果、`undefined` 或成功 DTO。

### 幂等与重试

现有 Contract **没有 requestId / idempotency key，也没有“同一请求重复返回首个成功结果”的语义**。M4 不得擅自增加此能力。

冻结策略：

1. 同一 Item 的第二次 `complete()`，无论串行重复或并发竞争，在第一个事务提交后必须被 `reviewed` 状态或 `reviews.item_id` 唯一约束拒绝；
2. 拒绝路径不得额外创建 Review、Method、Version、Evidence、派生 Item、ItemLink 或状态事件；
3. 客户端在网络中断后无法判断是否已提交时，不得自动重试写入；候选实现应明确暴露异常，由未来运行阶段在独立产品 / 架构范围中定义 requestId 和可恢复重试语义；
4. 测试必须覆盖同一 Item 的并发双请求：至多一个成功，另一个稳定失败，且最终只存在一组完整业务事实。

## 【派生事项与 ItemLink 的既有 Contract 边界】

派生事项和 ItemLink 是当前 `completeReview()` 已有语义，M4 必须等价实现，不是新增能力。

```text
newIdeas trim 后非空
→ 第一行 slice(0, 120) 为标题
→ 创建 idea_to_try Item
→ 创建初始 ItemStatusEvent
→ 创建 type = derived_from_review 的 ItemLink
```

限制：

- 一次 completeReview 最多创建一个派生 Item；
- 不创建 MethodApplication；
- 不读取、猜测或补造其他 ItemLink；
- 若派生标题为空，不创建 Item、事件或 Link；
- 任一派生写入失败必须回滚此前 Review、方法变化和原 Item 状态迁移。

## 【失败、回滚与可信降级策略】

每一条 Workflow 写入阶段均须由测试 hook 或临时 trigger 注入失败，包括：

```text
Review INSERT
Method INSERT / UPDATE
MethodVersion INSERT
MethodEvidence INSERT
Derived Item INSERT
Derived Item initial event INSERT
ItemLink INSERT
Original Item reviewed UPDATE
Original Item final status event INSERT
```

每个失败场景必须与执行前完整快照比较，至少覆盖：

```text
items
reviews
methods
method_versions
method_evidence
method_applications
method_tombstones
item_links
item_status_events
```

要求：

- 任一失败后九集合业务数据均回到开始前状态；
- 不得留下半完成 Review、孤儿 Evidence / Version、孤儿 Link、派生 Item 或单独的 `reviewed` 事件；
- 输入校验失败必须在写 SQL 前拒绝；
- 已删除 Item、非 `waiting_review` Item、已存在 Review、无效 / 回收站 Method、重复 Evidence、并发唯一冲突均必须明确失败，且零副作用；
- 异常不得被转换为“复盘完成”“暂无证据”“没有关联”或空数据。

## 【BackupData 与恢复验证约束】

M4 不修改 `BackupData`、`parseAndValidate()`、JSON format、version、v1/v2 兼容、九集合定义或 `system_metadata` 隔离。

M4 只补充验证：由成功 Workflow 产生的完整关系执行：

```text
exportData
→ 清空候选业务数据（仅测试控制路径）
→ parseAndValidate
→ replaceData
→ exportData
→ 既有规范化语义等价
```

同时必须确认：

- M4 成功数据中的 Review、MethodVersion、Evidence、derived Item、ItemLink、状态事件与既有结构化引用保持有效；
- 非法备份仍在 SQL transaction 前拒绝；
- `replaceData()` 末端失败仍完整回滚；
- `system_metadata` 在导出、清空恢复、非法输入和失败恢复中均不变且不出现在业务 JSON。

M4 不得借此修改 Backup Repository；若发现 M3 Backup Contract 缺陷，单独分流，不混入 M4 Workflow 实现。

## 【分段实施任务书】

### M4-A：无方法关联的复盘原子闭环

允许：

```text
MySqlReviewWorkflowRepository 骨架
completeReview 无 method / existingMethod 且无派生事项路径
Review + original Item reviewed + original status event 单一事务
输入、状态、已完成 Review、并发重复请求的拒绝测试
```

必须：

- 锁定目标 Item 与既有 Review；
- 保持 Review 写入和 `waiting_review → reviewed` 事件全有或全无；
- 覆盖 Review INSERT、Item UPDATE、最终事件 INSERT 失败注入；
- 不实现方法路径或派生事项路径。

**退出门：** 真实 MySQL M4-A 定向测试、既有 M1～M3 串行回归通过，QA 通过并经架构审阅后，方可实施 M4-B。

### M4-B：形成、验证与修订方法原子闭环

允许：

```text
M4-A Workflow 中 method / existingMethod 分支
Method、MethodVersion、MethodEvidence 的 transaction-scoped 写入
形成、验证、修订及无关联方法路径的等价测试
```

必须：

- 同一事务内形成 v1 / formation Evidence，或验证计数 / validation Evidence，或修订正文 / 新 Version / revision Evidence；
- `method` 与 `existingMethod` 互斥；
- 只引用活跃的真实 Method；
- 每个方法阶段失败均完整回滚 Review、Item 状态、状态事件及所有方法事实；
- 不实现派生事项与 ItemLink。

**退出门：** 形成、验证、修订、无方法关联、重复请求和失败注入的真实 MySQL 证据通过；QA + 架构审阅后，方可实施 M4-C。

### M4-C：派生事项、ItemLink 与 BackupData 闭环回归

允许：

```text
newIdeas 派生 Item / initial event / derived_from_review ItemLink
完整 completeReview 路径失败注入
M4 产生关系的 BackupData 导出 / 恢复等价回归
```

必须：

- 派生 Item、初始事件、ItemLink 与其他 Workflow 写入同一 transaction；
- 覆盖有 / 无派生事项、标题截断与多行内容语义；
- 末端 ItemLink、原 Item UPDATE、原 Item 最终事件失败均完整回滚；
- 只测试 BackupData 等价，不改其业务实现或语义。

**退出门：** M1～M4 串行真实 MySQL 回归、BackupData 闭环、全量工程回归均通过；QA 通过后交架构总体封板。

## 【自动化测试矩阵与验收门】

| 切片 | 必测证据 |
|---|---|
| M4-A 输入与前置 | trim、实际行动 / 结果必填、Item 不存在 / 已删除、非 waiting_review、已有 Review、并发双请求的稳定拒绝。 |
| M4-A 原子性 | Review、原 Item 状态、最终事件的每阶段失败，完整九集合快照零变化。 |
| M4-B 形成 | Method v1、Version v1、formation Evidence、Review、reviewed Item、事件整体成功；任一点失败整体回滚。 |
| M4-B 验证 | validationCount +1 与 validation Evidence；不存在 / 回收站 Method 拒绝；重复和并发路径零副作用。 |
| M4-B 修订 | 正文 / version +1、新 Version、revision Evidence 的历史正确性；旧 Version 不被覆盖。 |
| M4-B 互斥 / 无方法 | method + existingMethod 冲突拒绝；无方法关联仍可完整复盘。 |
| M4-C 派生 | 空 / 单行 / 多行 / 120 字符截断；派生 Item、初始事件、derived_from_review Link 原子一致。 |
| M4-C 故障 | Link、派生事件、原事项更新、原事项最终事件等末端失败全快照 rollback。 |
| M4-C Backup | M4 全路径数据 export → replace → export 规范化等价；非法备份、末端恢复失败与 metadata 隔离回归。 |
| 全程 | app DML-only；真实随机临时 database；无 `.env` 明确 skip；M1～前置阶段串行组合回归。 |

失败注入只可使用测试专用受控 hook 或临时 trigger，必须在 `finally` 清理。每次 rollback 断言不得只检查单张表。

## 【允许修改的文件或层】

### M4-A 初始授权范围

```text
packages/storage-mysql/src/review-workflow-repository.ts（可新增）
packages/storage-mysql/src/index.ts（仅导出或候选 Repository 测试组装所必需的最小修改）
tests/mysql-m4a*.test.ts 或 tests/mysql-m4*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

### M4-B / M4-C

仅在前一切片 QA + 架构审阅通过后，按本任务书另行书面授权同一范围的必要部分。M4-C 如仅测试而无需修复，不得修改 `packages/storage-mysql/src/backup-repository.ts`；若发现问题须独立分流。

## 【明确禁止事项】

```text
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
Application 运行组合切换
修改 packages/application/**
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
新增或修改 Schema migration
新增产品对象、字段或 Contracts 业务语义
新增 ItemLink 业务能力或类型
修改 BackupData / JSON format / v1/v2 语义
completeReview 之外的 ReviewWorkflow 扩张
删除或改造 SQLite 实验资产
Kubernetes、云端同步、远程访问或协作
```

## 【风险与保护策略】

1. **跨对象事务是 M4 的核心风险。** 任何 Workflow helper 必须共享同一个 transaction connection；禁止在 transaction 内调用会重新取得连接的公开 Repository 方法。
2. **幂等不能猜。** 没有 requestId 的 Contract 下，MySQL 只能依靠 Item 锁、状态及 Review 唯一约束实现“至多一次提交”；未知提交结果必须显式失败，不可自动重试。
3. **Review 外键顺序受 Schema 003 约束。** Review 必须先于 Evidence / Version 写入；发生异常时依靠 transaction 回滚，不靠补偿删除或关闭外键检查。
4. **派生事项不是独立流程。** 它是 Workflow 内部事实，必须和 Link、初始事件、原 Review / Item 状态同生共死。
5. **候选等价不等于运行接入。** 即使 M4 通过，也不授权 Application 组装、API、前端、迁移、双写、切换或回退。

## 【M5 进入条件】

M4 封板后**不自动进入 M5**。只有产品经理以新的真实用户问题提出范围，才可讨论后续阶段。

若拟讨论运行时接入或主库迁移，至少须重新冻结：

```text
Application 组合与依赖注入边界
API 信任边界、认证与授权
真实用户数据迁移、JSON 备份与恢复演练
单写 / 双写策略、读写切换、回退与一致性验证
网络异常、可观测性、运维和安全模型
前端降级与用户可见失败语义
```

任何 `completeReview()` 运行接入、真实迁移、双写或主库切换均不得由 M4 自动授权。

## 【交付给数据 / Application / Repository 工程师的实施任务书】

先仅实施 M4-A：

```text
1. 新增 MySqlReviewWorkflowRepository，implements ReviewWorkflowRepository；
2. 只实现无 method / existingMethod、无派生事项的 completeReview 路径；
3. 以一个 runInMySqlTransaction() 执行：锁 Item / Review、创建 Review、
   更新原 Item 为 reviewed、写最终 ItemStatusEvent；
4. 保持既有输入、状态与重复 Review 错误语义；
5. 提供测试专用阶段失败注入，证明 Review、Item、状态事件全有或全无；
6. 覆盖同一 Item 的并发双请求：至多一组完整提交；
7. 不修改既有公开 Repository Contract、Application 组装、Schema 或 BackupData；
8. 在真实随机临时 MySQL database 中验证，未加载 .env 时明确 skip；
9. 完成后流转 QA，再由架构师决定是否授权 M4-B。
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**否。** 本任务书须先由产品确认；确认后方可按 M4-A 的受限范围编码。
