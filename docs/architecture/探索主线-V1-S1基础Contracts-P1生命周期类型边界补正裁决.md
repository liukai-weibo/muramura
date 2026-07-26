# 探索主线 V1 S1：基础 Contracts P1 语义缺口裁决与最小补正授权

> 日期：2026-07-24
>
> 结论：**不通过，S1 基础 Contracts 暂不封板。**P1 属于可信生命周期类型边界缺失，必须在 Contracts 层修复并经 QA 复验、架构复审后，才可进入后续 Repository、Application、API、H5 或 Backup V3 阶段。

## 【裁决依据】

- `docs/product/当前运行事实.md`
- `docs/architecture/探索主线-V1-数据ApplicationRepository实施任务书-封板后生效.md`
- `packages/contracts/src/index.ts`
- `tests/exploration-track-contracts.test.ts`

当前定义：

```text
available      → track: ExplorationTrack（deletedAt 可选）
track-deleted  → track: ExplorationTrack（deletedAt 可选）
```

因此 TypeScript 允许下列两种违反冻结语义的对象通过：

```text
available 携带 deletedAt
track-deleted 未携带 deletedAt
```

“可用主线”与“已删除但保留关联事实的主线”是后续结构化读模型、删除/恢复、关联调整拒绝与 API 错误语义的基础分支。不得把二者的互斥性留给调用方约定。

## 【最小补正授权】

仅允许修改：

```text
packages/contracts/src/index.ts
tests/exploration-track-contracts.test.ts
docs/architecture/**
docs/daily-contributions/2026-07-24.md
```

允许的唯一业务变化：把 `ItemExplorationTrackContext` 的生命周期事实收紧为可执行的判别联合类型。

建议固定为：

```text
AvailableExplorationTrack
- 保留 ExplorationTrack 的必要字段
- deletedAt?: never

DeletedExplorationTrack
- 保留 ExplorationTrack 的必要字段
- deletedAt: string

ItemExplorationTrackContext
- available: AvailableExplorationTrack
- track-deleted: DeletedExplorationTrack
- unavailable: 仅保留原始非 NULL trackId
- no-association: 不携带 track 或 trackId
```

可使用命名类型或内联类型；实现方式不重要，以下不变量必须由 TypeScript 强制：

```text
available 不得携带 deletedAt（包括 undefined 的显式赋值）
track-deleted 必须携带非空 deletedAt
unavailable 不得降级为 no-association
Item 仍仅有一个可选 explorationTrackId，表达 0..1 关联
```

`ExplorationTrack` 作为通用实体和 `DeletedExplorationTrackListEntry` 的既有读取语义可继续保留；不要为仅修正 Context 分支而无关重命名或扩展全局 Contracts。

## 【测试要求】

在 `tests/exploration-track-contracts.test.ts` 中增加或调整纯类型级证据：

1. `available` 携带未删除 Track 能通过 `satisfies`；
2. `track-deleted` 携带 `deletedAt: string` 能通过 `satisfies`；
3. `available` 携带 `deletedAt` 必须以 `@ts-expect-error` 证明无法通过；
4. `track-deleted` 缺少 `deletedAt` 必须以 `@ts-expect-error` 证明无法通过；
5. 保留 existing/new 显式选择、0..1 Item 关联、`unavailable` 保留 trackId 与不引入多主线的既有证据。

测试不得使用运行时断言替代类型负向证据。`@ts-expect-error` 必须紧邻实际应报错的对象，并由 `typecheck` 验证其仍然有效。

## 【禁止事项】

```text
migrations/**、Schema、migration runner、运行库 DDL 或 DML
packages/storage-mysql/**、packages/application/**
apps/api/**、apps/client/**
Backup V3 / BackupData 格式或恢复语义
Repository、Application、API、H5、S2、S3
MySQL / Docker 连接、H5 / API 启动、集成测试
双写、同步、回填、浏览器直连 MySQL、自动推断、多主线
```

本轮只可运行 Contracts 定向测试、`typecheck`、非 MySQL 的全量测试与 `git diff --check`。不得改动 `knowledge_base` 或 `knowledge_base_uat`。

## 【后续门】

数据 / Application / Repository 工程师完成补正后，流转 QA 定向复验。QA 必须确认：

```text
正反向类型证据均存在且 typecheck 生效
原有三项 Contracts 测试语义不回退
无后续层、数据库、运行库或备份改动
```

QA 通过后由架构师复审。仅在复审通过后，才允许将 S1 基础 Contracts 封板并独立评审下一阶段；本裁决不自动授权任何后续实现。
