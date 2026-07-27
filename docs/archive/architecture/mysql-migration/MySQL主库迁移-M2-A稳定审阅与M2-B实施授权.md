# MySQL 主库迁移 — M2-A 稳定审阅与 M2-B 实施授权

> 状态：**M2-A 已封板。允许数据 / Application / Repository 工程师实施已冻结的 M2-B。**
>
> 本授权不改变当前运行主库。IndexedDB 仍为唯一运行主库；MySQL 仍仅用于候选 Repository 与合成测试。

## 【架构结论：通过】

M2-A 的 `MySqlItemRepository` 已以既有 `ItemRepository` Contract 为准实现，并完成 M2-A P0 证据：状态与事件原子性、事务内行锁重读、回收站保护与永久清理的结构化关联安全拒绝均已通过审阅。

M2-A 不等于 MySQL 已可作为运行主库，也不代表 Review Workflow、方法生命周期、备份恢复或前端切换已完成。

## 【M2-A 封板确认】

### Contract 与持久化映射

- 标题、内容与启动动作符合既有 trim 语义；空标题被拒绝。
- SQL `NULL` 的 `start_action` 映射为 Contract 中缺失的 `startAction`，不伪造空字符串。
- `DATETIME(3)` 读回 UTC ISO 字符串；状态事件按 `created_at ASC, id ASC` 稳定读取。
- `create()` 以单一 DML transaction 写入 Item 与初始状态事件。

### P0 事务与交错保护

- `changeStatus()`、`startExecution()`、`updateContent()`、`delete()`、`restore()` 均在写事务内使用 `SELECT ... FOR UPDATE` 获取当前 Item。
- 状态更新、`doing`、可选 `startAction` 与状态事件没有拆分提交；事件插入失败时完整回滚。
- 内容更新不会覆盖已提交状态；删除后内容更新拒绝且不会意外复活 Item。
- purge 事务内锁定当前过期候选项；已在候选读取前恢复的 Item 不会被误清理。

### 永久清理

无方法结构化关联时，Repository 显式清理：

```text
item_links
→ item_status_events
→ reviews
→ items
```

`MethodTombstone` 无 Item / Review 结构化引用，因此孤立 Tombstone 不阻断无关联 Item 清理。

存在任一以下关联时，`purgeDeletedBefore()` 以稳定错误拒绝并整体 rollback：

```text
MethodApplication.itemId
MethodEvidence.reviewId
MethodVersion.sourceReviewId

MySQL 方法关联清理尚未实施
```

## 【是否允许实施 M2-B：允许】

允许按已冻结的 M2 任务书实施 M2-B：

```text
Review 基础持久化
+ BackupData 九集合导入导出
+ replaceData() 单一 DML transaction
+ 非法备份零写入与 SQL 中途失败回滚
+ system_metadata 与业务备份隔离
```

M2-B 仅授权上述范围；不得顺带实现 `completeReview()`、方法生命周期或任何运行时切换。

## 【M2-B 允许修改的层】

```text
packages/storage-mysql/**
migrations/002_add_system_metadata.sql
apps/api/src/migrate.ts（仅必要命令编排，不增加业务 API）
tests/mysql-m2b*.test.ts 或 tests/mysql-m2*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

唯一允许的 Schema 变化是：

```text
002_add_system_metadata.sql
```

它只能新增基础设施私有的 `system_metadata` 表；不得修改任何业务表、外键、权限、trigger、cascade 或 `BackupData` JSON 格式。

## 【M2-B 禁止边界】

```text
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
completeReview()
MethodRepository / MethodApplicationRepository 生命周期实现
Search / Dashboard
IndexedDB → MySQL 真实迁移
IndexedDB / MySQL 双写
主库切换
浏览器直连 MySQL
修改 Contracts 业务语义
修改或删除 SQLite 实验资产
额外 Schema migration
SET FOREIGN_KEY_CHECKS = 0
TRUNCATE 作为 replaceData 实现
Kubernetes、云端同步、远程访问或协作
```

## 【M2-B 风险控制】

1. `002` 是 MySQL DDL，不能承诺 rollback。必须遵循 migrator、advisory lock、checksum、fail-fast 和前向修复规则。
2. `replaceData()` 只使用 app 用户与一个 DML transaction；禁止 `TRUNCATE`，因为其隐式提交会破坏原子替换。
3. JSON 必须先经过既有 `BackupApplicationService.parseAndValidate()`；解析失败时不得调用 `replaceData()`。
4. 失败注入必须落在最后一类业务数据写入，断言完整九集合恢复为写入前快照；不可只断言一张表。
5. `system_metadata` 不属于 `BackupData`：导出、删除、导入和恢复均不得读写它；测试必须预置并断言实际值不变。
6. 无 `.env` 的集成测试跳过不能作为阶段通过证据。M2-B 交付 QA 前，必须在真实 MySQL 环境执行定向集成测试。

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限 M2-B 已冻结范围。**
