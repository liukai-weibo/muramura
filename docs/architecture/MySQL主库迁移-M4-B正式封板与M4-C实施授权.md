# MySQL 主库迁移 — M4-B 正式稳定审阅、封板与 M4-C 实施授权

> 状态：**M4-B 已正式封板；M4-C 获得受限实施授权。**
>
> 本授权不改变运行主库。IndexedDB 仍是唯一运行主库；MySQL 仍仅为开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：通过】

M4-B 已满足稳定性与数据可信性退出门。

`MySqlReviewWorkflowRepository.complete()` 已在单一 `runInMySqlTransaction()` connection 中等价实现形成、验证、修订方法路径；没有调用公开 Repository 写方法拼接多个独立 transaction。Review、Method、MethodVersion、MethodEvidence、原 Item 的 `waiting_review → reviewed` 状态迁移及最终 ItemStatusEvent 保持全有或全无。

QA 已针对 formation、validation、revision 的每个关键写入阶段和 COMMIT 前失败比较九集合完整快照，证明不存在半完成方法事实、错误 Item 状态或孤儿最终状态事件。形成路径的同 Item 并发请求也已证明至多一方完整提交。

真实 MySQL 定向回归为 1 文件、26 项通过；M1～M4-B 串行真实 MySQL 回归为 8 文件、71 项通过。无 `.env` 时 M4-B 的 26 项测试明确跳过且不连接 MySQL；typecheck、全量 test、build:h5 和 `git diff --check` 均通过。既有 H5 bundle 体积与 Webpack cache 告警不涉及本切片的数据语义或事务边界，不构成封板阻断。

## 【M4-B 是否封板】

**是，正式封板。**

M4-B 封板范围：

```text
MySqlReviewWorkflowRepository 的 method formation 路径
existingMethod validation 路径
existingMethod revision 路径
与 M4-A Review / original Item reviewed / final status event 的单一事务闭环
方法输入、互斥输入、缺失 / 回收站 Method、失败和并发保护
```

M4-B 未包含 `newIdeas` 派生事项、ItemLink 或 M4 产生关系的 BackupData 回归。

## 【是否书面授权 M4-C】

**是，授权。**

M4-C 是 M4 的最后一个串行切片，只允许实现并验证既有 `completeReview()` 的 `newIdeas` 派生事项与 `derived_from_review` ItemLink 语义，并验证 M4 完整路径产生的既有九集合业务事实可以通过现有 BackupData 闭环保持等价。

M4-C 不新增任何产品对象、Repository Contract、BackupData 格式或运行时业务能力。它不是新的 ItemLink 能力，也不是 Backup Repository 改造阶段。

## 【M4-C 最小允许修改层】

```text
packages/storage-mysql/src/review-workflow-repository.ts
packages/storage-mysql/src/index.ts
  （仅导出或候选 Repository 测试组装所必需的最小调整）
tests/mysql-m4c*.test.ts 或 tests/mysql-m4*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

默认**不得**修改：

```text
packages/storage-mysql/src/backup-repository.ts
migrations/**
packages/contracts/**
packages/application/**
apps/client/**
packages/storage-mysql 内既有 Item / Review / Method / Application Repository
```

若 M4 产生的有效业务数据不能通过既有 BackupData `export → replace → export` 等价验证，必须先定位为 M4 Workflow 写入事实、既有 parser / backup Contract 或 M3 回归中的哪一层问题；不得直接修改 Backup Repository、JSON format、v1/v2 语义或 Schema 来“修复”测试。确有 M3 Backup 缺陷时必须独立分流，不能混入 M4-C。

## 【M4-C 既有派生事项与 ItemLink 边界】

仅实现现有 `completeReview()` 已定义的语义：

```text
newIdeas trim 后非空
→ 第一行取最多 120 字符为派生事项标题
→ 创建一个 status = idea_to_try 的 Item
→ 写入该 Item 的初始 ItemStatusEvent
→ 写入 ItemLink：
  sourceReviewId = 当前 Review
  targetItemId   = 派生 Item
  type           = derived_from_review
```

以下行为必须保持：

1. `newIdeas` 为空白时，不创建派生 Item、初始事件或 ItemLink；
2. 单行内容等于标题时派生 Item 的 `content` 为空；多行时完整 trim 后文本作为 `content`；
3. 一次 `completeReview()` 最多创建一个派生 Item；
4. 不创建 MethodApplication，不读取、修改、猜测或补造其他 ItemLink；
5. 派生 Item、初始事件、ItemLink 必须和 Review、可选方法事实、原 Item 状态更新、原最终状态事件位于**同一 app 用户 MySQL DML transaction**；
6. 不得新增 ItemLink 类型、独立创建入口或新的派生事项业务规则。

## 【M4-C 事务、失败回滚与可信降级要求】

M4-C 必须沿用 M4-A / M4-B 的同一 transaction connection；不得通过公开 Repository 写方法、独立连接、补偿删除或事务外清理拼接工作流。

完整写入顺序可在满足外键条件前提下固定为：

```text
original Item / existing Review / optional Method facts
→ Review INSERT
→ optional Method / Version / Evidence writes
→ derived Item INSERT
→ derived Item initial ItemStatusEvent INSERT
→ derived_from_review ItemLink INSERT
→ original Item reviewed UPDATE
→ original Item final ItemStatusEvent INSERT
→ COMMIT
```

至少对下列阶段注入受控失败：

```text
Derived Item INSERT
Derived Item initial status event INSERT
ItemLink INSERT
original Item reviewed UPDATE
original Item final ItemStatusEvent INSERT
COMMIT 前连接失败
```

若 M4-B 方法路径与派生路径组合，须额外证明 Method / Version / Evidence 任一失败也会回滚派生 Item、Link 和所有其他 M4 事实。

每一失败场景必须比较完整九集合业务快照：

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

任何 MySQL 异常、外键 / 唯一约束冲突或连接异常均必须明确抛出；不得伪装为复盘完成、无派生事项、无关联或空数据。

## 【M4-C BackupData 验证边界】

M4-C 只验证既有能力，不修改其语义：

```text
成功的完整 completeReview（含方法路径、派生 Item、ItemLink）
→ exportData
→ 测试控制路径清空候选业务数据
→ parseAndValidate
→ replaceData
→ exportData
→ 按现有规范化排序规则等价
```

必须确认：

- Review、Method / Version / Evidence、派生 Item、两个 Item 的状态事件、`derived_from_review` Link 的结构化引用完整保留；
- 既有 v1/v2 兼容、JSON format、严格校验与九集合定义不变；
- 非法备份仍在 SQL transaction 前拒绝；
- 既有末端恢复失败完整回滚语义持续成立；
- `system_metadata` 永不出现在业务备份，不被导出、清空、恢复或覆盖，且在所有验证路径中保持原值。

## 【M4-C 自动化验收门】

QA 必须在真实随机临时 MySQL database 中确认：

1. 无方法、formation、validation、revision 四条完整复盘路径各自覆盖有 / 无 `newIdeas`；
2. 空白、单行、多行和超过 120 字符的 `newIdeas` 与 IndexedDB Contract 等价；
3. 派生 Item、初始事件、Link、Review、可选方法事实、原 Item reviewed 事件同生共死；
4. 所有 M4-C 阶段失败及 M4-B 方法阶段失败的组合均使九集合恢复到执行前完整快照；
5. 同 Item 并发请求仍至多一方成功，不出现两组派生 Item / Link；
6. 含 M4 完整关系的 BackupData 闭环等价、非法备份零写入、恢复末端失败 rollback 与 metadata 隔离回归通过；
7. M1～M4-C 串行真实 MySQL 回归、无 `.env` 明确 skip、typecheck、全量 test、build:h5、`git diff --check` 全部通过。

M4-C 完成后必须流转 QA，再回流架构师进行 M4 总体稳定审阅与最终封板。任何人不得自行宣布 MySQL 已成为主库。

## 【持续冻结边界】

```text
Application 运行组合切换
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
修改 Contracts、Schema 或 Migration
修改 BackupData format、version 或 v1/v2 语义
新增 ItemLink 类型、入口或业务能力
completeReview 之外的 ReviewWorkflow 扩张
删除或改造 SQLite 实验资产
Kubernetes、云端同步、远程访问或协作
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**是，仅限 M4-C 已授权范围。** 完成后流转 QA，再回流架构师进行 M4 最终封板判断。MySQL 仍是候选 Repository，IndexedDB 持续是唯一运行主库。
