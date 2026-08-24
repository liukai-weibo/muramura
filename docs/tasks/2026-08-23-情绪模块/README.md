# 情绪模块「月度情绪日历 + 卡片网格」实施记录

## 要解决的问题

用户需要一个轻量的情绪记录入口：每天记录当时的心情（温和的五档分级，不用刺眼的冷色），
在月度日历上看到分布，并通过卡片网格回看每天写下的具体事件与自我回应。

## 最终形态

- 主导航新增「情绪」入口（位于「手记」之后），懒加载挂载，切换模块后保留状态。
- 月度情绪日历：周一开头，42 格，有记录的日期按综合情绪着色，悬停显示当日综合情绪与记录数。
- 卡片网格：按日期倒序展示记录卡片（情绪点、首行标题、标签、日期），点击打开详情。
- 记录/编辑弹窗：正文、五档情绪选择（默认 3）、标签（去空白去重、上限 10 个）、自我回应、日期。
- 等级筛选：工具栏按 1–5 级过滤日历与卡片。
- 视觉：奶油线稿规范，深浅两套主题变量，CSS-only 动效，未引入 Framer Motion。

## 改动位置与原因

| 层 | 文件 | 改动 |
| --- | --- | --- |
| Migration | migrations/021_add_mood_entries.sql | 新增 mood_entries 表，外键指向 users，复合索引 |
| Contracts | packages/contracts/src/mood.ts | MoodEntry / MoodEntryInput / MoodEntryRepository / MoodEntryBackupStore 接口与常量 |
| Contracts | packages/contracts/src/backup.ts | BackupDataV6（含 moodEntries）、BackupDocumentV6、版本联合升级 |
| Contracts | packages/contracts/src/errors/business.ts | 新增 MOOD_ENTRY_INVALID / MOOD_ENTRY_NOT_FOUND 业务码 |
| Application | packages/application/src/mood.ts | MoodEntryApplicationService：listRange / create / updateMine / deleteMine |
| Application | packages/application/src/backup.ts | 支持 V6 备份：解析校验、导出升 V6、恢复写入 mood store |
| Storage | packages/storage-mysql/src/mood-entry-repository.ts | MySqlMoodEntryRepository CRUD + 备份导出/替换（事务） |
| Storage | packages/storage-mysql/src/index.ts | MYSQL_REQUIRED_SCHEMA_VERSION 20 升 21；导出仓储 |
| API | apps/api/src/hono/routes/mood-entries.ts | GET/POST/PUT/DELETE，503 门与 schema 版本一致 |
| API | apps/api/src/hono/app.ts | 挂载 /mood-entries；移除重复挂载的 createAiRoutes 修复路由表对齐 |
| API | apps/api/src/hono/services.ts | scoped 服务注入 moodEntryRepository（含备份 store） |
| Client | apps/client/src/pages/index/features/mood/ | 五档配置/综合分/网格工具、日历、卡片、记录/详情弹窗、页面与样式 |
| Client | apps/client/src/pages/index/index.tsx | 主导航「情绪」入口、懒加载、模块渲染 |
| Client | apps/client/src/pages/index/cream-ui-theme.scss | 浅/深两套 mood 主题变量 |
| Client | apps/client/src/pages/index/api-client.ts | listMoodEntries / createMoodEntry / updateMoodEntry / deleteMoodEntry |
| Tests | tests/mood-*.test.ts | 综合分、日历网格、Application 校验、MySQL 集成（随机临时库） |
| Tests | tests/hono-route-table.test.ts | 补充 mood-entries 及既有缺失路由，修复对齐断言 |

## 设计取舍

- 数据模型只保留单个 content 字段（首行为标题），不设独立 title 列；tags 仅记录、第一阶阶段不提供按标签筛选。
- 「存为方法」等 AI 联动推迟到第二阶段。
- 情绪等级色板按 1→5 为紫、蓝紫、暖白、绿、暖黄（1 不愉快 → 5 愉快），深浅两套主题变量。
- 日历悬停提示用 CSS hover 媒体查询实现，避免 Taro View 不支持的 mouse 事件，weapp 端安全。
- 备份格式只升不降：有 moodEntries 时导出 V6，V1–V5 仍可解析恢复。

## 2026-08-23 追加：移除标签、日期指定新建、默认年视图

### 变更内容

- **移除标签交互**：新建/编辑弹窗删除标签输入行与标签 chips；卡片与详情弹窗不再展示标签。数据层（`mood_entries.tags` 列、契约 `tags` 字段、Application 归一化、Backup V6 `moodEntries.tags`）保留兼容：存量记录不丢失、新记录写空数组、备份格式不变；需要 Migration/备份格式变动的彻底剥离不在本轮范围。
- **日期指定新建**：日历选中某天后点「＋ 新建情绪记录」，新建弹窗日期预填选中日（可手动改）；未选中时默认今天。`MoodRecordModal` 新增 `initialDate` prop。
- **默认年视图**：进入情绪模块默认显示当前年 12 个小月历（6 列 × 2 行，按情绪等级着色），‹ › 切换年份；点击某天进入对应月视图并选中该日；工具栏「年视图 / 月视图」切换，切换时清空选中日。年视图加载全年数据（`from=1/1 to=12/31`），月视图加载当月。

### 改动位置

| 文件 | 改动 |
| --- | --- |
| mood-record-modal.tsx | 删标签 state/输入/chips；新增 initialDate；提交不再带 tags |
| mood-card.tsx | 删标签展示块 |
| mood-detail-modal.tsx | 删标签展示块 |
| mood-calendar.tsx | 支持 year/month 双模式；年视图 12 月历 + 切换年份 + 点击进月 |
| mood-page.tsx | view 状态（默认 year）；按视图加载全年/当月；initialDate 传递；视图切换按钮 |
| mood-page.scss | 删标签样式；新增视图切换与年视图布局（6 列×2 行，窄屏降列）；年格子固定行高避免撑爆 |

### 验证

- typecheck 通过；Playwright 实机验收：年视图 12 月历布局无撑爆（日历 353px，卡片区可滚动）、点击日期进月视图并预填日期、保存后着色、弹窗/卡片/详情无标签、年⇄月切换与 ‹ › 年份导航正常、深色主题正常。

## 2026-08-23 再迭代：当月仅显、日期只读、默认月视图、年视图单选、等级筛选

### 变更内容

- **日历仅显示当月日期**：月视图与年视图小历均只渲染当月天数，跨月位置为空占位（.mood-cell-placeholder，不可点）。mood-levels 新增 buildMonthDays 纯函数（offset 占位 + 当月天数），buildMonthGrid（42 格跨月）保留供既有测试与兼容。
- **新建日期只读**：记录弹窗日期由选中日/今天决定，改为只读展示（.mood-date-readonly），移除手动编辑入口。
- **默认月视图**：view 初始值由 year 改为 month，刷新/重进恢复月视图；年视图保留可切换。
- **年视图单选**：点击年视图某天仅选中当日（日历高亮、卡片区显示该日记录），不再跳转月视图；再次点击取消选中；移除 onEnterMonth 机制。
- **等级筛选可用**：全部等级 ▾ 下拉菜单（全部 + 1–5 级），选择后按等级过滤日历着色与卡片；点击外部关闭。

### 改动位置

| 文件 | 改动 |
| --- | --- |
| mood-levels.ts | 新增 buildMonthDays（offset 占位 + 当月天数） |
| mood-calendar.tsx | 按月渲染 placeholder/当月格；删除 mini 跳月逻辑与 onEnterMonth prop；年视图选中高亮 |
| mood-page.tsx | 默认 view=month；移除 handleEnterMonth；新增筛选下拉（filterOpen/menu/backdrop） |
| mood-record-modal.tsx | 日期 Input 改为只读展示（.mood-date-readonly）；setEntryDate 仅初始化 |
| mood-page.scss | 网格 grid-auto-rows 动态行高；placeholder/只读日期/筛选菜单与遮罩样式；年卡 align-self:start |
| tests/mood-calendar-utils.test.ts | 新增 buildMonthDays 3 组测试（偏移、2 月无 30/31、占位在前） |

### 验证

- typecheck 通过；mood-calendar-utils 8 项测试通过；H5 生产构建通过。
- Playwright 实机验收：默认月视图+刷新恢复；当月仅显（8 月 5 占位+31 天，1 月 3 占位+31 天）；跨月位置空占位不可点；新建日期只读（今天/选中日）；年视图点击选中/取消不跳月；等级筛选实际过滤卡片与日历；点外部关闭；窄屏年视图降 2 列；深色主题正常；页面无撑爆。

## 2026-08-23 第三轮：首页情绪入口卡 + 迁移到灵感todo 第四 Tab

### 变更内容

- **首页情绪渐变卡**（home-dashboard/home-mood-card.tsx + home-dashboard.scss）：全宽横幅卡，提示语「今天有感到开心吗？」，背景为情绪色板 紫→蓝紫→绿→暖黄 对角渐变，叠加 radial 光斑（.home-mood-card-glow）增强质感；奶油 22px 圆角、柔和阴影、hover 上浮（复用 card-transition）；深色主题用深色版色板 + 浅色文字；≤720px 降字号保持全宽。
- **入口联动**：点击卡片任意位置 → openWorkbenchTab 语义（setWorkbenchTab('mood') + setPrimaryModule('workbench') + setMoodMounted(true)）+ moodCreateRequest 计数自增 → MoodPage 新增 createRequest prop，useEffect 变化时自动 setModal({kind:'create'})，新建日期默认今天（selectedDate 为空）。
- **模块迁移**：情绪由独立主导航项迁移为 灵感todo 第四子 Tab（WorkbenchTab 增 'mood'；DesktopTitleBar 与 fast-ui-tabs 两处 tab 数组各加 ['mood','情绪']；导航区删除 ☁ 情绪项；PrimaryModule 移除 'mood'）。openWorkbenchTab 对 'mood' 跳过 setActiveModule（'mood' 不属于 ContentModule，activeModule 保持合法值）；MoodPage 渲染块挂到 primaryModule==='workbench' && workbenchTab==='mood'，保留 module-retained。

### 改动位置

| 文件 | 改动 |
| --- | --- |
| home-dashboard/home-mood-card.tsx | 新增渐变卡组件（kicker/标题/副文案/action，整卡 onClick） |
| home-dashboard/index.tsx | import + onOpenMoodCreate prop + 渲染 |
| home-dashboard/home-dashboard.scss | .home-mood-card 渐变/光斑/悬停/深色/响应式 |
| index.tsx | WorkbenchTab 增 mood；PrimaryModule 删 mood；导航删情绪项；两处 tab 数组加情绪；openWorkbenchTab 跳过 mood 的 setActiveModule；openPrimaryModule 窄化 workbenchTab；moodMounted 条件；MoodPage 渲染块 + moodCreateRequest 状态与 HomeDashboard 回调 |
| features/mood/mood-page.tsx | MoodPageProps 增 createRequest？；自动开新建弹窗 effect |

### 验证

- typecheck 通过；mood-calendar-utils 8 测试通过；H5 生产构建通过。
- Playwright：首页渐变卡存在（标题/渐变/光斑、936×131）；主导航无独立情绪项；点击卡片 → 自动切灵感todo·情绪 + 弹窗自动打开（日期=今天只读）；四 Tab 齐全；保存记录后日历着色；情绪 Tab 内月视图/筛选/年视图正常；深色主题渐变卡可读；500px 无溢出；Tab 切换不重挂载。

## 当前进度

- 全链路（Migration → Contracts → Application → Storage → API → H5）实现完成。
- typecheck 通过；新增/受影响定向测试 27 项通过；MySQL 集成测试无环境时跳过。
- H5 生产构建通过。
- Migration 021 已在日常库执行（Schema 21）；UAT 库尚未执行 021，未迁移不得视为可用。
