# 2026-08-23 一日三餐

## 要解决的问题与最终形态

用户想在日常闭环里随手记下「今天吃了什么、吃得满意吗」，但不做热量 / 营养分析，也不做打卡或连续记录统计。

最终形态：
- 首页多一张「一日三餐 / 今天吃了吗？」渐变卡，点击后原地弹出今日三餐记录弹窗，不离开首页。
- 灵感todo 新增第五个子 Tab「三餐」，默认月视图（早/午/晚三色点），可切换到「年表格」按 1–5 档感受着色整年。
- 记录粒度是一天三餐：早餐 / 午餐 / 晚餐，每餐一条文字（可空，最长 1000）+ 感受（1 难吃 ~ 5 超满足，必填）。
- 数据落在 MySQL 新表 `meal_entries`，每 `(owner, entry_date, meal_type)` 一行，整日一起保存（非逐餐单独提交）。

## 主要任务与改动位置

| 改哪里 | 怎么改 | 为什么 |
| --- | --- | --- |
| `migrations/022_add_meal_entries.sql` | 新建 `meal_entries` 表，`UNIQUE(owner_user_id, entry_date, meal_type)`，外键指向 `users` | 每餐一条、可重复覆盖，相同餐次只保留最新 |
| `packages/contracts/src/meals.ts` | 定义 `MealType`、`MealEntry`、`MealSlotInput`、`MealDayInput` 与 `MealEntryRepository` / `MealEntryBackupStore` 接口 | 跨层契约统一，前后端共享 |
| `packages/application/src/meals.ts` | `MealEntryApplicationService`：日期合法性、拒绝未来日期、≤3 餐、去重、content≤1000、feeling 1–5 | 业务校验集中在 Application，不让前端或 Repository 各自兜底 |
| `packages/storage-mysql/src/meal-entry-repository.ts` | 实现 `listRange`（owner 隔离 + 日期范围）与 `saveDay`（事务内先删被省略餐次再 upsert）；`exportBackup` / `replaceBackup` | 整日写原子一致；备份可往返 |
| `apps/api/src/hono/routes/meals.ts` | `GET /api/v1/meal-entries?from&to`、`PUT /api/v1/meal-entries/{entryDate}` | H5 通过 API Client 访问，不直连 MySQL |
| `apps/api/src/hono/schemas.ts` + `packages/contracts/src/backup.ts` + `packages/application/src/backup.ts` | Backup 升到版本 7，含 `mealEntries` 导出/校验/恢复 | 备份仍覆盖全部数据，不丢三餐 |
| `apps/client/src/pages/index/features/meals/` | `meal-levels.ts`（五档色板 / 文案）、`meal-day-modal.tsx`（今日三餐弹窗）、`meals-page.tsx`（月视图 + 年表格）、`meals-page.scss` | 三餐的前端展示与记录交互 |
| `apps/client/src/pages/index/home-dashboard/` | `home-meal-card.tsx` + `index.tsx` + `home-dashboard.scss` | 首页入口卡，点击弹窗不跳转 |
| `apps/client/src/pages/index/index.tsx` | 加入 `meals` 子 Tab、`homeMealsOpen` 弹窗态、`mealsMounted` 保留模块、渲染 `MealsPage` / `MealDayModal` | 把模块接进工作台 |
| `tests/` | `meal-application.test.ts`、`meal-calendar-utils.test.ts`、`mysql-meals.integration.test.ts` | 覆盖校验、日历网格、MySQL upsert 与备份往返 |

## 实施注意事项

- 只做记录，不做统计：无热量 / 营养、无连续打卡、无图片上传；`feeling` 复用情绪五档色板，文案为 1 难吃 / 2 一般般 / 3 还行 / 4 好吃 / 5 超满足。
- 写入粒度整日：弹窗一次「保存」走 `PUT /meal-entries/{entryDate}`；后端按日期校验并拒绝未来日期，餐次去重。
- 不改情绪数据模型与页面；`mood_entries` 保持原样。
- 真实库执行 022 前已做逻辑备份 `维护相关/运行库备份/schema21-before-022-2026-08-23-17-07-51.sql`；`/health` 现为 `ready / knowledge_base / schemaVersion=22`。
- 三餐集成测试会创建随机临时库并全量跑迁移，耗时超过 5s 默认超时，因此两个用例显式 30s 超时。

## 当前进度

- 后端 + 契约 + 迁移 + 前端全部完成，`typecheck` 通过，`build:h5` 通过。
- 定向测试通过：三餐 Application 7 项、日历网格 4 项、MySQL 集成 2 项；路由表与 RPC 契约对齐。
- 三餐年视图由 12×31 年表格改为情绪式 12 个迷你月历（早/午/晚按感受着色的小圆点），视图切换文案 年表格 → 年视图，点击某天仍弹三餐弹窗。
- 修复情绪年视图迷你月历星期行高度泄漏基类 44px 导致的标签下大空白（`.mood-year-weekday-row` 改 `grid-auto-rows:14px`）。
- 情绪年/月视图同步三餐背景与交互（日期格圆角 8→12px、悬停补边框高亮 + 缩放波纹），保留整格情绪色填充。
- 修复情绪/三餐年视图悬停备注与月份标题被相邻月卡遮蔽（`:has()` 提升悬停月卡层级至 z-index:5 + 备注可换行且 max-width:180px）。
- Playwright 真实验收通过：首页卡弹窗不跳转、三餐弹窗有早/午/晚 + 感受、保存后月视图不再空态、情绪年视图星期行 14px 无空白、三餐年视图 12 迷你月历可点可存；悬停 8 月 23 号备注不再被 9 月卡遮住（8 月卡悬停时 z-index:5），情绪年视图响应式 6/4/2/1 列无回归。
- 未完成：未完整体回归「salty pre-existing」测试集（新版状态机契约收紧产生的历史用例），暂未 commit。