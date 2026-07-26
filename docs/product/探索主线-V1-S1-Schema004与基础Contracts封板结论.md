# 探索主线 V1 S1：Schema 004 与基础 Contracts 封板结论

> 封板日期：2026-07-24
>
> 结论：**通过并封板。**
>
> 依据：`当前运行事实.md`、`../architecture/探索主线-V1-S1-UAT004数据一致性后验最终复审结论与基础Contracts授权.md`、`../architecture/探索主线-V1-S1基础Contracts-P1复审结论与封板建议.md`。

## 【验收结论】

探索主线 V1 的 S1“Schema 004 与基础 Contracts”已完成并正式封板。

本结论只封板可信存储边界和静态契约边界：它不表示探索主线 V1 已整体完成、未提供任何可用业务功能，也不自动授权 S2 或任何后续编码。

## 【通过范围】

### Schema 004

- `knowledge_base` 与 `knowledge_base_uat` 均已记录并执行 `004_add_exploration_tracks.sql`，两库均为 Schema Version 4；
- UAT 的 migration record、checksum、表、列、索引、外键、幂等与 app DML-only 已验证；
- 受控 UAT v3 → v4 后验确认：Items 八个既有字段共 20 行逐行一致，新增 `exploration_track_id` 均为 `NULL`，`exploration_tracks` 为空；其余九个既有集合和 `system_metadata` 一致；
- 完整 Items dump 表示差异已明确归因于新增可空列，不视为既有业务数据变更；
- 禁止对任一运行库回退 DDL、删除 migration record、手工修表、清库或用恢复掩盖现场。

### 基础 Contracts

- `Item.explorationTrackId` 是单个可选 ID，固定表达事项对探索主线的 `0..1` 关系；
- `ExplorationTrackSelection` 只接受 `existing` 或 `new` 的用户明确选择；
- 关联上下文严格区分 `available`、`track-deleted`、`unavailable` 与 `no-association`；
- `available` 不接受 `deletedAt: string`，`track-deleted` 必须含 `deletedAt: string`；
- `unavailable` 保留非空 `trackId`，不得被降级、清空或伪装为无关联；
- 当前 TypeScript 未启用 `exactOptionalPropertyTypes`，因此 `deletedAt` 缺失和显式 `undefined` 均表示无删除时间，且不得被持久化或解释成删除事实；
- 未引入多主线、自动推断、双写、同步、回填或任何运行时能力。

### 验证证据

- Contracts 定向测试：1 file / 3 tests 通过；
- `typecheck` 通过；
- 全量测试：39 files 通过、12 skipped；193 tests 通过、110 skipped；
- `git diff --check` 通过；
- Contracts 验证轮未连接 MySQL / Docker、未启动 H5 / API、未发生运行库写入或 migration；
- 未修改 Repository、Application、API、H5、Backup V3 或后续层。

## 【封板边界】

S1 封板不等于下列任何事项已经完成或获准：

```text
探索主线 V1 整体交付
Repository / Application 实现
Backup V3
API 路由
H5 前端接入
S2 或 S3
```

S1 封板后仍禁止直接修改 Repository、Application、API、H5 或 Backup V3。后续 Repository / Application 的任何实施，必须由架构师基于已冻结任务书、当前运行事实和 S2 测试门单独出具书面授权；产品确认授权范围后才可开始。
