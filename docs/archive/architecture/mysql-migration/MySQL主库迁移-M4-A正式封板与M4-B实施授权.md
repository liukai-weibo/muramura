# MySQL 主库迁移 — M4-A 正式稳定审阅、封板与 M4-B 实施授权

> 状态：**M4-A 已正式封板；M4-B 获得受限实施授权。**
>
> 本授权不改变运行主库。IndexedDB 仍是唯一运行主库；MySQL 仍仅为开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：通过】

M4-A 已满足退出门。`MySqlReviewWorkflowRepository` 在不调用公开 Repository 写方法拼接事务的前提下，使用单一 app 用户 MySQL DML transaction 完成无方法、无派生事项的 ReviewWorkflow 候选闭环：锁定 Item 与既有 Review、写入 Review、将原 Item 从 `waiting_review` 迁移至 `reviewed`、写入最终状态事件并整体提交。

QA 已以九集合完整快照证明前置失败、Review 插入失败、Item 更新失败、最终事件写入失败和 COMMIT 前连接中断均无副作用；同一 Item 并发双请求至多一方成功，最终仅保留一个 Review 与一条最终 `reviewed` 状态事件。

M1～M4-A 串行真实 MySQL 回归 7 个文件、45 项测试通过，及 typecheck、全量 test、build:h5、`git diff --check` 均通过。既有 H5 包体积与 Webpack cache 告警不涉及本切片事务语义，不构成封板阻断。

## 【M4-A 是否封板】

**是，正式封板。**

M4-A 封板范围：

```text
MySqlReviewWorkflowRepository 的无方法、无派生事项 completeReview 路径
Review / 原 Item reviewed / 最终 ItemStatusEvent 单一 transaction 原子性
前置校验、重复 Review、并发双请求与阶段失败的零副作用
M4-A 不支持方法关联或派生事项的稳定拒绝
```

M4-A 不包含方法形成、验证、修订、派生事项、ItemLink 或 BackupData 回归。

## 【是否书面授权 M4-B】

**是，授权。**

M4-B 只能在已封板的 M4-A Workflow transaction 内增加：

```text
method 形成
existingMethod 验证
existingMethod revision
```

并且必须与 Review、原 Item `waiting_review → reviewed` 状态更新及最终状态事件保持单一 MySQL DML transaction 的全有或全无。

M4-B 完成后必须先通过 QA 与架构稳定审阅，方可实施 M4-C。不得把 M4-B 与派生事项、ItemLink 或 BackupData 验证并行混做。

## 【M4-B 最小允许修改层】

```text
packages/storage-mysql/src/review-workflow-repository.ts
packages/storage-mysql/src/index.ts
  （仅既有导出或测试组装所必需的最小调整）
tests/mysql-m4b*.test.ts 或 tests/mysql-m4*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

禁止修改：

```text
migrations/**
packages/contracts/**
packages/application/**
apps/client/**
packages/storage-mysql/src/backup-repository.ts
MySqlItemRepository、MySqlReviewRepository、MySqlMethodRepository 的公开 Contract
```

若 Workflow 所需语义无法在现有 Schema、Contract 或 transaction-scoped helper 内表达，必须停止并回流产品经理、架构师；不得自行新增 migration、字段、索引、幂等键或业务对象。

## 【M4-B 事务、锁与写入要求】

所有读写必须继续使用 M4-A 的**同一个 transaction connection**；不得在 Workflow 内调用会重新开启 / 获取独立 transaction 的公开 Repository 写方法。

固定顺序：

```text
original Item
→ existing Review
→ existing Method
→ MethodVersion / MethodEvidence
→ Review INSERT
→ Method / Version / Evidence 写入
→ original Item reviewed UPDATE
→ original Item final status event INSERT
→ COMMIT
```

实现可在同一 transaction 内先写 Review，以满足 M3 Schema 003 的 `method_evidence.review_id` 与 `method_versions.source_review_id` Review 外键；锁定和校验必须发生在写入前。任何 SQL 失败均必须由 transaction 回滚，不得使用补偿删除、`CASCADE`、`TRUNCATE`、`FOREIGN_KEY_CHECKS = 0` 或事务外状态修复。

### 形成 `method`

```text
校验 method 与 existingMethod 互斥
→ trim 并校验 title / applicable / steps
→ INSERT Review
→ INSERT Method v1
→ INSERT MethodVersion v1(sourceReviewId = Review)
→ INSERT MethodEvidence(formation, v1)
→ UPDATE original Item reviewed
→ INSERT final status event
→ COMMIT
```

### 验证 `existingMethod`

```text
锁活跃 Method
→ 校验 Method 存在且未删除
→ 锁 / 检查 (methodId, reviewId) Evidence 不重复
→ INSERT Review
→ UPDATE Method validationCount + 1
→ INSERT MethodEvidence(validation, current version)
→ UPDATE original Item reviewed
→ INSERT final status event
→ COMMIT
```

### 修订 `existingMethod.revision`

```text
锁活跃 Method
→ 校验修订输入
→ INSERT Review
→ UPDATE Method 正文、validationCount + 1、version + 1
→ INSERT MethodVersion(new version, sourceReviewId = Review)
→ INSERT MethodEvidence(revision, new version)
→ UPDATE original Item reviewed
→ INSERT final status event
→ COMMIT
```

方法、版本、证据只可由用户明确输入及现有结构化 ID / version 关系建立；不得根据标题、时间、文案、版本号、计数或相似性猜测关系。

## 【M4-B 失败回滚与并发要求】

M4-B 必须对每种方法路径，在以下每个阶段提供受控失败注入并比较**完整九集合业务快照**：

```text
Review INSERT
Method INSERT / UPDATE
MethodVersion INSERT
MethodEvidence INSERT
original Item reviewed UPDATE
original Item final ItemStatusEvent INSERT
COMMIT 前连接失败
```

快照至少覆盖：

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

必须证明：

1. 任一失败后，不存在半完成 Review、Method、Version、Evidence 或 `reviewed` 状态 / 事件；
2. 验证 / 修订不存在或在回收站的 Method，稳定拒绝 `选择的方法不存在` 且零副作用；
3. `method` 与 `existingMethod` 同时传入，稳定拒绝 `不能同时形成新方法和验证已有方法` 且零副作用；
4. 无效新方法 / 修订输入稳定拒绝 `请完成方法标题、适用情况和具体步骤` 且写 SQL 前零副作用；
5. 同一 Item 并发双请求至多一次完整提交；未成功请求不得创建任何方法事实；
6. 旧 MethodVersion 不被修订覆盖，Evidence 必须记录真实 reviewId、relation 和 methodVersion。

现有 Contract 没有 requestId / idempotency key。不得新增自动重试或“未知提交结果返回已有成功结果”的语义；网络异常、死锁或驱动异常必须明确抛出，不能伪装为成功或空态。

## 【M4-B 验收门】

QA 必须在真实随机临时 MySQL database 中验证：

```text
形成、验证、修订、无方法关联路径
→ Review、Item、最终状态事件及方法事实完整一致

每一跨对象写入阶段失败
→ 九集合完整快照与执行前完全一致

M1～M4-B 串行真实 MySQL 回归
→ 通过

无 .env
→ MySQL 集成测试明确 skip 且不连接 MySQL

typecheck / 全量 test / build:h5 / git diff --check
→ 通过
```

QA 通过后必须回流架构师进行 M4-B 稳定审阅。未获该审阅前，M4-C 不得开始。

## 【M4-C 前持续冻结】

```text
newIdeas 派生事项
ItemLink
M4-C BackupData 回归
Application 运行组合切换
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
新增或修改未经独立评审的 migration
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**是，仅限 M4-B 已授权范围。** 完成后流转 QA；QA 通过后回流架构师。MySQL 仍是候选 Repository，IndexedDB 持续是唯一运行主库。
