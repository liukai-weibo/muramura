# 探索主线 V1 S1：UAT 004 Items 快照表示层差异裁决

> 日期：2026-07-24
>
> 结论：**授权仅执行固定字段投影的只读核验，并授权修订部署快照的比较口径以区分 Schema 新列表示差异与既有业务数据改写。UAT API health 继续停止，直至核验与比较结论完成。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-UAT004部署前置复核与执行确认.md`、部署前后受限快照工件。

## 【事实判断】

UAT 004 已实际执行且其结构性后验已通过：

```text
目标：knowledge_base_uat
schema_migrations：001 / 002 / 003 / 004
004 checksum：与正式 SQL 一致
表、列、三个索引、外键：正确
migration 重跑：幂等成功
UAT app 用户：DDL 被拒绝
knowledge_base 前后快照：完全一致
```

当前阻断不是已证明的 DML 改写：004 向 `items` 新增可空 `exploration_track_id` 后，完整 `mysqldump` 每个 Item INSERT 多出该列的 `NULL` 表示，因此 hash 改变。完整行 dump 哈希在 Schema 扩展前后不具备“既有字段不变”的可比性。

但不得因此直接推定业务数据未变。必须用固定的、排除新增列的既有业务字段投影完成逐行可复算核验，并独立证明新增列全为 NULL。

## 【本次唯一授权】

允许：

```text
scripts/uat-schema004-readonly-snapshot.sh
scripts/uat-schema004-compare.sh（若修改现有脚本不能清晰区分一般完整快照与 schema-evolution 比较，则允许新增）
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md（实际完成工程验证后追加）
```

允许执行：只读固定 SQL、`information_schema`、只读 dump / hash 比较；仅读取已保存的受限临时快照和运行库。

不允许：

```text
migrations/**
packages/**
apps/**
.env / .env.uat
docker-compose.yml、docker/mysql/**
用户、权限、端口或运行组合
任何 DDL、DML、migration、restore、清库、回退或业务写入
```

## 【Items 数据一致性只读核验】

必须使用容器 Unix socket 的既有受控 root 只读路径，并只针对：

```text
knowledge_base_uat
```

对部署前 `records.sql` 中的 Items，或部署前 manifest 所对应的确定性投影，与部署后数据库的投影进行逐行比较。比较必须固定以下 004 前已存在的 `items` 业务字段：

```text
id
title
content
status
start_action
created_at
updated_at
deleted_at
```

规则：

```text
按 id ASC 稳定排序。
行数必须仍为 20。
每一行的上述八个字段值必须逐字节等价。
不得仅比较总行数或整体 hash；必须能定位任意差异的 item id 与字段名。
```

新增列必须独立核验：

```sql
SELECT COUNT(*) AS non_null_exploration_track_id_count
FROM knowledge_base_uat.items
WHERE exploration_track_id IS NOT NULL;
```

结果必须为 `0`。

还必须确认：

```text
exploration_tracks 行数为 0。
UAT 其余九个既有业务集合及 system_metadata 的部署前后 records hash 继续完全一致。
```

若任一既有字段、行数、新列 NULL 计数、空表行数或其他集合 hash 不符合预期：

```text
立即停止。
不得启动 API / H5。
不得清理、回填、恢复、回退或手工修表。
保留可复现投影差异、manifest、schema.tsv、records.sql 与脱敏 SQL 输出。
流转架构师按 P0 / P1 数据一致性问题处理。
```

## 【快照比较口径修订】

授权修订脚本，但只用于 004 这种已知 Schema 演进的部署比较，必须同时保留两个层次：

### 1. 原始完整快照：保持不变

`records.sql` 的完整行 dump、表级 hash、schema.tsv 与 manifest 继续生成、保存和比较。它用于发现任意 Schema / 数据表示变化，不能删除或被“归一化覆盖”。

004 后 Items 完整 dump hash 变化必须在比较结果中显式标记：

```text
expected-schema-representation-change
原因：items 新增 exploration_track_id，历史行导出新增 NULL。
```

不得把它标记为 `SNAPSHOTS_IDENTICAL`，也不得静默忽略。

### 2. Schema 演进兼容的业务投影比较：仅限冻结白名单

新增或修订 comparison manifest，明确记录：

```text
comparisonProfile = schema-004-add-nullable-item-track
itemsLegacyProjectionColumns =
  id, title, content, status, start_action, created_at, updated_at, deleted_at
itemsNewColumnInvariant = exploration_track_id IS NULL, count = 0
explorationTracksInvariant = count = 0
```

此 profile 只适用于：

```text
部署前 schemaVersion 3
→ 部署后 schemaVersion 4
→ 仅验证 004
```

不允许把该 profile 复用为未来 migration 的通用“忽略新增列”机制。任何后续 Schema 改动必须单独评审新的比较 profile。

部署后比较结论必须明确分三类：

```text
knowledge_base：完整快照完全一致。
knowledge_base_uat 既有业务数据：投影完全一致，新增列全 NULL，exploration_tracks 为空。
knowledge_base_uat 完整 Items dump：因 004 新列 NULL 表示产生预期 hash 差异，已保留原始证据。
```

## 【API health 裁决】

**继续停止。**

不得启动 `.env.uat` API health 探针，也不得启动 H5，直至：

```text
固定字段逐行投影比较通过；
exploration_track_id 非 NULL 计数为 0；
exploration_tracks 行数为 0；
快照比较脚本的完整 / 投影双口径经 QA 定向复验通过；
架构师复审确认 UAT 004 的数据一致性后验通过。
```

理由：健康探针虽应为只读，但当前部署验收处于数据一致性异常分流状态；继续保持停写、停运行进程，避免混入新的变量或将未完成验收误表述为可运行。

## 【后续门】

本裁决不授权基础 Contracts、Repository、Application、API、H5、Backup V3、S2 或 S3。数据一致性证据闭合后，仍需 QA 报告和架构复审，才能宣布 UAT 004 部署验收通过并讨论 S1 的下一份独立授权。
