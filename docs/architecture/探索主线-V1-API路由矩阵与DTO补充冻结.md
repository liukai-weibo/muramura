# 探索主线 V1：API 路由矩阵、DTO 与未知写入结果补充冻结

> 状态：**架构补充冻结；当前禁止业务编码。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/product/探索主线-V1-产品评审结论.md`、`docs/product/探索主线-V1-设计冻结验收结论.md`、`docs/architecture/探索主线-V1最小架构评审与技术任务书.md`、`docs/design/探索主线-V1-交互与视觉设计冻结.md`。
>
> 当前运行事实：H5 → loopback API → Application → MySQL；MySQL 是当前 H5 运行数据源。日常 `knowledge_base` 和 UAT `knowledge_base_uat` 位于同一 `127.0.0.1:3306` MySQL 容器；每个 API 进程只连接一个业务 database。

## 【结论】

本补充矩阵解决设计冻结的三项 API 契约缺口：

1. 快速捕获“创建并归入”只在提交事项时单一事务创建主线、事项、初始状态事件和关联；
2. 主线详情通过**内嵌的结构化 `currentAssociatedItems`** 返回当前事项投影，不由前端过滤历史；
3. 已删除主线通过受限只读列表管理，与活跃列表和选择器严格隔离。

本矩阵不授权业务编码。产品确认矩阵、当前 MySQL 快速接入 Sprint 封板、设计稿据此补正后，才允许开始数据 / Application / Repository 实施。

## 【通用 HTTP 契约】

所有业务 API 均在 `/api/v1`，并延续既有：

```http
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: <server generated UUID>
```

失败 DTO 固定：

```ts
interface ApiErrorResponse {
  error: {
    code: string
    message: string
    requestId: string
  }
}
```

禁止在成功或失败 DTO 暴露 SQL、driver 原文、stack、MySQL host / port / database、用户名、密码、migration、`system_metadata` 或 pool 信息。

普通 JSON body 最大 `64 KiB`；无新增备份 body 上限，既有 `POST /api/v1/backup/restore` 的 `16 MiB` 与 v1/v2 语义在新增 v3 时继续适用。

## 【DTO 冻结】

### 核心对象

```ts
interface ExplorationTrackDto {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

interface ItemLocatorDto {
  itemId: string
  status: ItemStatus
}

interface ExplorationTrackItemDto {
  item: {
    id: string
    title: string
    status: ItemStatus
    createdAt: string
    startAction?: string
  }
  locator: ItemLocatorDto
  reviewSummary?: {
    actualAction: string
    result: string
  }
  reviewSummaryStatus: 'available' | 'not-reviewed' | 'unavailable'
}
```

`reviewSummaryStatus: 'unavailable'` 时不返回猜测内容；前端固定显示“复盘详情请在事项中查看。”

### 当前关联事项：主线详情内嵌投影

采用详情历史读模型内嵌方案，不新建第二个“当前事项”聚合路由。

```ts
type CurrentAssociatedStatus = 'doing' | 'idea_to_try' | 'idea_later' | 'paused'

interface CurrentAssociatedGroupDto {
  status: CurrentAssociatedStatus
  items: ExplorationTrackItemDto[]
  hasMore: boolean
  moreLocator?: {
    status: CurrentAssociatedStatus
    explorationTrackId: string
  }
}
```

冻结规则：

```text
状态范围与阅读顺序：doing → idea_to_try → idea_later → paused
每状态展示上限：3 条
稳定排序：items.createdAt DESC, items.id ASC
空态：所有四组均为空时，详情 read model 返回 currentAssociatedItems: []
      前端显示“还没有关联行动。”
超过上限：仅返回 hasMore: true 与 moreLocator
      不返回总数、剩余数、完成率、进度或计划信息
```

`moreLocator` 是真实定位参数，不是前端筛选提示。前端点击后切至事项工作台，并调用冻结的受限 Items 查询，按 API 返回的真实状态重新读取：

```text
GET /api/v1/items?status=<status>&explorationTrackId=<track id>
```

该查询只在两个参数同时出现时有效；不得提供通用任意过滤平台、分页计数或多主线筛选。结果只包含未删除、实际指向该主线、实际处于该状态的 Items，稳定排序：

```text
updatedAt DESC, id ASC
```

这与主线历史的 `createdAt DESC, id ASC` 是不同且明确的读取用途，不得由前端混用或重排。

### 主线详情历史

```ts
interface ExplorationTrackHistoryDto {
  track: ExplorationTrackDto
  lifecycle: 'active' | 'deleted'
  currentAssociatedItems: CurrentAssociatedGroupDto[]
  history: ExplorationTrackItemDto[]
  abandonedHistory: ExplorationTrackItemDto[]
}
```

规则：

```text
history：未删除且非 abandoned 的关联 Items；createdAt DESC, id ASC
abandonedHistory：未删除且 status = abandoned 的关联 Items；createdAt DESC, id ASC
回收站 Item：两个历史集合和当前投影均不返回
lifecycle = deleted：仍可只读查看当前投影、历史、已放弃事实；不返回可创建 / 改名 / 删除 / 关联调整权限
```

### Item 关联上下文

```ts
type ItemExplorationTrackContextDto =
  | { status: 'no-association'; itemId: string }
  | { status: 'available'; itemId: string; track: ExplorationTrackDto }
  | { status: 'track-deleted'; itemId: string; track: ExplorationTrackDto }
  | { status: 'unavailable'; itemId: string; trackId: string }
```

`unavailable` 不是无关联。前端仅可重试读取，不能调整、移除、自动清空或创建替代关联。

## 【路由矩阵】

### A. 活跃、可选与已删除主线读取

| Method / Path | 请求 | 200 响应 | Application 调用 | 边界 |
|---|---|---|---|---|
| `GET /api/v1/exploration-tracks` | 无 | `ExplorationTrackListEntryDto[]` | `listActiveExplorationTracks()` | 仅 `deletedAt` 缺失；`updatedAt DESC, id ASC`；每项最多一个真实最近关联事项；不返回计数。 |
| `GET /api/v1/exploration-tracks/selectable` | 无 | `ExplorationTrackDto[]` | `listSelectableExplorationTracks()` | 仅活跃主线；`normalizedName ASC, id ASC`；用于选择器；绝不返回已删除主线或关联次数。 |
| `GET /api/v1/exploration-tracks/deleted` | 无 | `DeletedExplorationTrackListEntryDto[]` | `listDeletedExplorationTracks()` | 仅 `deletedAt` 存在；`deletedAt DESC, id ASC`；只读管理列表；不返回数量、永久删除入口或选择器标记。 |
| `GET /api/v1/exploration-tracks/:id/history` | path `id` | `ExplorationTrackHistoryDto` | `getExplorationTrackHistory(id)` | 活跃与已删除主线均可读；不存在为 `404`。 |

```ts
interface ExplorationTrackListEntryDto {
  track: ExplorationTrackDto
  latestAssociatedItem?: {
    id: string
    title: string
    status: ItemStatus
    createdAt: string
  }
}

interface DeletedExplorationTrackListEntryDto {
  track: Required<Pick<ExplorationTrackDto, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
}
```

已删除管理页只能使用 `GET /deleted`、`GET /:id/history` 和 restore；不应调用 selectable，也不得从活跃列表本地筛选 deleted 记录。

### B. 主线生命周期写入

| Method / Path | 请求 DTO | 成功 | Application 调用 | 失败语义 |
|---|---|---|---|---|
| `POST /api/v1/exploration-tracks` | `{ name: string }` | `201 ExplorationTrackDto` | `createExplorationTrack(name)` | 400 名称无效；409 同名；503 / 500。允许创建空主线。 |
| `PATCH /api/v1/exploration-tracks/:id` | `{ name: string }` | `200 ExplorationTrackDto` | `renameExplorationTrack(id, name)` | 400、404、409、503 / 500。仅 active 可改名。 |
| `DELETE /api/v1/exploration-tracks/:id` | 无 | `204` | `deleteExplorationTrack(id)` | 404 不存在或已删除；503 / 500。只软删除，无永久删除。 |
| `POST /api/v1/exploration-tracks/:id/restore` | 无 | `200 ExplorationTrackDto` | `restoreExplorationTrack(id)` | 404 不存在或非 deleted；409 名称冲突；503 / 500。 |

删除主线只更改 Track 自身的软删除字段；不得改写关联 Item、Review、Method、ItemLink 或状态事件。恢复主线只恢复 Track；不得重建或推断关系。

### C. 创建事项与可选主线：兼容既有 `POST /api/v1/items`

**不新增“创建并归入”独立路由。**扩展既有 `POST /api/v1/items` 的 request body，以保持快速捕获是一次提交、一个原子业务请求。

```ts
type ExplorationTrackSelectionDto =
  | { type: 'existing'; trackId: string }
  | { type: 'new'; name: string }

interface CreateItemRequestDto {
  title?: string
  content?: string
  saveForLater?: boolean
  explorationTrack?: ExplorationTrackSelectionDto
}
```

兼容规则：

```text
无 explorationTrack：完全沿用既有快速捕获 Contract、DTO、状态语义与响应。
existing：本次提交在单一事务锁定 active Track，再创建 Item + 初始 Event + 关联。
new：本次提交才规范化 / 创建 Track，并在同一事务创建 Item + 初始 Event + 关联。
```

成功：

```http
201 Created
```

响应保持既有 `Item` DTO，不增加前端推断字段；前端随后按已知明确 selection 或重新读取 Item 关联上下文 / 主线详情确认事实。

禁止：

```text
输入新主线名称时发送 POST /exploration-tracks
取消新主线选择时产生任何 API 写入
创建 Item 后再以第二请求 assign Track
前端先显示新主线或关联成功，再等待提交结果
```

本路由调用唯一 Application 编排入口：

```text
captureIdea(input)
→ 无 selection：既有 createIdea
→ existing / new selection：createItemWithExplorationTrack
```

`createItemWithExplorationTrack` 不能由 API handler、前端或两个公开 Repository 调用拼接；它必须使用同一 MySQL transaction，原子提交：

```text
[existing: lock active Track]
或 [new: name check + create Track]
→ create Item
→ create initial ItemStatusEvent
→ persist Item.exploration_track_id
→ COMMIT
```

失败回滚 Track（仅本次新建）、Item、关联和 Event；失败响应不返回成功 Item / Track DTO。

### D. Item 关联读取与调整

| Method / Path | 请求 DTO | 成功 | Application 调用 | 边界 |
|---|---|---|---|---|
| `GET /api/v1/items/:id/exploration-track` | path `id` | `ItemExplorationTrackContextDto` | `getItemExplorationTrackContext(id)` | active / deleted / unavailable / no-association 必须区分。 |
| `PUT /api/v1/items/:id/exploration-track` | `{ trackId: string }` | `200 ItemExplorationTrackContextDto` | `assignItemToExplorationTrack(id, trackId)` | Track 必须 active；每 Item 至多一个关联；不可用关联不得通过此路由被覆盖。 |
| `DELETE /api/v1/items/:id/exploration-track` | 无 | `204` | `removeItemFromExplorationTrack(id)` | 仅 active Item 且当前 context 不是 unavailable；不删除 Track。 |

`PUT` 是替换式明确用户操作：Item 无关联时归入；已有 active 或 deleted Track 时改归入；不支持数组、追加或多主线。

### E. 受限“查看该状态下事项”定位读取

```text
GET /api/v1/items?status=<CurrentAssociatedStatus>&explorationTrackId=<trackId>
```

只允许两个参数一起出现：

```text
status ∈ doing | idea_to_try | idea_later | paused
explorationTrackId = 非空 path-safe ID
```

成功响应：既有 `Item[]` DTO；只返回未删除、精确关联该 Track、精确处于请求 status 的事项，按 `updatedAt DESC, id ASC`。

约束：

- 未提供两个参数时维持既有 `GET /api/v1/items` 行为；
- 只提供一个、状态不在冻结集合、重复参数或非法参数：`400 VALIDATION_FAILED`；
- Track 不存在：`404 NOT_FOUND`；Track deleted 仍可读取，保证已删除主线管理页理解历史事实；
- 不返回计数、分页总数、完成率、进度或任何计划数据；
- Repository / Application 通过 `exploration_track_id` 精确查询；前端不得下载历史后自行过滤。

## 【稳定错误码与语义】

| HTTP | code | 语义 / 适用情况 |
|---:|---|---|
| 400 | `VALIDATION_FAILED` | JSON / 参数不合法、名称空白或超长、非法 selection、非法状态范围、缺失配对定位参数。稳定业务文案沿用：`主线名称不能为空`、`主线名称最多 80 个字符` 等。 |
| 404 | `NOT_FOUND` | 确认不存在的 Track / Item，或对不允许生命周期状态执行操作，如对已删除 Track rename / delete、对 active Track restore。不得把 MySQL 失败映射为 404。 |
| 409 | `CONFLICT` | 规范化名称冲突（含软删除记录）、并发唯一键竞争、对同一关系的稳定业务冲突。文案：`已存在同名探索主线` 或 `无法恢复：存在同名探索主线。` |
| 503 | `MYSQL_SCHEMA_NOT_READY` / `MYSQL_UNAVAILABLE` | migration 未执行或 MySQL / pool / connection 确实不可用。不得返回空列表、无关联或成功 DTO。 |
| 500 | `INTERNAL_ERROR` | 未分类脱敏异常；不得误报为 MySQL unavailable。 |

通用既有错误继续有效：`413 REQUEST_TOO_LARGE`、`415 UNSUPPORTED_MEDIA_TYPE`、`405 METHOD_NOT_ALLOWED`、`404 NOT_FOUND_ROUTE`。所有失败返回 `ApiErrorResponse` 与 requestId。

## 【未知写入结果策略】

所有主线写操作及扩展后的 `POST /items` 均没有 idempotency key、结果查询或安全自动重试语义：

```text
已发送写请求
→ 浏览器超时 / 断线 / 关闭页面 / 响应丢失
→ unknown-outcome
→ 禁止自动重发
→ 禁止按本地表单推断成功或失败
→ 仅允许重新读取真实 API 事实
```

具体重新读取路径：

| 写入 | unknown-outcome 后的唯一允许确认动作 |
|---|---|
| 独立创建主线 | 刷新活跃主线列表；如名称冲突，读取同名已有主线 / 已删除主线管理区。 |
| 改名 / 删除 / 恢复主线 | 重新读取 `GET /exploration-tracks/:id/history`，并刷新活跃或 deleted 列表。 |
| 快速捕获 existing / new | 重新读取 Items 当前状态池与已选择 / 可能同名主线列表；不得重发 Item 创建或单独补关联。 |
| 主线内上下文捕获 | 重新读取当前主线 history 与相关 Item 状态池；不得重发。 |
| assign / remove Item 关联 | 重新读取 `GET /items/:id/exploration-track` 和相关 Track history。 |

前端在 `400/404/409/503/500` 已收到明确响应时保留相应草稿与未提交 selection；unknown-outcome 也保留草稿但只展示“提交结果未确认，请重新获取真实数据后确认是否已生效”，不能据此重复提交。

## 【Application / Repository / API 边界】

```text
H5
→ API route（decode、参数上限、错误 DTO、requestId）
→ Application Service（名称规则、生命周期、读模型、事务编排）
→ Repository（结构化 SQL 读写）
→ MySQL
```

- API handler 不得直连 SQL、pool 或 Repository，不得自行 lock 或拼装跨表事务。
- Application 不接受 HTTP 状态、header、requestId 或 `AbortSignal`。
- Repository 不用标题、时间、状态文案或相似度补关系；所有关系以 `items.exploration_track_id` 和 `exploration_tracks.id` 为准。
- H5 不持久化主线关系镜像，不从历史、自身缓存或 Item 标题补齐关联、当前事项或复盘摘要。
- Backup V3、`replaceData()` 的十集合恢复与 `system_metadata` 隔离继续以主架构任务书为准；本矩阵不新增备份 API 路由。

## 【实施前必须确认】

```text
1. 产品确认本补充矩阵；
2. 设计冻结稿按本矩阵修正“创建并归入”表述：输入新主线名仅表单暂存；
3. 当前 MySQL 快速接入 Sprint 完整封板；
4. 004 Migration、Backup V3、Application / Repository / API 自动化任务书经架构确认。
```

在此之前，禁止任何探索主线数据层、API 或前端业务编码。
