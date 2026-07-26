# 探索主线 V1 S2：Repository / Application 与原子工作流架构任务书

> 日期：2026-07-24
>
> 状态：**架构冻结，待产品经理书面授权后生效；当前禁止写代码。**
>
> 前置：S1“Schema 004 与基础 Contracts”已由产品封板；当前运行事实以 `docs/product/当前运行事实.md` 为准。

## 【技术结论】

**有条件可行，建议产品经理授权 S2 编码。**

S1 已建立 `exploration_tracks`、`items.exploration_track_id` 的可信存储结构和 0..1 生命周期 Contracts。S2 只实现 MySQL Repository、Application 编排与自动化验证，使这些结构化事实可被原子写入和读取。

S2 的核心技术原则是：

```text
跨对象业务写入不能由 Application 调用多个公开 Repository 写方法拼接。

创建事项 + existing/new 主线 + 初始状态事件
必须由一个 MySQL Workflow Repository 在同一 app connection、
同一 transaction 内完成。
```

S2 不接入 HTTP 或 H5。因此它不改变当前运行中的 API / H5 业务能力，也不改变 MySQL 作为当前 H5 运行数据源的既有事实。

## 【S2 最小实施边界】

### 1. Contracts：只补充 Repository 与 Application 所需的结构化契约

允许在既有 `packages/contracts/src/index.ts` 中补充以下最小抽象；不得改变 S1 已封板对象语义：

```text
ExplorationTrackRepository
ExplorationTrackWorkflowRepository
```

接口按能力表达，而非暴露 SQL、连接、transaction、pool 或表结构。最小能力包括：

```text
Track 生命周期
- create(name 的规范化结果与时间由 Application 传入或由固定 workflow 输入承载)
- getById(id)
- getActiveById(id)
- rename(id, name / normalizedName)
- softDelete(id)
- restore(id)
- listActive()
- listSelectable()
- listDeleted()

可信读取
- getHistory(trackId)
- getItemContext(itemId)
- listItemsByTrackAndStatus(trackId, status)

原子工作流
- createItemWithExplorationTrack(input, selection)
- assignItemToExplorationTrack(itemId, trackId)
- removeItemFromExplorationTrack(itemId)
```

接口可调整为更少但覆盖上述业务动作的方法；禁止为了“通用化”新增任意 SQL 查询、通用 filter、分页计数、批量关联或多主线接口。

`CaptureIdeaInput` 仅可最小扩展为接收既有 `ExplorationTrackSelection`；无该字段时必须保持既有 `captureIdea()` 语义、状态和返回值。

### 2. MySQL Repository：结构化关系唯一来源

新增 MySQL 探索主线 Repository 文件及必要导出。读取关系只能使用：

```text
exploration_tracks.id
items.exploration_track_id
reviews.item_id
```

禁止根据标题、时间、版本、状态文案、计数、相似度或前端缓存猜测关联。

Repository 读取必须直接形成已冻结 Contracts 读模型；前端或 Application 不得二次拼接表关系。所有 SQL 参数化，app pool 不执行 DDL。

### 3. Application：业务规则与错误语义唯一入口

在 `ItemApplicationService` 或新增专用 `ExplorationTrackApplicationService` 中实现以下已冻结能力：

```text
createExplorationTrack(name)
renameExplorationTrack(id, name)
deleteExplorationTrack(id)
restoreExplorationTrack(id)
listActiveExplorationTracks()
listSelectableExplorationTracks()
listDeletedExplorationTracks()
getExplorationTrackHistory(id)
getItemExplorationTrackContext(itemId)
assignItemToExplorationTrack(itemId, trackId)
removeItemFromExplorationTrack(itemId)
createItemWithExplorationTrack(captureInput, selection)
listItemsByExplorationTrackAndStatus(trackId, status)
```

名称规则只能在 Application 层执行：

```text
显示名 = Unicode NFKC 后 trim
规范名 = 显示名 lower-case
Unicode code point 长度 = 1..80
规范名对活跃与软删除 Track 全生命周期唯一
```

稳定业务错误必须保持可区分，供 S3 API 映射而非由 API 重猜：

```text
名称无效
主线不存在
主线已删除 / 非 active
主线名称冲突
事项不存在 / 已删除
关联不可用
受限状态参数无效
```

数据库连接、约束、事务或未知异常必须继续抛出，不得转换为空列表、无关联、零计数或假成功。

## 【事务与并发保护】

### 创建事项并关联 existing Track

固定单一 MySQL DML transaction：

```text
BEGIN
→ SELECT exploration_tracks WHERE id = ? AND deleted_at IS NULL FOR UPDATE
→ 不存在或已删除：拒绝、ROLLBACK
→ INSERT items（exploration_track_id = track id）
→ INSERT item_status_events（初始状态事件）
→ COMMIT
```

### 创建事项并关联 new Track

固定单一 MySQL DML transaction：

```text
BEGIN
→ Application 完成 NFKC / trim / lower-case / code point 校验
→ INSERT exploration_tracks（依赖 normalized_name UNIQUE 处理并发竞争）
→ INSERT items（exploration_track_id = new track id）
→ INSERT item_status_events（初始状态事件）
→ COMMIT
```

同规范名并发创建时，唯一索引冲突必须映射为稳定“名称冲突”；不得先查询后假定不存在，也不得留下空 Track、Item 或 Event。

### 调整 / 移除关联

```text
assign:
BEGIN
→ SELECT 未删除 Item FOR UPDATE
→ SELECT active Track FOR UPDATE
→ UPDATE items SET exploration_track_id = ?
→ COMMIT

remove:
BEGIN
→ SELECT 未删除 Item FOR UPDATE
→ 若 item.exploration_track_id 指向无法读取的 Track：拒绝关联不可用
→ UPDATE items SET exploration_track_id = NULL
→ COMMIT
```

写入锁顺序统一：**Item 前、Track 后**。创建新 Track 没有既有 Item 锁，但必须通过唯一约束处理名称竞争。删除/恢复/改名 Track 必须锁定 Track 行；不得改写关联 Item、Review、Method、ItemLink 或状态事件。

任何 INSERT、UPDATE、最终 Event、commit 前连接中断或约束失败，都必须 rollback。禁止补偿删除、事务外清理或将部分成功伪装为成功。

### 重试与未知结果

S2 不新增 requestId、幂等键或自动重试语义。数据库/调用方在 commit 是否完成未知时：

```text
不得自动重发写入
不得声称成功或失败
后续 S3 / H5 只能重新读取真实结构化状态
```

## 【可信读模型边界】

### 活跃、可选、已删除主线

```text
active list
- deleted_at IS NULL
- updated_at DESC, id ASC
- 每条至多一个真实最新关联 Item
- 不返回数量或关联次数

selectable list
- deleted_at IS NULL
- normalized_name ASC, id ASC
- 不返回已删除 Track

deleted list
- deleted_at IS NOT NULL
- deleted_at DESC, id ASC
- 只读；不返回数量或永久清理能力
```

`latestAssociatedItem` 只从真实 `items.exploration_track_id` 获取，稳定排序按冻结规范选取，不能由标题或历史推断。

### 主线历史与当前关联事项

`getExplorationTrackHistory(id)` 必须一次返回已冻结结构化读模型：

```text
track + lifecycle
currentAssociatedItems
history
abandonedHistory
```

数据规则：

```text
currentAssociatedItems
- 仅未删除 Items
- 状态固定：doing → idea_to_try → idea_later → paused
- 每个状态最多 3 条
- created_at DESC, id ASC
- 全部为空则 []
- 超限仅 hasMore + { status, explorationTrackId } moreLocator
- 禁止总数、剩余数、进度、完成率、计划

history
- 未删除且非 abandoned 的精确关联 Items
- created_at DESC, id ASC

abandonedHistory
- 未删除且 abandoned 的精确关联 Items
- created_at DESC, id ASC

reviewSummary
- 仅从 reviews.item_id 的真实一对一关系读取
- 有可靠事实才返回 actualAction / result
- 无法可靠读取时返回 reviewSummaryStatus: unavailable，不能伪造
```

已删除 Track 仍返回上述只读事实，且 `lifecycle = deleted`；S2 不返回或执行“可编辑权限”判断给前端，S3 才负责 HTTP 暴露。

### Item 关联上下文与 unavailable

```text
items.exploration_track_id IS NULL
→ no-association

非 NULL 且 Track 存在 / active
→ available

非 NULL 且 Track 存在 / deleted
→ track-deleted

非 NULL 且目标 Track 缺失、无法读出或结构化引用不可信
→ unavailable（保留原 trackId）
```

`unavailable` 不是 no-association。它只允许读取重试与受控诊断；S2 的 assign / remove 都必须拒绝，不得清空外键、创建替代 Track、自动修复或回填。

### 受限状态定位

`listItemsByExplorationTrackAndStatus(trackId, status)` 只接受同时存在的：

```text
trackId
status ∈ doing | idea_to_try | idea_later | paused
```

返回精确关联、未删除且处于该状态的 Items：

```text
updated_at DESC, id ASC
```

不得提供单参数 Track 查询、任意 status、通用过滤、分页计数或前端本地二次筛选。

## 【S2 自动化测试矩阵与验收门】

### 纯 Application / Contracts 测试

1. 名称 NFKC、trim、lower-case、code point 1..80；
2. 活跃与软删除 Track 均占用规范名，创建 / 改名 / 恢复的同名冲突稳定拒绝；
3. 0..1 关联：调整覆盖同一字段，不产生第二关系；移除仅置 NULL；
4. active / deleted / unavailable / no-association 四种 Context；
5. unavailable 不能降级、移除或调整；
6. 固定状态范围、排序、每组上限、空态与 moreLocator；
7. 已删除 Track 历史可读，回收站 Item 不进入任一读模型；
8. `captureIdea()` 无 selection 完全回归；existing / new 必须委派原子 workflow；
9. 已有状态机、复盘、方法、回收站语义回归。

### 真实 MySQL 临时库集成测试

新增专用测试文件，使用随机临时 database、独立 app / migrator 用户与 finally 清理；不得连接 `knowledge_base` 或 `knowledge_base_uat`：

```text
tests/mysql-s2-exploration-tracks.integration.test.ts
```

至少覆盖：

1. 001–004 migration 后空 Track、existing / new 创建流程；
2. existing / new 的 Track、Item、初始 ItemStatusEvent 成功提交；
3. Track INSERT、Item INSERT、Event INSERT、Item UPDATE、commit 前连接中断的逐阶段失败注入；每项比较十个既有集合加 `exploration_tracks` 的完整快照，证明零半成品；
4. existing Track 不存在、已删除、Item 不存在、Item 已删除、非法 selection / status：零副作用；
5. new Track 规范名并发竞争：至多一个完整提交，另一方稳定名称冲突；
6. 同 Item 并发关联调整：每次完整提交对应最新锁定状态，无多关系或半写入；
7. 删除 / 恢复 Track 不改写关联 Item、Review、Method、MethodVersion、MethodEvidence、MethodApplication、MethodTombstone、ItemLink、ItemStatusEvent；
8. 删除 Item 后恢复仍保留原 Track ID；
9. `unavailable` 仅用临时测试库受控构造断裂外键事实：读取保留 trackId，调整/移除拒绝且不写入；不得向运行库关闭外键或手工造脏数据；
10. 所有 list / history / current group / locator 的精确过滤、稳定排序、上限及 deleted Track 只读回归；
11. MySQL 不可用与驱动异常继续向上抛出，不映射为空读模型。

### 验收命令

实施后至少执行：

```text
corepack pnpm -C Knowledge_Base test --run tests/exploration-track-contracts.test.ts
corepack pnpm -C Knowledge_Base test --run tests/mysql-s2-exploration-tracks.integration.test.ts
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base test:mysql:integration
git -C Knowledge_Base diff --check
```

真实 MySQL 集成仅在显式加载适用测试环境变量时执行，必须保持现有随机临时库隔离、串行文件调度与运行库零污染门。无环境变量时测试必须明确跳过，绝不静默连接运行库。

S2 QA 验收前必须在停止 H5 / API 的窗口中执行完整 `test:mysql:integration`，并对 `knowledge_base`、`knowledge_base_uat` 做既有深度前后快照，结果必须为 `SNAPSHOTS_IDENTICAL`。

## 【允许修改范围】

产品授权后，仅允许：

```text
packages/contracts/src/index.ts
packages/application/src/index.ts
packages/storage-mysql/src/index.ts
packages/storage-mysql/src/exploration-track-repository.ts（新增）
tests/exploration-track-contracts.test.ts
tests/*exploration-track*.test.ts
tests/mysql-s2-exploration-tracks.integration.test.ts（新增）
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

若实现需向既有 MySQL Item Repository 注入 transaction connection，允许最小修改：

```text
packages/storage-mysql/src/item-repository.ts
```

但优先将 S2 的所有跨对象 DML 封装在新 Workflow Repository，避免公开 Repository 方法出现可跨 transaction 误用的接口。

## 【仍然禁止的范围】

```text
migrations/**，包括修改或重新执行 004
任何运行库 DDL / DML、清库、restore、回退或手工修表
packages/storage-indexeddb/**
packages/storage-sqlite/**
apps/api/**、apps/client/**
Backup V3、BackupData format / version / v1-v2 兼容语义
S3、HTTP 路由、DTO 映射、前端 Adapter 或 H5 交互
状态机、completeReview、ReviewWorkflow、方法、回收站、ItemLink 业务语义
双写、同步、回填、fallback、浏览器直连 MySQL
自动关联、多主线、子任务、进度、完成率、计划、日期、提醒、物理永久清理
远程 / 公网 API、0.0.0.0、多用户、认证、协作
```

## 【发现性风险与停止条件】

必须立即停止并转回架构师，不得自行扩张，若发现任一情况：

```text
实现需要 Schema / migration 变化
S1 Contract 无法表达实现所需事实，且补充会改变产品或 API 语义
existing Item / Review / Method / Event 语义需要改写
无法在同一 MySQL transaction 内覆盖 Track、Item 与 Event 写入
唯一键冲突、锁等待、死锁或连接中断无法得到稳定、诚实的错误语义
unavailable 只能靠清空外键或猜测目标才能继续操作
读模型需要按标题、时间、文案、计数或缓存推断关系
测试无法使用随机临时库，或完整 suite 污染任一运行库
需要进入 Backup V3、API 或 H5 才能证明 S2 正确性
```

## 【是否建议产品授权 S2 编码】

**建议授权，但仅授权本任务书的 S2 Repository / Application 与原子工作流范围。**

授权不包含 S3，也不允许将 MySQL 已存在的 Schema 004 解释为业务功能已上线。S2 完成后必须经过 QA、架构复审与产品验收；只有独立冻结并授权，才可讨论 Backup V3、API 或 H5。
