# SQLite 主库迁移 — S3 稳定审阅与 S4 开工决策

> 状态：**S3 候选数据层通过架构稳定审阅；允许按本任务书进入 S4。**
>
> SQLite 仍不是运行主库。当前唯一运行主库仍是 IndexedDB。
>
> 关联：
> - `docs/architecture/SQLite主库迁移-S2稳定审阅与S3开工决策.md`
> - `docs/architecture/SQLite主库迁移-S2墓碑与事项永久清理裁决补充.md`

## 【技术结论：有条件可行，S3 通过并授权 S4】

S3 候选 SQLite Repository 已覆盖并经定向测试验证：

```text
方法形成、验证、修订的版本与证据事实
MethodApplication 的冻结版本
方法回收站、恢复、到期永久清理与最小墓碑
available / method-in-trash / method-purged / unavailable 历史上下文
Item 永久清理时的结构化方法关联清理与最后引用墓碑回收
事项池批量方法来源展示
```

本次补修尤其修复了两个必须关闭的问题：

1. `createFromReview()` 与 `validateFromReview()` 均在同一个 SQLite write transaction 内先验证真实 `Review`；缺失 Review 时拒绝，且不产生任何 Method、Version、Evidence 或既有事实的半写入。
2. 批量来源展示的标题只来自已存在的结构化 `Method`、冻结 `MethodVersion` 或可证明的 `MethodTombstone`；无法取得可信标题时返回无标题 `unavailable`，不猜测。

因此允许进入 S4。但 S3 只证明方法生命周期候选 Repository 的边界，不证明 SQLite 已能承载完整工作台闭环或可替代 IndexedDB。

## 【S3 稳定边界】

### 1. 形成、验证与修订的真实证据前置

以下写入必须在同一 SQLite write transaction 中完成：

```text
SELECT Review
→ 校验 Review 存在
→ 校验目标 Method 状态及去重约束（如适用）
→ 写 Method / MethodVersion / MethodEvidence
→ commit
```

缺失、删除或无法读取的 Review：

```text
throw "关联复盘不存在"
→ rollback
```

不得凭 `reviewId` 字符串、标题、时间、版本号或文案创造方法证据。

证据关系冻结为：

```text
形成：formation + methodVersion 1
仅验证：validation + 当前冻结 version
修订：revision + 新增 version
```

### 2. 方法生命周期与墓碑

方法进入回收站后：

```text
不出现在活跃方法列表
不能用于发起新行动
既有应用上下文 = method-in-trash
```

方法到期永久清理必须在同一 write transaction：

```text
校验每条 MethodApplication 的冻结 version 仍可由 MethodVersion 证明
→ 写入最小 MethodTombstone
→ 删除 MethodVersion
→ 删除 Method
→ commit
```

保留：

```text
MethodEvidence
MethodApplication
```

墓碑只保留：

```text
methodId
title
permanentlyDeletedAt
版本号映射
```

墓碑不得保存复盘 ID、步骤、适用性、版本正文或可用于恢复方法正文的信息。

任一校验或墓碑写入失败时，必须保留原方法、版本、证据、应用及既有墓碑状态，不得产生半清理。

### 3. Item 永久清理与方法关联

S3 接管 S2 的安全拒绝后，Item 到期清理可以仅依据真实结构化关系执行：

```text
Item → MethodApplication.itemId
Item → Review → MethodEvidence.reviewId
Item → Review → MethodVersion.sourceReviewId
```

在同一 transaction 内：

```text
清理可确定的 Evidence / Application
清空待删除 Review 对应的 MethodVersion.sourceReviewId
清理 Review、ItemStatusEvent、ItemLink、Item
统计受影响 methodId 的剩余 Evidence / Application
仅最后一个有效引用消失时删除对应 MethodTombstone
```

`MethodTombstone` 仍不是 Item purge 的独立阻断条件。孤立墓碑不得阻断无关事项清理。

禁止通过标题、时间、当前方法版本、文案或搜索结果推断某个墓碑与 Item / Review 的关系。

### 4. 批量来源展示的稳定读模型

`listSourceDisplaysForItems(itemIds)` 是事项池将来唯一允许使用的方法来源展示契约。输入必须去重并过滤空 ID；每个结果只使用结构化 `MethodApplication`、Method、冻结 MethodVersion 和 Tombstone 事实：

| 状态 | 可信标题来源 |
|---|---|
| `no-association` | 无标题 |
| `available` | `Method.title` |
| `method-in-trash` | 回收站 `Method.title` |
| `method-purged` | 可证明冻结版本的 `MethodTombstone.title` |
| `unavailable`，方法仍在 | `Method.title` |
| `unavailable`，方法缺失且冻结版本仍在 | `MethodVersion.title` |
| `unavailable`，方法与版本均缺失 | 无标题 |

当前实现虽在单个只读 transaction 中完成，但内部按条目读取上下文，存在潜在 N+1 成本。这不影响数据可信性，也不阻断 S3；S4 只可在真实列表规模或性能证据证明必要时，将其替换为集合化查询，返回值语义不得改变。

## 【SQLite / IndexedDB 当前关系】

```text
IndexedDB = 当前唯一运行主库
SQLite    = 仅允许临时合成数据测试的候选 Repository / Backup 层
```

本阶段仍禁止：

```text
前端接入 SQLite
Application 运行时切换到 SQLite
Node Local API
旧 IndexedDB 自动读取或真实 JSON 导入
真实个人数据迁移
SQLite / IndexedDB 双写
主库切换、灰度或回退
```

## 【S4 最小范围】

S4 只实现 SQLite 候选层中既有 Contracts 的完整读模型与复盘闭环：

```text
SqliteReviewWorkflowRepository.complete()
SqliteSearchRepository.search()
SqliteDashboardRepository.getSnapshot()
```

### S4 必须实现

1. `ReviewWorkflow.complete()` 以**单一 SQLite write transaction**实现现有业务编排：
   ```text
   重新读取 Item
   → 校验其处于 waiting_review 且未删除
   → 写 Review
   → 形成新方法或验证 / 修订既有方法（如用户明确选择）
   → 从 newIdeas 创建派生 Item 与 ItemLink（如有）
   → waiting_review → reviewed 与唯一状态事件
   → commit
   ```
2. 任一步失败，Review、Method、Version、Evidence、派生 Item、ItemLink、Item 状态和状态事件均整体 rollback。
3. Search 与 Dashboard 只基于 SQLite 当前结构化事实返回既有 Contracts；历史方法、回收站与断裂关联的行为必须与冻结业务语义一致。
4. 若为性能优化来源展示读模型，可改为集合化 SQL；不得新增字段、改变状态、猜关系或写入数据。

## 【S4 非目标】

S4 禁止：

```text
Local API、静态 H5 托管、前端 API client
真实 JSON 导入、备份恢复点、真实迁移与重启 UAT
双写、读切换、主库切换
Schema v2、BackupDocument v3 或业务字段扩张
账号、云端、同步、协作
```

S4 不得把 `complete()` 拆为 Application 层串行调用多个独立 Repository transaction。跨表复盘闭环的原子性必须由 SQLite Repository / 数据层 transaction 保证。

## 【允许修改的层与文件范围】

允许数据 / Application / Repository 工程师修改：

```text
packages/storage-sqlite/src/**
  - 新增 SQLite ReviewWorkflow、Search、Dashboard Repository
  - 仅为既有 Contract 实现必要的候选 bundle 组合

tests/sqlite-*.test.ts
  - S4 原子性、读模型与全量候选层回归

docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

未经新架构评审，不允许修改：

```text
apps/client/**
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
BackupDocument 格式、Schema 版本
任何 Local API / server 运行入口
```

## 【S4 自动化测试与验收】

使用真实临时 SQLite 文件，至少覆盖：

1. `completeReview()` 正常路径：Review、方法形成 / 验证 / 修订、派生事项、ItemLink、最终 `reviewed` 状态与唯一事件一致；
2. 对每一个最后写入点注入失败，验证全量 `BackupData` 规范化前后完全一致；
3. 已删除、不存在、非 `waiting_review`、已有 Review、失效方法、重复方法证据等拒绝路径无写入；
4. Search：Items 的 title/content、Review、活跃 Method 与历史 MethodVersion 的既有检索语义；
5. Dashboard：只读取当前可信事实，不混入回收站或无结构化关系的推测；
6. S1、S2、S3 定向回归，以及既有 IndexedDB 全量回归；
7. 工程验证：
   ```text
   typecheck
   test
   build:h5
   git diff --check
   ```

每次完成工程验证或 H5 人工验收，按项目规则更新：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限 S4 SQLite 候选 Repository、定向自动化测试与必要架构文档。**
