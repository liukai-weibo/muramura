# Layout Sprint 2 技术评审

> 状态：待产品经理裁决后进入实施
>
> 评审类型：轻量技术评审，不进入代码开发
>
> 评审对象：`docs/product/Layout-Sprint-2-PRD.md`
>
> 前置状态：Layout Sprint 1 已正式验收通过并封板
>
> 评审依据：
>
> - `docs/product/Layout-Sprint-2-PRD.md`
> - `docs/product/整体布局设计-v1.md`
> - `docs/product/功能清单-v2.md`
> - `docs/product/Layout-Sprint-1-产品验收记录.md`
> - `docs/archive/architecture/layout-sprints/Layout-Sprint-1-技术评审.md`
> - `docs/architecture/整体架构设计-v2.md`

## 一、总体技术结论

Layout Sprint 2 总体可行，可以继续沿用 Layout Sprint 1 已建立的单页面 React 状态、四模块应用骨架和统一跨模块定位机制，不需要引入路由、全局状态库、新 IndexedDB 表或新的备份格式。

本轮大部分工作属于客户端表现层调整：

```text
方法卡片
→ 方法列表—详情工作台

三项方法选择
→ none / create / validate 两个可切换动作

流转历史文档流展开
→ 事项详情内的右侧浮动抽屉
```

但“方法详情展示全部来源与验证证据，并准确标注形成 / 仅验证 / 修订”不是纯前端改造。现有持久化数据对当前规范写入的数据基本具备表达能力，但现有 Application / Repository 没有提供按方法读取完整证据详情的公开能力，且早期迁移数据存在无法完全还原证据关系类型的情况。

因此，本轮技术范围应分成两部分：

1. **前端主改造**：方法工作台、局部搜索排序、复盘默认初始化、两个方法动作、流转历史抽屉。
2. **最小只读业务能力补充**：为方法详情提供结构化证据详情，不改变写入语义、Schema 和备份格式。

### 1.1 评审摘要

| 评审项 | 结论 |
|---|---|
| 方法列表—详情 | 可以使用现有方法数据和客户端状态完成 |
| 方法局部搜索与排序 | 可以在客户端完成 |
| 来源方法及使用版本 | `MethodApplicationContext` 可以可靠提供 |
| 不处理 / 仅验证 / 修订并验证 | 现有提交工作流已经满足 |
| 全部方法证据读取 | 现有公开接口不足，需要最小只读契约补充 |
| 新数据的证据关系类型 | 可以通过证据与版本来源的关联可靠判断 |
| 早期迁移数据的关系类型 | 可能无法完全可靠还原，禁止前端猜测 |
| Domain | 不需要修改 |
| Contracts | 建议增加只读证据详情契约和查询接口 |
| Application | 建议增加只读证据详情用例 |
| Repository | 建议增加按方法读取证据详情能力 |
| IndexedDB Schema / Migration | 不需要修改 |
| JSON 备份格式 | 不需要修改 |
| 路由 / 全局状态库 | 不需要引入 |
| 当前阻塞 | 产品需裁决历史关系未知的展示，以及是否允许切换其他方法 |

## 二、现有数据能否区分方法关系

这是本轮最重要的数据事实核验。

### 2.1 当前五类对象的真实表达能力

#### `Method`

当前保存：

- 方法身份；
- 当前标题、步骤和补充说明；
- 当前版本号；
- 累计验证次数；
- 创建和更新时间。

它表达的是“当前方法快照”，不能独立说明每一条证据属于形成、仅验证还是修订。

#### `MethodVersion`

当前保存：

- 所属方法；
- 版本号；
- 该版本内容；
- `sourceReviewId`；
- 版本创建时间。

对于当前规范写入的数据：

- v1 的 `sourceReviewId` 是形成方法的复盘；
- v2 及以上版本的 `sourceReviewId` 是对应修订复盘；
- 仅验证不会生成 `MethodVersion`。

因此，它可以可靠表达当前规范数据中的“形成来源”和“修订来源”。

#### `MethodEvidence`

当前保存：

- 所属方法；
- 来源复盘；
- 证据创建时间。

它没有显式保存关系类型。

对当前规范写入的数据，可以将它与 `MethodVersion.sourceReviewId` 联合判断：

```text
证据 reviewId = v1.sourceReviewId
→ 形成

证据 reviewId = v2+ 的 sourceReviewId
→ 修订

证据 reviewId 不属于任何版本 sourceReviewId
→ 仅验证
```

这不是依据文案或版本数量猜测，而是依据真实外键关系判断。

#### `MethodApplication`

当前保存：

- 来源方法 `methodId`；
- 实际使用版本 `methodVersion`；
- 发起的事项 `itemId`；
- 创建时间。

`itemId` 有唯一约束，同一事项不会关联多个方法应用。

它能够可靠表达：

```text
事项实际由哪个方法发起
+ 发起时冻结了哪个方法版本
```

后续方法修订不会污染事项实际使用的历史版本。

#### `Review`

当前保存所属 `itemId` 和复盘正文，但不保存“本次形成 / 验证 / 修订了哪个方法”。该关系通过 `MethodEvidence` 和 `MethodVersion` 反向建立。

### 2.2 当前规范数据的可区分结论

对通过当前业务工作流新写入的数据，可以可靠表达：

| 业务关系 | 能否表达 | 判断依据 |
|---|---:|---|
| 方法形成 | 是 | `MethodVersion.version = 1` 且 `sourceReviewId` 对应证据 |
| 仅验证 | 是 | 有 `MethodEvidence`，但该复盘不是任何版本来源 |
| 修订 | 是 | `MethodVersion.version > 1` 且 `sourceReviewId` 对应证据 |
| 历史版本来源 | 是 | `MethodVersion.sourceReviewId` |
| 事项实际使用的方法 | 是 | `MethodApplication.methodId` |
| 事项实际使用版本 | 是 | `MethodApplication.methodVersion` |

### 2.3 历史迁移数据的限制

早期数据库升级到方法版本表时，只能根据当时的当前方法快照补建一个版本，并从已有证据中选择一条作为 `sourceReviewId`。

这意味着早期迁移数据可能存在：

- 只有当前版本快照，没有完整历史版本；
- 被选中的来源复盘不一定能证明它是首次形成还是某次修订；
- 其他证据可以确认“与该方法有关”，但无法百分之百恢复它当时是仅验证还是丢失版本对应的修订。

已经丢失的历史语义无法通过新增字段自动恢复。即使现在升级 Schema，也不能无损重建过去没有记录的事实。

### 2.4 禁止的前端推断

前端不得根据以下信息猜测证据类型：

- 文案中是否出现“修订”；
- 方法当前版本号；
- 证据时间先后；
- 验证次数；
- 某条复盘看起来像形成方法；
- 第一条证据默认视为形成。

### 2.5 最小解决方案

建议新增一个只读证据详情模型，由 Repository / Application 统一关联计算，而不是将原始表交给页面自行拼接：

```ts
type MethodEvidenceRelation =
  | 'formation'
  | 'validation'
  | 'revision'
  | 'unknown'

interface MethodEvidenceDetail {
  evidenceId: string
  methodId: string
  reviewId: string
  itemId: string
  itemTitle: string
  reviewCreatedAt: string
  reviewSummary: string
  relation: MethodEvidenceRelation
  methodVersion?: number
}
```

判定规则：

```text
匹配 v1 sourceReviewId
→ formation

匹配 v2+ sourceReviewId
→ revision，并返回对应 methodVersion

没有匹配任何版本来源
且数据满足当前完整写入约束
→ validation

历史迁移数据无法证明具体类型
→ unknown
```

该方案只补充读模型和查询能力：

- 不新增 IndexedDB 字段；
- 不修改现有表；
- 不需要 Migration；
- 不修改 JSON 备份；
- 不改变形成、验证和修订的写入语义。

### 2.6 暂停点与产品裁决

产品必须确认：历史迁移数据无法可靠还原关系时，方法详情是否接受显示：

```text
历史证据
关系类型无法从旧数据中确定
```

技术建议接受 `unknown`，因为这是对真实数据能力的诚实表达。

如果产品要求所有历史证据必须精确显示形成 / 验证 / 修订，则当前数据无法满足，本轮必须暂停；新增 Schema 也无法自动修复既有历史，只能要求人工校正或设计专门的数据修复流程，这将超出 Layout Sprint 2。

## 三、方法列表—详情的页面与组件拆分

### 3.1 页面结构

继续使用 Layout Sprint 1 的单个 `IndexPage` 和 `methods` 模块，不拆路由：

```text
IndexPage
└── MethodsModule
    ├── MethodListPane
    │   ├── MethodListToolbar
    │   │   ├── MethodLocalSearch
    │   │   └── MethodSortControl
    │   └── MethodList
    │       └── MethodListItem
    └── MethodDetailPane
        ├── MethodSummary
        ├── MethodSteps
        ├── MethodDescription
        ├── MethodActionComposer
        ├── MethodEvidenceSection
        └── MethodVersionSection
```

### 3.2 职责边界

#### `MethodsModule`

负责：

- 方法模块局部状态协调；
- 过滤和排序当前方法；
- 当前方法选择；
- 外部定位目标落地；
- 空状态组合。

不负责：

- 直接读取 Dexie；
- 判断证据关系；
- 创建方法版本；
- 改变方法业务规则。

#### `MethodListPane`

负责紧凑定位和比较，只展示：

- 方法名称；
- 当前版本；
- 验证次数；
- 最近更新时间；
- 当前步骤首行摘要。

列表项点击只改变 `selectedWorkspaceMethodId`，不触发业务写入。

#### `MethodDetailPane`

负责展示和操作当前选中方法：

1. 方法名称；
2. 当前版本和验证次数；
3. 具体步骤；
4. 补充说明；
5. 用方法发起行动；
6. 来源与验证证据；
7. 版本历史。

证据与版本历史默认折叠。

### 3.3 状态所有权

建议继续由 `IndexPage` 或 `MethodsModule` 的稳定上层持有：

- 当前工作台方法 ID；
- 方法局部搜索词；
- 方法排序；
- 证据折叠状态；
- 版本折叠状态；
- 目标历史版本；
- 方法行动草稿。

普通一级模块切换不得清空这些状态。

本轮不引入 Context、Reducer 或全局 Store。

## 四、方法选中、局部搜索和排序

### 4.1 独立方法选择状态

当前 `selectedMethodId` 用于复盘中的“验证已有方法”。Layout Sprint 2 不应复用它表示方法工作台右侧详情，否则会造成两个业务上下文互相污染。

建议新增独立页面状态：

```ts
selectedWorkspaceMethodId?: string
```

保留：

```ts
selectedReviewMethodId: string
```

即便实施阶段不改变量名，也必须保持概念分离：

```text
方法工作台当前方法
≠
复盘当前验证的方法
```

### 4.2 默认选择

进入方法模块时：

1. 如果上次选择的方法仍存在，继续保留；
2. 如果不存在，清除无效选择；
3. 如果没有选择且过滤结果非空，选择当前排序下第一条；
4. 如果方法为空，显示方法空状态；
5. 如果搜索无结果，显示搜索空状态，不保留隐藏详情。

根据 PRD 的产品优先建议，本评审建议：**当前选择被局部搜索排除时清除选择**，避免左侧看不到选中项、右侧仍显示隐藏上下文。

为了避免清空搜索后无法恢复用户原选择，可以只在显示层将详情置空，而保留一个 `lastSelectedWorkspaceMethodId`；但这会增加状态复杂度。本轮最小方案是直接清除，用户清空搜索后默认选择排序第一条。

### 4.3 局部搜索

使用当前已加载的 `methods` 在客户端过滤：

- 方法名称；
- 当前步骤。

不搜索：

- 历史版本；
- 来源复盘；
- 关系；
- 事项；
- 补充说明之外的扩展数据。

局部搜索与全局搜索使用独立状态：

```ts
methodQuery
```

不得复用全局 `searchQuery`。

### 4.4 排序

客户端提供：

```ts
type MethodSort = 'recent' | 'mostValidated'
```

规则：

```text
recent
→ updatedAt 倒序

mostValidated
→ validationCount 倒序
→ 相同则 updatedAt 倒序
→ 再相同可用 id 保证稳定顺序
```

默认 `recent`。

方法数量目前无需 Repository 分页和服务端排序。

## 五、方法详情、来源证据和版本历史加载

### 5.1 当前方法详情

当前方法主体来自已经加载的 `Method[]`，无需额外请求。

### 5.2 版本历史

继续复用：

```text
ReviewApplicationService.listMethodVersions(methodId)
```

加载策略：

- 默认不加载或不展示；
- 用户首次展开时按方法 ID 懒加载；
- 结果缓存于页面状态；
- 后续再次展开复用缓存；
- 方法完成修订后刷新该方法的版本缓存；
- UI 按版本倒序展示，底层当前返回顺序不必修改。

### 5.3 来源与验证证据

现有 `listMethodsFromReview(reviewId)` 是从复盘找方法，不满足从方法列出全部证据。

需要最小补充：

```text
MethodRepository.listEvidenceDetails(methodId)
ReviewApplicationService.listMethodEvidence(methodId)
```

或建立职责更清晰的只读查询服务。具体命名由后端实施时遵循现有代码风格，但必须返回结构化详情，页面不得直接读取多个 Dexie 表后自行分类。

加载策略：

- 默认折叠；
- 首次展开按方法 ID 懒加载；
- 结果按复盘时间倒序；
- 缓存于页面状态；
- 新增形成、验证或修订后使对应方法证据缓存失效；
- 缺失事项或复盘时返回可识别的不可用记录或过滤并记录错误，不伪造正文。

### 5.4 版本来源与证据避免重复

“来源与验证证据”展示全部真实证据及其关系类型；“版本历史”展示版本快照和版本来源。

两者可以引用同一复盘，但承担不同阅读任务：

```text
证据区：这条方法被哪些复盘支持，以及关系类型
版本区：方法内容如何演化
```

页面不应将形成或修订复盘从证据区删除，只需避免同时默认展开两区造成重复噪声。

## 六、全局搜索及仪表盘定位方法和历史版本

### 6.1 复用统一导航

继续复用 Layout Sprint 1 已封板的：

```text
NavigationTarget
navigateTo(...)
```

不得新增第二套跨模块导航。

### 6.2 定位当前方法

流程：

```text
全局搜索 / 仪表盘方法指标 / 方法复利
→ 验证目标方法存在
→ activeModule = methods
→ 清空阻挡目标的方法局部搜索词
→ selectedWorkspaceMethodId = targetMethodId
→ 右侧显示目标详情
```

外部定位优先于局部搜索上下文，自动清空方法局部搜索词，符合 PRD 建议。

排序可以保留，因为选中详情不依赖方法位于第一条；列表应滚动到选中项。

### 6.3 定位历史版本

流程：

```text
全局搜索历史版本
→ activeModule = methods
→ 清空方法局部搜索词
→ 选中所属方法
→ 加载版本历史
→ 展开版本区
→ 设置 pendingMethodVersion
→ DOM 渲染后滚动并高亮目标版本
→ 清除一次性待定位状态
```

建议状态：

```ts
pendingMethodVersion?: {
  methodId: string
  version: number
}
```

若目标版本不存在：

- 保留当前方法详情；
- 显示“目标版本不存在”；
- 不改为其他版本；
- 不伪造版本。

### 6.4 仪表盘定位

继续遵循 Layout Sprint 1 已冻结语义：

- 方法形成、验证、修订、方法复利 → 方法详情；
- 方法发起行动 → 具体事项；
- 修订指标可携带目标版本时展开对应版本。

当前实现从展示文案中正则解析修订版本号。这是脆弱实现，长期不应依赖文案。但 Layout Sprint 2 不必因此修改仪表盘数据契约；若实施中需要稳定定位历史版本，建议由现有下钻记录直接保留版本号的结构化能力再单独评估，不能继续扩大为关系型搜索。

本轮最低验收：修订下钻能选中正确方法；若现有结构化记录不能可靠提供版本号，则只定位方法详情，不从文案猜版本。

## 七、方法证据反向定位事项复盘

`MethodEvidenceDetail` 应直接提供：

- `reviewId`；
- `itemId`；
- 事项标题；
- 复盘时间和摘要。

点击证据后复用现有导航：

```text
navigateTo({ type: 'review', itemId })
```

现有统一定位已经能：

- 进入行动模块；
- 退出回收站；
- 清除冲突筛选；
- 计算事项分页；
- 选中事项；
- 等待复盘加载；
- 定位复盘区域。

不新增关系型搜索，也不新增独立复盘路由。

如果事项已永久清理：

- 显示“来源事项不存在或已清理”；
- 不停留在上一个事项详情；
- 方法证据本身仍可展示为历史记录，但不得伪造事项内容。

## 八、来源方法事项进入复盘时的默认初始化

### 8.1 读取能力

现有：

```text
MethodApplicationService.getContextForItem(itemId)
→ MethodApplicationContext
```

返回：

- `application.methodId`；
- `application.methodVersion`；
- 当前 `method`；
- 实际使用的历史 `version` 快照。

该能力已经通过测试证明：方法后续修订不会污染事项实际使用版本。

### 8.2 读取时机

当 `selectedId` 改变时：

1. 重置上一事项的复盘方法决策状态；
2. 标记新事项尚未完成默认初始化；
3. 异步调用 `getContextForItem(selectedId)`；
4. 只接受与当前 `selectedId` 仍一致的返回结果；
5. 展示只读来源方法及实际使用版本；
6. 如果是待复盘事项且用户尚未操作方法决策，则执行一次默认初始化。

### 8.3 默认设置

满足以下条件时：

```text
当前事项状态 = waiting_review
+ 存在 MethodApplicationContext
+ 当前事项尚未完成方法决策初始化
+ 用户尚未触碰本事项的方法决策
```

执行：

```text
methodMode = validate
selectedReviewMethodId = context.application.methodId
reviseMethod = false
```

展示：

```text
本次行动使用了：「当前方法名称」
实际使用版本：v{context.application.methodVersion}
实际使用步骤：context.version.steps
```

名称可以同时说明当前方法已更新，但“实际使用版本”必须来自冻结的 `context.version`，不能展示当前方法版本冒充实际使用版本。

### 8.4 只初始化一次

建议为每个当前事项维护：

```ts
reviewMethodInitialization: {
  itemId: string
  initialized: boolean
  touched: boolean
}
```

或等价的两个 `useRef` / 页面状态。

规则：

- `selectedId` 改变时为新事项重置；
- 当前事项的上下文首次成功或确认不存在后，将 `initialized = true`；
- 用户点击形成、验证、取消、选择其他方法或切换修订时，将 `touched = true`；
- 后续 `items` 刷新或上下文重复返回不再应用默认值；
- 用户取消验证后，刷新数据不得再次自动选中；
- 切换到另一事项后按新事项重新初始化；
- 再切回原事项是否保留未提交草稿，继续遵循 Layout Sprint 1 的当前事项草稿模型；若当前实现切换事项会清空草稿，则返回时可重新初始化，但不能恢复已取消的选择。为避免歧义，建议初始化状态按 itemId 缓存到本次页面会话。

### 8.5 异步竞争保护

每次读取捕获请求对应的 `itemId`：

```text
请求返回
→ 若 selectedId 已变化，丢弃结果
→ 若当前事项已 touched，只有上下文展示更新，不覆盖方法决策
→ 若已 initialized，不重复默认选择
→ 否则应用一次默认值
```

不能仅依赖 Effect 执行顺序。

## 九、避免默认初始化覆盖复盘草稿

### 9.1 草稿与默认值分层

来源方法上下文是系统已知事实：

```text
只读展示层
```

默认验证选择是可取消建议：

```text
可编辑决策层
```

两者必须分开。即使用户取消验证，来源方法和实际使用版本仍继续显示。

### 9.2 用户触碰优先

以下任一操作都视为用户已触碰方法决策：

- 点击形成新方法；
- 点击验证已有方法；
- 再次点击取消；
- 选择其他方法；
- 打开或关闭修订；
- 修改形成草稿；
- 修改修订草稿。

一旦触碰，异步上下文只能更新只读来源信息，不能修改：

- `methodMode`；
- 当前验证方法；
- 修订开关；
- 形成或修订草稿。

### 9.3 初始化与数据刷新解耦

当前 `MethodApplicationContext` 读取 Effect 依赖 `items`，业务刷新可能导致重复读取。Layout Sprint 2 可以保留重复读取以更新展示，但默认选择必须由独立的 `initialized/touched` 守卫控制。

禁止采用：

```text
每次 context 有值
→ setMethodMode(validate)
→ setSelectedMethodId(sourceMethod)
```

否则用户取消后会被再次自动选中。

## 十、普通复盘两个方法动作的状态与草稿保留

### 10.1 状态模型

继续使用：

```ts
type MethodMode = 'none' | 'create' | 'validate'
```

交互规则：

```text
none + 点击 create
→ create

create + 再次点击 create
→ none

none + 点击 validate
→ validate

validate + 再次点击 validate
→ none

create + 点击 validate
→ validate

validate + 点击 create
→ create
```

`create` 与 `validate` 永远互斥。

### 10.2 草稿分离

当前单一 `methodForm` 同时服务形成和修订。为了满足切换动作不误清草稿，建议拆成两个前端草稿：

```ts
createMethodDraft
revisionMethodDraft
```

另保留：

```ts
selectedReviewMethodId
reviseMethod
```

规则：

- 切换 `create` / `validate` 只切换可见草稿，不清除另一草稿；
- 从 `validate` 回到 `none` 保留当前选中方法和修订草稿于本次复盘会话中；
- 再次进入 `validate` 恢复草稿；
- 提交时只读取当前 `methodMode` 对应数据；
- 提交成功、切换事项或用户明确重置时再清空；
- 切换动作时清除不适用于当前动作的错误提示，但不清草稿。

### 10.3 none 可直接提交

当 `methodMode = none`：

- 不发送 `method`；
- 不发送 `existingMethod`；
- 不增加证据；
- 不增加验证次数；
- 不生成版本。

取消按钮虽然从界面移除，但“再次点击已选中的动作”必须保留回到 `none` 的能力。

## 十一、仅验证与修订的提交数据映射

### 11.1 不处理方法

```ts
{
  method: undefined,
  existingMethod: undefined,
}
```

业务结果：

- 复盘创建；
- 事项进入已复盘；
- 方法不发生变化。

### 11.2 形成新方法

```ts
{
  method: {
    title: createMethodDraft.steps 首行,
    applicable: createMethodDraft.description || '暂无补充说明',
    unsuitable: '',
    steps: createMethodDraft.steps,
  },
  existingMethod: undefined,
}
```

界面文案：

- 步骤字段：`下一次怎么做`；
- 说明字段：`补充说明（可选）`。

这里继续使用当前兼容字段映射，不在 Layout Sprint 2 处理旧底层字段收敛。

### 11.3 仅验证

```ts
{
  method: undefined,
  existingMethod: {
    methodId: selectedReviewMethodId,
    revision: undefined,
  },
}
```

现有业务结果已经满足：

- 新增 `MethodEvidence`；
- `validationCount + 1`；
- 方法版本号不变；
- 不新增 `MethodVersion`。

### 11.4 修订并验证

```ts
{
  method: undefined,
  existingMethod: {
    methodId: selectedReviewMethodId,
    revision: {
      title: selectedMethod.title,
      applicable: revisionMethodDraft.description || '暂无补充说明',
      unsuitable: selectedMethod.unsuitable,
      steps: revisionMethodDraft.steps,
    },
  },
}
```

界面文案：

- 步骤字段：`更新后的做法`；
- 说明字段：`补充说明（可选）`。

现有业务结果已经满足：

- 新增证据；
- 验证次数增加；
- 方法版本号增加；
- 新增方法版本快照；
- 新版本保存本次复盘来源。

### 11.5 现有业务语义结论

| 行为 | 新增证据 | 验证次数增加 | 生成版本 | 现有业务是否满足 |
|---|---:|---:|---:|---:|
| 不处理方法 | 否 | 否 | 否 | 是 |
| 仅验证 | 是 | 是 | 否 | 是 |
| 修订并验证 | 是 | 是 | 是 | 是 |

因此不需要修改核心写入语义，也不得在前端伪造计数或版本。

## 十二、是否允许切换其他方法

### 12.1 数据一致性分析

假设事项由方法 A v1 发起，但复盘时用户改为验证方法 B：

- `MethodApplication` 仍真实记录事项由 A v1 发起；
- 本次 `MethodEvidence` 关联 B；
- `Review` 仍属于该事项；
- 不会修改或删除 A v1 的应用关系。

从数据结构上不存在外键冲突，也不会破坏方法应用关系。

但业务语义会形成：

```text
行动来源：A v1
本次复盘验证：B
```

这可以是真实情况，也可能是误操作。如果界面不说明，用户会误以为 B 是本次行动的来源方法。

### 12.2 方案 A：锁定来源方法

规则：方法来源事项默认且只能验证来源方法。

优点：

- 来源与证据语义最简单；
- 减少误选；
- UI 和测试更简单。

代价：

- 无法表达实际执行中同时验证了另一个方法；
- 用户必须放弃本次方法处理，未来另建证据；
- 限制真实复盘表达。

### 12.3 方案 B：允许切换并明确提示

规则：默认来源方法，允许选择其他方法。

切换后必须持续展示：

```text
本事项由「方法 A」v1 发起
本次复盘将验证「方法 B」
```

并在选择其他方法时提供中性提醒：

```text
你选择的方法不是本次行动的来源方法。
本次复盘会为所选方法增加证据，原方法应用关系保持不变。
```

优点：

- 表达能力更符合真实复盘；
- 不污染或改写原方法应用关系；
- 不需要修改数据结构。

代价：

- 用户必须理解“使用来源”和“验证对象”是两种关系；
- 需要额外提示和回归测试；
- 证据详情必须清晰区分来源方法上下文。

### 12.4 技术建议

建议采用方案 B：允许切换，但明确提示。

理由：数据模型本身支持两个不同关系并存，强行锁定会把产品真实表达能力收窄。关键不是禁止切换，而是不能让界面混淆“实际使用的方法”和“本次验证的方法”。

该项需要产品经理正式裁决，前端不得自行选择。

## 十三、流转历史右侧抽屉

### 13.1 放置层级

抽屉应放在事项详情工作区内部，作为事项详情的覆盖层：

```text
ActionsModule
└── ItemWorkspace（position: relative）
    ├── ItemDetailContent
    └── TimelineDrawer（position: absolute）
```

它相对事项详情工作区定位，而不是相对整个浏览器窗口固定定位。这样不会覆盖左侧事项列表和全局导航，也不会变成全应用级侧边栏。

### 13.2 不进入正文流

事项详情容器设置定位上下文，抽屉使用绝对定位：

```text
top: 0
right: 0
bottom: 0
position: absolute
```

抽屉不占据正文宽度，不改变标题、正文、操作区和复盘区域的布局尺寸。

### 13.3 宽度

桌面端建议：

```css
width: clamp(360px, 40%, 420px)
```

含义：

- 理想宽度为详情区 40%；
- 最小 360px；
- 最大 420px。

当详情区不足以容纳 360px 时进入小屏降级规则。

### 13.4 滚动

- 抽屉高度限制在事项详情工作区；
- 抽屉头部可保持固定；
- 事件列表使用 `overflow-y: auto` 独立滚动；
- 正文容器不因抽屉打开改变 `scrollTop`；
- 打开和关闭抽屉不调用正文 `scrollIntoView`；
- 关闭后正文保持原滚动位置。

### 13.5 打开与关闭

规则：

- 点击“流转历史”打开；
- 再次点击同一入口关闭；
- 点击抽屉关闭按钮关闭；
- 切换事项时关闭；
- 切换到回收站或清空事项选择时关闭；
- 普通切换一级模块后返回，可以保留或关闭，但不得闪现上一事项历史；最小安全方案是切模块时关闭。

### 13.6 Esc

当前 Taro H5 可以在页面组件中通过浏览器 `keydown` 事件低风险支持 `Escape`：

- 仅在抽屉打开时注册；
- 关闭或组件卸载时移除；
- 输入框中按 Esc 也可关闭抽屉，但不得提交或清空表单；
- 小程序端不依赖键盘事件，不影响跨端核心逻辑。

因此建议将 Esc 作为 H5 桌面端验收项，但实现必须隔离在 H5 表现层，不进入 Domain 或 Application。

### 13.7 层级

建议建立明确层级顺序：

```text
普通正文
< 流转历史抽屉
< 搜索等普通全局浮层（如当前存在）
< 删除确认 / 恢复确认 / 恢复进度等高风险层
```

抽屉不使用最高全局 `z-index`。删除确认和恢复确认必须通过更高层级覆盖抽屉，必要时打开高风险确认时暂时禁用抽屉交互。

### 13.8 遮罩

桌面端不需要大面积遮罩，可以使用：

- 清晰边界；
- 轻阴影；
- 实色背景。

抽屉覆盖区域下方内容不可点击，未覆盖的正文是否允许交互由 UI 决定；建议抽屉打开时仍允许关闭入口，但不在抽屉下方误触操作。

### 13.9 小屏最低可用方案

本轮不进入 Layout Sprint 3，但必须保证小屏不失效：

```text
详情区宽度不足
→ 抽屉 width: 100%
→ 覆盖整个事项详情区
→ 保留关闭按钮
→ 内部独立滚动
```

不要求本轮实现完整移动端手势、底部导航协调或动画体系。

## 十四、预计修改的文件和模块

### 14.1 前端主修改

必然涉及：

```text
apps/client/src/pages/index/index.tsx
apps/client/src/pages/index/index.scss
```

预计内容：

- 方法列表—详情结构；
- 方法工作台选中状态；
- 局部搜索与排序；
- 证据和版本折叠区；
- 外部方法和历史版本定位；
- 复盘两个方法动作；
- 来源方法默认初始化与守卫；
- 形成 / 修订文案；
- 流转历史抽屉。

如果实施者需要降低 `index.tsx` 复杂度，可以新增：

```text
apps/client/src/pages/index/components/MethodsModule.tsx
apps/client/src/pages/index/components/MethodListPane.tsx
apps/client/src/pages/index/components/MethodDetailPane.tsx
apps/client/src/pages/index/components/TimelineDrawer.tsx
```

组件拆分不是引入全局状态库的理由。

### 14.2 最小只读业务能力补充

为完整证据详情建议涉及：

```text
packages/contracts/src/index.ts
packages/application/src/index.ts
packages/storage-indexeddb/src/index.ts
```

只允许增加：

- 方法证据详情只读类型；
- 方法证据关系枚举含 `unknown`；
- 按方法读取证据详情的 Repository 契约；
- Application 查询入口；
- IndexedDB 多表只读关联实现。

不允许改变：

- 方法证据写入结构；
- 方法版本写入规则；
- 验证次数含义；
- 事务流程；
- 表和索引。

### 14.3 测试

建议新增或扩展：

```text
tests/layout-sprint-two.test.ts
```

若页面组件测试基础设施成本过高，表现层继续采用静态审查和浏览器 UAT；业务读模型必须有自动化测试。

## 十五、底层架构影响

| 层级 | 是否修改 | 结论 |
|---|---:|---|
| Domain | 否 | 状态机和核心业务规则不变 |
| Contracts | 是，最小 | 增加只读证据详情和查询契约 |
| Application | 是，最小 | 暴露按方法读取证据详情的只读用例 |
| Repository | 是，最小 | 多表关联读取，不改变写入 |
| IndexedDB Schema | 否 | 不新增字段、表或索引 |
| Migration | 否 | 现有存储结构不变 |
| JSON 备份格式 | 否 | 不新增持久化字段 |
| Docker / 部署 | 否 | 构建和运行形态不变 |
| 路由 | 否 | 复用单页导航目标 |
| 全局状态库 | 否 | 继续使用页面 React 状态 |

如果产品取消“完整证据列表及关系类型”要求，本轮可以完全不修改 Contracts / Application / Repository，仅使用现有版本来源展示。但这将无法展示全部仅验证证据，不满足当前 PRD。

## 十六、现有能力可直接复用

### 方法主体

- `ReviewApplicationService.listMethods()`；
- 当前 `Method` 的标题、步骤、说明、版本、验证次数和更新时间。

### 版本历史

- `ReviewApplicationService.listMethodVersions(methodId)`；
- `MethodVersion.sourceReviewId`；
- `ReviewApplicationService.getReview(reviewId)`。

### 方法复用

- `MethodApplicationService.createItem(...)`；
- 创建时冻结当前方法版本；
- 创建成功后进入行动并定位事项。

### 来源方法上下文

- `MethodApplicationService.getContextForItem(itemId)`；
- `MethodApplicationContext.application`；
- 冻结版本快照 `context.version`；
- 当前方法 `context.method`。

### 复盘提交

- `CompleteReviewInput.method`；
- `CompleteReviewInput.existingMethod`；
- 不处理 / 仅验证 / 修订并验证的现有写入行为；
- 形成和验证互斥校验；
- 复盘事务原子性。

### 跨模块定位

- Layout Sprint 1 的 `NavigationTarget`；
- `navigateTo`；
- 事项分页定位；
- 复盘区域延迟定位；
- 方法和历史版本待定位机制；
- 目标不存在提示。

### 状态历史

- `ItemApplicationService.listStatusEvents(itemId)`；
- 当前时间线数据和正序显示；
- 切换事项时关闭时间线的现有行为。

### 数据安全

- 完整 JSON 备份；
- 安全恢复；
- 方法证据、版本和应用关系的备份校验。

## 十七、重点回归风险

### P0：历史证据被错误标注

不能把无法确定的早期数据强行标成形成、验证或修订。必须由统一读模型返回 `unknown`。

### P0：来源默认值覆盖用户选择

异步 `MethodApplicationContext` 返回、数据刷新或 Effect 重跑后，不得重新覆盖用户已经取消或切换的方法决策。

### P0：工作台方法选择污染复盘方法选择

方法模块详情选择和复盘验证方法必须使用不同状态。

### P0：仅验证错误生成版本

仅验证提交必须保证 `revision = undefined`，不能因为修订草稿仍保留就被误发送。

### P0：切换动作时提交隐藏草稿

`create` 和 `validate` 草稿可以保留，但提交只能使用当前 `methodMode` 对应的数据。

### P0：切换其他方法后误改来源关系

选择方法 B 验证时不得修改原 `MethodApplication` 的方法 A 和版本。来源上下文保持只读。

### P0：抽屉层级覆盖删除或恢复确认

高风险确认必须高于时间线抽屉，恢复流程不得被抽屉阻挡。

### P1：局部搜索隐藏当前选择

搜索结果排除当前方法时按已确认策略清除详情，不能左侧无选中、右侧继续展示旧方法而不提示。

### P1：外部定位被局部搜索阻挡

全局搜索和仪表盘定位时自动清空方法局部搜索词，并选中目标方法。

### P1：历史版本定位时数据尚未渲染

必须等待版本数据加载和 DOM 渲染后再滚动、高亮，不能依赖不稳定的固定延时。

### P1：证据缓存过期

形成、验证或修订成功后，对应方法的证据和版本缓存必须失效或刷新。

### P1：来源方法已不存在或版本断裂

正常备份校验会阻止断裂方法应用。运行中若读取不到完整上下文，应显示明确错误，不默认选择其他方法。

### P1：抽屉推动正文或改变滚动位置

抽屉必须脱离文档流；打开、关闭和内部滚动不得修改正文 `scrollTop`。

### P1：切换事项出现上一事项历史闪现

事项 ID 变化时立即关闭抽屉并清理旧事件显示，异步返回需核对目标事项。

### P2：范围滑入关系型搜索或 Layout Sprint 3

不得扩大全局搜索结果类型，不做完整移动端抽屉体系、搜索浮层或复杂响应式。

## 十八、自动化测试范围

### 18.1 必须保留的现有测试

继续运行：

```text
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:h5
```

现有 50 项测试必须全部通过。

### 18.2 新增只读证据详情测试

必须覆盖：

1. v1 来源复盘返回 `formation`；
2. 仅验证复盘返回 `validation`；
3. v2+ 来源复盘返回 `revision` 和版本号；
4. 返回正确 `itemId`、事项标题、复盘摘要和时间；
5. 多条证据按时间倒序；
6. 早期迁移歧义数据返回 `unknown`，不猜测；
7. 不存在的方法返回空或明确错误，行为固定；
8. 查询不修改任何表。

### 18.3 现有方法语义回归

必须继续验证：

- 形成方法新增 v1、证据和验证次数；
- 仅验证增加证据与验证次数，不新增版本；
- 修订增加证据、验证次数和版本；
- 同一复盘不能重复验证同一方法；
- 形成与验证不能同时提交；
- 失败时事务回滚；
- 方法应用冻结使用版本；
- 方法后续修订不污染使用版本；
- 备份恢复保留证据、版本和应用关系。

## 十九、人工回归范围

### 19.1 方法工作台

- 方法以列表—详情显示；
- 一屏可浏览多条方法；
- 列表只显示摘要；
- 当前方法选中明确；
- 最近更新排序正确；
- 验证最多排序及并列规则正确；
- 局部搜索只搜名称和当前步骤；
- 搜索无结果时详情按裁决清空；
- 返回方法模块时保留上下文。

### 19.2 方法详情

- 当前步骤和补充说明正确；
- 用方法发起行动草稿在模块切换后保留；
- 创建失败保留草稿；
- 创建成功进入行动并选中新事项；
- 证据默认折叠并按时间倒序；
- 关系类型正确或诚实显示未知；
- 版本默认折叠并按版本倒序；
- 来源复盘入口正确。

### 19.3 跨模块定位

- 全局搜索当前方法后选中详情；
- 全局搜索历史版本后展开并高亮版本；
- 方法形成、验证、修订和复利指标定位方法；
- 方法发起行动指标定位事项；
- 外部定位自动清除阻挡目标的局部搜索；
- 证据反向定位事项复盘；
- 目标不存在时不显示上一对象。

### 19.4 普通事项复盘

- 默认 `none`；
- 不显示“不沉淀方法”；
- create 可选中、再次点击取消；
- validate 可选中、再次点击取消；
- 两者互斥；
- 切换时草稿保留；
- none 可完成复盘；
- 提交只使用当前动作草稿；
- “下一次怎么做”和“更新后的做法”文案正确。

### 19.5 方法来源事项复盘

- 展示来源方法和实际使用版本；
- 初次进入默认 validate 来源方法；
- 默认不修订；
- 用户取消后刷新不重新选中；
- 用户输入后异步返回不覆盖；
- 切换事项不会继承上一事项选择；
- 按产品裁决验证切换其他方法或锁定行为；
- 取消方法处理不删除应用关系；
- 仅验证不生成版本；
- 修订才生成版本。

### 19.6 流转历史抽屉

- 打开不推动正文；
- 正文滚动位置保持；
- 抽屉内部独立滚动；
- 关闭按钮关闭；
- 再次点击入口关闭；
- H5 Esc 关闭；
- 切换事项立即关闭；
- 不显示上一事项事件；
- 删除和恢复确认覆盖抽屉；
- 小屏至少可以全宽覆盖并关闭。

### 19.7 完整安全回归

- 事项状态机不变；
- 搜索事项与复盘不变；
- 仪表盘统计口径不变；
- 回收站不变；
- JSON 导出不变；
- 安全恢复不变；
- 恢复后方法详情、证据、版本和应用上下文一致。

## 二十、需要产品经理再次裁决的问题

### 决策 1：历史关系未知的展示

早期迁移数据可能无法可靠还原形成 / 验证 / 修订。

选项：

- **A：接受显示“历史关系未知”**，本轮继续，不改 Schema 和备份；
- B：要求全部精确分类，则暂停 Layout Sprint 2，另立人工修复 / 数据校正项目。

技术建议：A。

### 决策 2：来源方法事项是否允许切换验证对象

选项：

- A：锁定来源方法，简单但限制真实表达；
- **B：允许切换，但明确显示来源方法与本次验证方法不同，且不修改原应用关系**。

技术建议：B。

### 决策 3：局部搜索排除当前方法时的详情行为

选项：

- **A：清除当前选择并显示未选择状态**；
- B：保留详情并提示当前方法不在搜索结果。

技术建议：A，降低隐藏上下文。

### 决策 4：仪表盘修订下钻是否必须精确定位版本

当前下钻结构主要提供方法 ID，现有页面曾从展示文案解析版本号，技术上不稳健。

选项：

- **A：本轮保证定位正确方法；只有存在可靠结构化版本号时才定位具体版本**；
- B：要求所有修订下钻精确到版本，则需要最小扩展 Dashboard 下钻契约，增加结构化 `methodVersion`。

技术建议：A，避免为非核心场景扩大契约；全局搜索历史版本仍必须精确定位版本。

### 决策 5：切换事项再返回时是否保留“已取消来源方法默认验证”的选择

为保证“取消后刷新不再选中”，建议在当前页面会话中按事项 ID 记录方法决策是否已触碰。

选项：

- **A：本次页面会话内记住取消 / 选择，刷新浏览器后重置**；
- B：切走事项再回来重新默认验证来源方法。

技术建议：A，更符合用户明确操作优先原则，且不需要持久化草稿。

## 二十一、技术裁决与实施门槛

### 21.1 推荐技术方案

```text
单个 Taro 页面与现有四模块骨架
+ 独立方法工作台选中状态
+ 客户端局部搜索和排序
+ 现有版本历史懒加载
+ 最小只读方法证据详情契约
+ MethodApplicationContext 一次性默认初始化
+ initialized / touched 异步守卫
+ none / create / validate 状态机
+ create / revision 独立前端草稿
+ 事项详情内 absolute 时间线抽屉
```

### 21.2 明确不采用

```text
新路由
全局状态库
新的 IndexedDB 表或字段
新的 Migration
新的 JSON 备份版本
前端直接读取 Dexie
前端根据文案或时间猜测关系类型
强制每次复用都修订方法
关系型全局搜索
Layout Sprint 3 响应式重构
```

### 21.3 进入实施前必须满足

1. 产品经理完成第二十节五项裁决；
2. 产品接受历史迁移证据可能显示 `unknown`，否则本轮暂停；
3. 总体架构将裁决结果补入 PRD 或产品评审结论；
4. 后端会话只实现最小只读证据详情能力并先完成测试；
5. UI 会话在稳定契约上实施工作台和复盘交互；
6. 不得在前端临时拼接 Dexie 数据绕过契约。

## 二十二、实施中必须暂停的条件

出现以下任一情况应停止并返回架构 / 产品评审：

1. 要求对无法确定的旧证据强行分类；
2. 需要新增或修改 IndexedDB Schema；
3. 需要修改 JSON 备份格式；
4. 来源方法默认验证需要改变方法应用关系；
5. 需要修改验证次数或版本生成语义；
6. 需要引入路由或全局状态库；
7. 需要扩大全局搜索范围或结果类型；
8. 流转抽屉扩大为完整事项侧边栏重构；
9. 范围进入 Layout Sprint 3、AI、方向、计划、附件或云同步。
