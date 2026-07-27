# SQLite 主库迁移 — S4 定向补测与稳定审阅前置条件

> 状态：**S4 核心实现具备稳定审阅条件，但不予封板、不进入 S5，直至完成本文件列明的最小补测。**
>
> 当前唯一运行主库仍是 IndexedDB；SQLite 仅为临时合成数据自动化中的候选数据层。
>
> 关联：`docs/architecture/SQLite主库迁移-S3稳定审阅与S4开工决策.md`。

## 【技术结论：有条件可行，需补测试证据】

审阅确认，`SqliteReviewWorkflowRepository.complete()` 的核心闭环确实位于单个 `runInTransaction()` 中，且已通过最终 `reviewed` 状态事件失败时的完整 `BackupData` 回滚测试。

`SqliteSearchRepository` 与 `SqliteDashboardRepository` 也确实以只读 transaction 查询结构化 SQLite 记录，并在活跃 Item / Method 查询上使用 `deleted_at IS NULL`。

但当前自动化仍缺少两类**明确、可复现、全量无副作用**的边界证据。它们不能用“实现阅读可推断”替代，因此必须在 S4 封板前补齐；这不是扩大 S4，而是完成已有 S4 验收标准。

## 【已确认的 S4 事实】

### 1. 复盘闭环原子性

`complete()` 在同一个 SQLite write transaction 内完成：

```text
读取并校验 waiting_review 的活跃 Item
→ 校验未完成过 Review 且方法选择不冲突
→ 写 Review
→ 形成或验证 / 修订 Method
→ 可选创建派生 Item、初始事件与 ItemLink
→ waiting_review → reviewed
→ 写唯一 reviewed 状态事件
→ commit
```

最终状态事件写入失败时，已用 trigger 验证完整 `BackupData` 前后相等。该结论成立。

### 2. Search / Dashboard 的活跃对象边界

当前实现：

```text
Search Item：items.deleted_at IS NULL
Search Method：methods.deleted_at IS NULL
Dashboard Item：items.deleted_at IS NULL
Dashboard Method：methods.deleted_at IS NULL
```

Review 搜索还要求其 `itemId` 出现在活跃 Item 集合中。因此回收站 Item 的 Review 不应作为活跃事项上下文呈现。

这属于正确实现方向，但仍需独立自动化证明。

## 【S4 封板前必须补齐的测试】

只允许修改 `tests/sqlite-s4.test.ts` 或等价 SQLite S4 定向测试文件；除非补测暴露真实实现缺陷，否则不应修改业务实现。

### A. `existingMethod` 拒绝路径：完整 BackupData 零变化

每个子场景必须在调用前导出 `BackupData`，调用失败后再次导出，并进行完整深比较：

1. 方法 ID 不存在：
   ```text
   waiting_review Item
   + existingMethod.methodId = missing
   → throw "选择的方法不存在"
   → BackupData 完全不变
   ```
2. 方法已在回收站：
   ```text
   waiting_review Item
   + 已移入回收站的 existingMethod.methodId
   → throw "选择的方法不存在"
   → BackupData 完全不变
   ```
3. 异常 / 已污染数据中的重复证据：
   - 使用受控 SQL 准备一个与本轮将要创建的 Review ID 存在重复 `(method_id, review_id)` 的情形，或以等价可触达路径验证唯一约束失败；
   - 断言整个 `complete()` rollback，而不只是方法写入失败；
   - 不得为测试新增不真实业务字段、放宽唯一约束或改变 Contract。

若第三项无法在不破坏 `createId()` 不可预测性的前提下可信构造，必须记录其不可达原因，并改为注入 `method_evidence` 最终写入失败的 SQLite trigger：

```text
Review 已写入后，MethodEvidence INSERT 失败
→ Review、Method、Version、派生 Item、ItemLink、Item 状态、事件整体 rollback
```

这比伪造不可达“重复同一新 Review 证据”更真实，也能直接证明目标 P0 原子性。

### B. 回收站对象的 Search / Dashboard 可见性

必须单独断言：

1. 回收站 Item：
   ```text
   搜索其 title/content
   → 不返回 item 结果

   Dashboard snapshot
   → 不包含该 Item
   ```
2. 活跃 Method：
   ```text
   搜索其唯一词
   → 返回 type = method 的当前方法结果
   ```
3. 回收站 Method：
   ```text
   搜索仅存在于该方法正文的唯一词
   → 不返回当前活跃 method 结果

   Dashboard snapshot
   → 不包含该 Method
   ```
4. 历史版本的既有搜索规则应继续保持；测试需区分：
   ```text
   活跃 Method 当前正文
   与
   MethodVersion 历史正文
   ```
   不得因排除回收站当前方法而误删合法历史版本检索语义。

## 【固定边界】

补测期间禁止：

```text
进入 S5
Local API、前端或 Application 运行时接入
真实 JSON 迁移、真实个人数据导入
IndexedDB / SQLite 双写或主库切换
新增 Schema、Migration、业务字段或 Backup 格式
```

SQLite 的定位仍是：

```text
IndexedDB = 当前唯一运行主库
SQLite    = 候选数据层
```

## 【验收与后续流转】

数据层完成补测后，需重新运行至少：

```sh
corepack pnpm -C Knowledge_Base test --run tests/sqlite-s4.test.ts
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base build:h5
git -C Knowledge_Base diff --check
```

按项目规则，在每轮工程验证后更新：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

补测通过后流转：

```text
数据 / Application / Repository 工程师
→ QA 定向复验
→ 架构师 S4 稳定审阅
→ 决定 S5 开工
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限补齐上述 SQLite S4 定向自动化测试；发现真实失败时，允许做最小根因修复。**
