# 今日饮食推荐（首页 2x3 布局）

## 目标与最终形态

首页在既有「手记+主横幅 / 情绪+三餐 / 状态小结」之上，新增一张「今日饮食推荐」卡片，与状态小结并排成第三行，形成 2x3 卡片布局。推荐内容由全局 AI（非饮食专用 prompt）自动生成，可覆盖饮食、作息、行动或心情，1-2 点，150 字内，不编造。每天自动生成一次（跨天检测 + 午夜补触发），弹窗内可手动重新生成。

## 主要任务与改动位置

| 改哪里 | 怎么改 | 为什么 |
| --- | --- | --- |
| migrations/024_add_daily_diet_recommendations.sql | 新增 daily_diet_recommendations 表（owner/日期一行 upsert，content 1200，无 DELETE） | 镜像每日状态小结的落库方式，每日一条推荐 |
| packages/contracts/src/daily-diet.ts + index.ts + errors/business.ts | DailyDietRecommendation 契约/仓储接口 + DIET_RECOMMENDATION_INVALID 并入主 union | 数据契约与错误体系接入既有分层 |
| packages/application/src/daily-diet.ts + index.ts | DailyDietRecommendationApplicationService（校验、未来日期拒绝、upsert/listRange/getByDate） | 业务校验与写入编排与状态小结对齐 |
| packages/storage-mysql/src/daily-diet-repository.ts + index.ts | MySqlDailyDietRecommendationRepository + MYSQL_REQUIRED_SCHEMA_VERSION=24 | MySQL 读写 + Schema 启动门 |
| packages/contracts/src/backup.ts + packages/application/src/backup.ts | Backup V9 含 dailyDietRecommendations 导出/恢复；restoreBackup 对 V8/V9 的 dailySummaries 一并恢复 | 备份格式升级；修复 V9 恢复丢弃状态小结的门槛 bug |
| apps/api/src/hono/routes/daily-diet.ts + app.ts + services.ts | GET /api/v1/daily-diet 范围、GET /{entryDate}、PUT /{entryDate}；挂载与服务/repo 组装（backup 第 8 参） | 后端 API |
| apps/client/api-client.ts | listDailyDietRecommendations / getDailyDietRecommendation / upsertDailyDietRecommendation | 前端 API 客户端 |
| apps/client/features/daily-diet/ | daily-diet-auto.ts（DIET_PROMPT + 自动/午夜）、daily-diet-detail-modal.tsx、daily-diet.scss | 自动生成与细节弹窗 |
| apps/client/home-dashboard/home-daily-diet-card.tsx + home-dashboard.scss | 饮食卡组件 + 2x3 布局（checkin 两列 + 新增 home-dynamic-row 两列 + 720px 单列）+ 卡样式 | 首页布局与卡片 |
| apps/client/home-dashboard/index.tsx + index.tsx | 状态小结从 checkin-row 移入 dynamic-row、新增饮食卡与弹窗接线、todayDiet/dietChangedAt 状态与午夜调度 | 首页数据接入与联动 |
| tests/ | daily-diet-application / mysql-daily-diet.integration / backup-v9-daily-diet；hono-route-table +3；hono-rpc 备份版本断言含 9 | 自动化验证 |
| docs/product/当前运行事实.md + docs/daily-contributions/2026-08-25.md | Schema 24 事实 + 每日贡献 | 状态锚点与贡献记录 |

## 实施注意事项

- AI 生成走全局 /experimental/ai-chat/stream-ephemeral（不落 AI 会话历史），prompt 非饮食专用；不注入状态小结（主 AI 本就不注入）。
- daily-diet 与 daily-summary 共用 startMidnightAutoGenerate 调度（单一来源），各自独立 last-seen-date key 与守卫。
- home-dashboard.scss 中 .home-dynamic-row 基础定义（两列）必须先于 media 块出现，否则会被 media 内单列规则覆盖导致 720px 不降级（曾踩坑：scss 追加顺序导致单列失效，已修复）。
- 迁移前对本地 knowledge_base 做逻辑备份（项目外 维护相关/运行库备份/schema23-before-024-2026-08-25.sql），UAT 未迁移不得视为可用。

## 当前进度

- 数据层 / Backup V9 / API / 前端 / 测试 / 迁移 024 / QA 全部完成；/health 实测 ready / knowledge_base / schemaVersion=24；自动生成、手动生成、2x3 布局、720px 单列降级经 Playwright 实测通过。文档就绪，等待提交归档（commit 与 push 需用户确认）。
