# MySQL 主库迁移 — M2-B 最终稳定审阅与封板结论

> 状态：**M2-B 已封板。后续阶段必须重新经过产品授权与架构冻结。**
>
> 本封板不改变运行主库。IndexedDB 仍为唯一运行主库；MySQL 仅是经候选 Repository 合成测试证明的数据层。

## 【架构结论：通过】

此前阻断 M2-B 封板的 IndexedDB 状态历史排序 P1 已按分流裁决完成最小修复，并补齐同毫秒、跨 Item 隔离、旧备份兼容和 Sprint 11 回归证据。

M2-B 的 Review 与 Backup 候选实现、`system_metadata` 私有隔离及 MySQL 事务回滚证据均持续成立。因此 M2-B 的阶段门槛已关闭。

## 【IndexedDB P1 封闭确认】

`IndexedDbItemRepository` 当前为同一 Item 的新状态事件分配单调 `createdAt`：

```text
读取该 Item 的最大事件 createdAt
→ 物理当前时间更晚：使用当前时间
→ 否则：最大时间 + 1ms
```

确认：

- `create`、`changeStatus`、`startExecution` 保持既有 Item 与状态事件的单一 IndexedDB transaction。
- 单一 Item 在同毫秒连续流转仍按真实发生顺序持久化和读取。
- 不同 Item 的时间补偿相互独立。
- 旧 BackupData 中已有同毫秒事件不被重写、不增加字段、不修改 JSON 格式；读取时以 `createdAt ASC, id ASC` 提供确定性兜底。
- `tests/sprint-eleven.test.ts` 已恢复通过。

## 【M2-B 封板范围】

已确认：

```text
MySqlReviewRepository 基础 Contract
→ Review 创建、读取、唯一 Item Review 约束
→ Evidence / Version-source 关联删除安全拒绝

MySqlBackupRepository
→ BackupData 九集合稳定导出
→ parseAndValidate 后的单一 DML transaction replaceData
→ 非法备份零写入
→ 最后一集合写入失败完整 rollback

002_add_system_metadata.sql
→ 私有基础设施 metadata
→ 不导出、不删除、不恢复、不覆盖
```

临时 migrator 按目标库最小 DDL / DML 权限执行 `001` / `002`；app 用户仍限于 DML。未使用 `ALL PRIVILEGES` 或 `*.*` 全局权限。

## 【封板不代表】

```text
MySQL 已成为运行主库
IndexedDB 已退出业务读写
浏览器可访问 MySQL
业务 API、前端 HTTP Client 已实现
真实数据迁移、双写、切换或回退已验证
completeReview 或方法生命周期已实现
```

上述能力均未授权。

## 【下一阶段授权规则】

M2-B 封板后**不自动进入 M3**。任何下一阶段必须先由产品经理定义真实问题、范围、非目标与验收，再由架构师冻结契约、数据语义、事务边界和测试策略。

持续禁止：

```text
Application 运行组合切换
前端切换或前端 HTTP Client
业务 HTTP API
IndexedDB → MySQL 真实迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
Kubernetes、云端同步、远程访问或协作
```

## 【下一责任岗】

**产品经理。**

## 【是否允许写代码】

**否。** 仅允许发起下一阶段的产品评审，不允许直接续写 MySQL 实现。
