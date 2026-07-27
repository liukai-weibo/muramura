# 探索主线 V1 S2：Repository / Application 与原子工作流封板结论

> 封板日期：2026-07-24
>
> 结论：**通过并封板。**
>
> 依据：`当前运行事实.md`、`../architecture/探索主线-V1-S2-RepositoryApplication与原子工作流架构任务书.md`、`../architecture/探索主线-V1-S2总体稳定复审结论与封板建议.md`。

## 【验收结论】

探索主线 V1 S2“Repository / Application 与原子工作流”已通过产品验收并正式封板。

本阶段封板确认探索主线结构化关系已经具备可信的 MySQL Repository、Application 编排、单一事务写入、结构化读模型与临时库自动化验证边界。它不等于探索主线 V1 整体完成，也未向当前 H5 或 API 暴露任何探索主线功能。

## 【通过范围】

### 原子工作流与结构化关系

- 创建事项并关联 existing Track：锁定 active Track 后，在同一 MySQL transaction 内写入 Item、初始 `ItemStatusEvent` 和关联；
- 创建事项并关联 new Track：在同一 transaction 内写入 Track、Item、初始 `ItemStatusEvent` 和关联；
- 任一插入失败、约束冲突、Event 失败或 commit 前中断均整体回滚，不留 Track、Item、Event 或关联半成品；
- 关联和读模型仅基于 `exploration_tracks.id`、`items.exploration_track_id`、`reviews.item_id`；不得基于标题、时间、文案、计数、相似度或前端状态推断。

### 软删除与不可用关联

- 已删除 Track 的关联读取固定返回 `track-deleted`，保留 Item、Track 与 `deletedAt`；
- 对已删除 Track 的关联改派或移除固定拒绝，返回稳定 `code: deleted`，且零副作用；
- `unavailable` 保留断裂 `trackId`，关联调整与移除均拒绝，不清空、替代、修复或降级为无关联；
- 所有拒绝路径均不改写关联字段、`items.updated_at`、状态事件、Track、Review、Method、Version、Evidence、Application、Tombstone 或 ItemLink。

### 回归与运行库隔离

- `test:mysql:integration` 固定使用 `vitest run --no-file-parallelism`，精确覆盖 M1–M5、API M5-B、S1、S2 共 13 个文件；
- 全量固定入口：13 files / 121 tests 通过；S2 定向：11 tests 通过；
- 验证期间 H5 `10086` 与 API `32146` 均无监听；
- `knowledge_base` 与 `knowledge_base_uat` 的 Schema、migration records、十个业务集合、`system_metadata`、稳定排序完整记录及 manifest 前后均为 `SNAPSHOTS_IDENTICAL`；
- 未执行运行库 DDL、DML、migration、restore、清库或回退。

## 【封板边界】

S2 封板不代表下列能力已完成、已上线或已获准：

```text
探索主线 V1 整体交付
Backup V3 或备份格式演进
API 路由、HTTP、DTO 映射与 unknown-outcome 运行时处理
真实 H5 数据接入、真实业务写入或控件解除禁用
S3 自动开工
```

已经获准的前端可视化原型仍只允许使用明确的原型 fixture，保持纯展示、无 API、无 MySQL、无 IndexedDB / SQLite、无浏览器持久化、无真实业务读写。不得将原型视为已交付功能。

## 【后续阶段门】

S3 不是 S2 的自然延续。若要进入 S3，产品必须独立立项并重新冻结：

1. Backup V3 与 v1 / v2 兼容、断裂关系整体拒绝和恢复原子性；
2. API 路由、DTO、稳定错误语义与 unknown-outcome；
3. 运行时接入边界与前端 fixture 替换策略；
4. 自动化测试、运行库零污染与浏览器 UAT 验收门。

在 S3 架构任务书和产品书面编码授权完成前，继续禁止 Backup V3、API、真实 H5 数据接入、解除原型控件禁用及任何 S3 代码。
