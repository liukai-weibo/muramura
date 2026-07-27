# MySQL 快速接入 Sprint 产品验收与封板结论

> 封板日期：2026-07-24
>
> 结论：**通过并封板。**
>
> 依据：`当前运行事实.md` 与集中 UAT 结论。

## 【验收结论】

MySQL 快速接入 Sprint 已完成 H5 → loopback API → Application → MySQL 的端到端闭环验证，并正式封板。

本次验收不以单元测试或 API 返回代替浏览器验证；所有破坏性验证均在隔离的 `knowledge_base_uat` 完成，未触及日常 `knowledge_base`。

## 【通过的验收场景】

1. 浏览器完整主流程

- H5 创建事项；
- 保存补充说明；
- 开始执行；
- 完成复盘；
- 刷新后读取事项、补充说明、复盘与状态事实一致。

2. JSON 导出、清库与恢复

- 从 UAT 导出 JSON；
- 受限 reset 仅清理 `knowledge_base_uat`；
- 恢复后通过 H5 与 API 核对业务事实；
- 日常 `knowledge_base` 未被清理、恢复或测试脚本触及。

3. 重启与故障恢复

- 唯一 MySQL 容器重启期间，H5 对真实 `MYSQL_UNAVAILABLE` 正确降级而非伪空态或伪成功；
- 服务恢复后 H5 可重新读取既有数据；
- 最小新增写入刷新后仍持久化；
- 关键节点 API 与 H5 `/health` 均确认 `database = knowledge_base_uat`。

4. 既有 P1 写入失败阻断

- API 故障时复盘不伪成功；
- 编辑器和用户当前草稿保留；
- API 恢复后可在同一浏览器会话直接重提；
- 成功后状态为 `reviewed`，且不产生新的 `waiting_review`；
- API 再重启后复盘和状态事件保持一致。

## 【隔离与边界确认】

- 验收入口仅为 `http://127.0.0.1:10086`，API 仅为 `http://127.0.0.1:32146`；
- 验收实际数据库为 `knowledge_base_uat`；
- 日常 `knowledge_base`、`mysql-data`、IndexedDB 与 SQLite 均未被本次破坏性操作触及；
- H5 业务读写未使用 IndexedDB fallback、双写、同步或回填；
- 未发现 P0 或 P1。

## 【封板范围】

本 Sprint 至此完成 MySQL 作为当前 H5 唯一运行主库的验证与确认。

后续新增能力必须继续通过 H5 → API → Application → MySQL 的既有分层实现；不得重新引入 IndexedDB / MySQL 双写、同步、回填、fallback、合并展示或浏览器直连 MySQL。

## 【后续流转】

探索主线 V1 的产品、API、设计与封板后实施任务书已冻结。MySQL Sprint 封板后，探索主线编码禁令解除；允许数据 / Application / Repository 工程师严格按 S1 → S2 → S3 实施任务书启动 S1。

前端仍不得提前实施，须等待 S1–S3 的结构化能力、Backup V3、API 契约测试完成后，再按冻结设计接入。
