# 探索主线 V1 S1：基础 Contracts P1 可选属性编译边界裁决

> 日期：2026-07-24
>
> 结论：**不授权修改 `tsconfig.json`，书面调整 P1 的表示层验收口径；继续授权仅在 Contracts 与类型测试范围内实施补正。**

## 【裁决依据】

- `docs/product/当前运行事实.md`
- `docs/architecture/探索主线-V1-S1基础Contracts-P1生命周期类型边界补正裁决.md`
- `tsconfig.json`

项目当前未启用 `exactOptionalPropertyTypes`。在该 TypeScript 语义下：

```text
property?: never
```

可接受显式：

```text
deletedAt: undefined
```

候选实施以紧邻 `@ts-expect-error` 验证此点，得到 `TS2578: Unused '@ts-expect-error' directive`，证明原裁决中“包括 undefined 的显式赋值也必须拒绝”无法在当前授权范围内实现。

架构预检：

```text
corepack pnpm -C Knowledge_Base exec tsc --noEmit --exactOptionalPropertyTypes
```

结果为 14 个既有文件、43 项错误，涉及：

```text
apps/api/**
apps/client/**
packages/application/**
packages/storage-indexeddb/**
packages/storage-mysql/**
packages/storage-sqlite/**
tests/**
```

因此启用该选项不是 S1 基础 Contracts 的局部补正，而是项目级编译语义迁移；它将触及 API、H5、Application、多个 Repository 与既有测试，违反本阶段冻结边界。

## 【最终语义判断】

对现有 TypeScript 配置而言：

```text
deletedAt 缺失
≡ deletedAt: undefined
```

二者均不携带可表示的删除时间，也不会出现在 JSON、MySQL 数据或 API DTO 中作为独立业务事实。探索主线生命周期的业务不变量是：

```text
available 不得携带删除时间字符串
track-deleted 必须携带非空删除时间字符串
```

这与“活跃 / 已删除”的可信业务语义等价；强制区分“属性缺失”和“显式 undefined”需要全仓开启并完成 `exactOptionalPropertyTypes` 迁移，应独立立项，不能搭载 S1。

## 【书面调整后的 P1 验收口径】

以本裁决替代先前 P1 裁决中“available 包括显式 `deletedAt: undefined` 也必须拒绝”的单项要求。

必须保持：

```text
available：Track 不得携带 deletedAt: string
track-deleted：Track 必须携带 deletedAt: string
unavailable：保留原始非 NULL trackId，不得降级为 no-association
no-association：不携带 track 或 trackId
```

允许：

```text
available 的 deletedAt 缺失或显式为 undefined
```

此许可只针对当前 TypeScript 编译设置下的无删除时间表示；不得把 `undefined` 序列化、持久化、映射为已删除或用于绕过软删除判断。

## 【继续有效的最小授权】

仅允许修改：

```text
packages/contracts/src/index.ts
tests/exploration-track-contracts.test.ts
docs/architecture/**
docs/daily-contributions/2026-07-24.md
```

实现应：

1. 为 `available` 定义未删除 Track 形态，例如 `Omit<ExplorationTrack, 'deletedAt'> & { deletedAt?: undefined }`；
2. 为 `track-deleted` 定义 `deletedAt: string` 的 Track 形态；
3. 用 `satisfies` 与紧邻 `@ts-expect-error` 证明：
   - available + `deletedAt: string` 被拒绝；
   - track-deleted 缺少 `deletedAt` 被拒绝；
   - track-deleted + `deletedAt: string` 可通过；
   - available + 缺失 deletedAt 可通过；
4. 不再对 available + `deletedAt: undefined` 使用 `@ts-expect-error`；可将其作为当前编译配置下允许的等价无删除时间表示明确记录。

## 【持续禁止】

```text
tsconfig.json
apps/**、packages/application/**、packages/storage-*/**
migrations/**、Schema、运行库 DDL/DML
API、H5、Backup V3、Repository、Application、S2、S3
MySQL / Docker 连接、H5 / API 启动、MySQL integration suite
```

完成补正后须运行 Contracts 定向测试、`typecheck`、非 MySQL 全量测试与 `git diff --check`，流转 QA 定向复验。QA 通过后再转架构复审；本裁决不自动授权后续层。
