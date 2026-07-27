# 探索主线 V1 S2：Repository / Application 与原子工作流编码授权

> 授权日期：2026-07-24
>
> 结论：**有条件授权编码。**
>
> 依据：`当前运行事实.md`、`探索主线-V1-S1-Schema004与基础Contracts封板结论.md`、`../architecture/探索主线-V1-S2-RepositoryApplication与原子工作流架构任务书.md`。

## 【授权结论】

授权数据 / Application / Repository 工程师实施探索主线 V1 S2：MySQL Repository、Application 与单一 MySQL transaction 原子工作流。

授权仅限架构任务书明确的 S2 文件、层和测试范围。S2 完成不等于探索主线 V1 整体完成；不自动授权 S3、Backup V3、API、H5 或任何前端接入。

## 【允许实施的能力】

- 主线创建、改名、软删除与恢复；
- 事项的明确关联调整与移除；
- 创建事项并归入既有或新主线；
- 活跃、可选、已删除主线列表；
- 主线历史、当前关联事项与受限状态定位；
- `available`、`track-deleted`、`unavailable`、`no-association` 的结构化读取和 `unavailable` 拒绝语义。

## 【不可突破的业务与技术边界】

- 选择新主线时，Track、Item、初始 `ItemStatusEvent` 与关联必须处于同一 MySQL transaction，全部成功或全部回滚；
- 选择既有主线时，必须锁定 active Track 后才能创建关联 Item；
- 名称只能按 NFKC、trim、lower-case、Unicode code point 1..80 校验；软删除 Track 继续占用规范名；
- 关联只能基于 `exploration_tracks.id`、`items.exploration_track_id`、`reviews.item_id` 读取；
- `unavailable` 必须保留原 `trackId`，禁止清空、替代、修复、回填或伪装成无关联；
- 不新增 requestId、幂等键、自动重试、补偿写入或本地推断结果；提交结果未知时只能重新读取真实结构化事实；
- 所有 MySQL 集成测试只可使用随机临时 database、独立测试用户与 finally 清理；不得触及 `knowledge_base` 或 `knowledge_base_uat`。

## 【明确不授权】

```text
Backup V3、备份格式或 v1/v2 兼容语义
API 路由、DTO 映射、HTTP
H5 / 前端、Adapter 或交互
migrations/**、004 修改或运行库 DDL / DML
IndexedDB / SQLite
状态机、复盘、方法、回收站、ItemLink 业务语义
双写、同步、回填、fallback、浏览器直连 MySQL
自动关联、多主线、进度、计划、日期、提醒、子任务、物理清理
S3
```

## 【S2 验收与后续阶段门】

S2 交付前必须完成任务书冻结的 Contracts、Application、真实 MySQL 临时库集成测试、完整 MySQL 集成测试与运行库深度快照零污染证明。

S2 完成后，必须依次经过 QA、架构复审与产品验收。只有在 S2 通过封板并另行完成 S3 架构冻结与产品书面授权后，才可讨论 Backup V3、API 或 H5 实施。
