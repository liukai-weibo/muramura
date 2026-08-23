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
- 视觉：奶油线稿规范，情绪色板全部为暖色，深浅两套主题变量，CSS-only 动效，未引入 Framer Motion。

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
- 情绪等级色板 1 级用暖雾灰而非冷蓝灰，满足奶油规范无冷色约束。
- 日历悬停提示用 CSS hover 媒体查询实现，避免 Taro View 不支持的 mouse 事件，weapp 端安全。
- 备份格式只升不降：有 moodEntries 时导出 V6，V1–V5 仍可解析恢复。

## 当前进度

- 全链路（Migration → Contracts → Application → Storage → API → H5）实现完成。
- typecheck 通过；新增/受影响定向测试 27 项通过；MySQL 集成测试无环境时跳过。
- H5 生产构建通过。
- Migration 021 尚未在任何运行库执行：本地与 UAT 均停在旧 Schema，执行前必须先 /health 确认目标库，并在 UAT 按序演练。
