# 首页自定义 AI 卡片

## 目标与最终形态

给首页提供一张「自定义 AI 卡片」入口：用户用一句话（提示词）定义一张卡片，让它每天（或手动）调用全局 AI 生成一段简短内容展示在首页，把自己的高频问题/关注点沉淀成固定卡片。每张卡片可配置标题、提示词、尺寸（small/medium/large）、主题（cream/green/beige）与刷新方式（daily/manual）；当天生成结果按 `(用户, 卡片, 日期)` 幂等缓存，跨天自动刷新，已有缓存不重复生成。

当前运行形态：系统卡（手记卡、横幅、情绪、三餐、近期状态小结、今日饮食推荐）保持不动，自定义卡全部放在其下的 `.home-custom-ai-row` 两列网格中（≤720px 单列），行尾为虚线「➕ 新增自定义AI卡片」占位。卡片点击打开详情弹窗（完整内容 + 手动刷新 + 删除），⚙️ 打开编辑弹窗。

## 主要任务与改动位置

| 改哪里 | 怎么改 | 为什么 |
| --- | --- | --- |
| migrations/026_add_home_ai_cards.sql | 新增 user_home_ai_cards（id CHAR(36) 主键、owner_user_id 外键 users、card_title VARCHAR(50)、ai_prompt TEXT、card_size/card_theme/refresh_mode 枚举带默认、sort_index、is_hidden、created_at/updated_at DATETIME(3)，KEY (owner_user_id, sort_index)）与 user_home_ai_card_caches（id、owner_user_id、card_id 外键 ON DELETE CASCADE、cache_date DATE、ai_output TEXT、UNIQUE (owner_user_id, card_id, cache_date)） | 卡片配置与当日生成缓存的落库结构；UNIQUE 保证同卡同日幂等 |
| packages/contracts/src/home-ai-card.ts + index.ts | HOME_AI_CARD_TITLE_MAX_LENGTH/PROMPT_MAX_LENGTH/OUTPUT_MAX_LENGTH/MAX_PER_USER 常量，HomeAiCardSize/Theme/RefreshMode、HomeAiCard、HomeAiCardInput、HomeAiCardCache、HomeAiCardRepository、HomeAiCardBackupStore 契约 | 数据契约与分层接口 |
| packages/contracts/src/backup.ts | BackupDataV10/BackupDocumentV10（在 V9 基础上加 homeAiCards/homeAiCardCaches）、备份联合与 BackupRepository 签名扩展 | 备份版本升至 V10 |
| packages/contracts/src/errors/business.ts | 新增 HomeAiCardErrorCode（HOME_AI_CARD_INVALID / HOME_AI_CARD_CACHE_INVALID）并入 BusinessErrorCode 联合、category 映射与公开白名单 | 统一业务失败码 |
| packages/application/src/home-ai-cards.ts + index.ts | HomeAiCardApplicationService：list/get/create/update/delete/listCaches/getCache/upsertCache；校验标题 ≤50、提示词 ≤2000、枚举、每用户最多 12 张、缓存日期合法且不晚于今天、输出 ≤4000 | 可信读写的业务编排与校验 |
| packages/application/src/backup.ts | createBackup 版本判定加 `'homeAiCards' in data ? 10 : ...`；V10 文档分支构建；V10 校验块（卡片唯一 id、字符串、枚举、整数 sortIndex、boolean isHidden、时间戳；缓存 cardId 必须引用已存在卡片、日期格式、无重复 (cardId, cacheDate)）；构造器第 9 参 homeAiCards；restoreBackup 对非 V10 备份重置两集合为空 | 备份导出/解析/恢复的确定性快照语义 |
| packages/storage-mysql/src/home-ai-card-repository.ts + index.ts | MySqlHomeAiCardRepository 实现 HomeAiCardRepository + HomeAiCardBackupStore：create 计算 MAX(sort_index)+1；delete 在事务内先删缓存再删卡；upsertCache ON DUPLICATE KEY UPDATE；replaceBackup 事务内清空重建 | MySQL 读写与备份往返 |
| packages/storage-mysql/src/index.ts | MYSQL_REQUIRED_SCHEMA_VERSION 25→26 | Schema 启动门 |
| apps/api/src/hono/services.ts | homeAiCards = userId ? new HomeAiCardApplicationService(new MySqlHomeAiCardRepository(pool, { userId })) : undefined；BackupApplicationService 第 9 参传入仓储 | 组装应用服务并让备份带上新集合 |
| apps/api/src/hono/routes/home-ai-cards.ts + app.ts | GET /home-ai-cards、GET /home-ai-cards/caches?date=、POST /home-ai-cards、PUT /:cardId、DELETE /:cardId、PUT /:cardId/caches/:cacheDate（OpenAPI 路由，503 守卫与 404 语义）；app.ts 挂载于 /home-ai-cards | 后端 API |
| apps/client/src/pages/index/api-client.ts | listHomeAiCards/createHomeAiCard/updateHomeAiCard/deleteHomeAiCard/listHomeAiCardCaches/upsertHomeAiCardCache 六方法（严格结构校验） | 前端 API 客户端 |
| apps/client/src/pages/index/features/home-ai-card/ | home-ai-card-view.tsx（卡片渲染，预览 150 字截断、⚙️ 编辑按钮 stopPropagation、loading/failed/empty 态）、home-ai-card-editor-modal.tsx（创建/编辑表单，ESC/蒙层关闭且保存中禁止关闭）、home-ai-card-detail-modal.tsx（完整内容 + 刷新/删除，生成中禁止关闭）、home-ai-cards-auto.ts（autoGenerateHomeAiCardsIfNeeded + 午夜定时补触发）、home-ai-card.scss（三尺寸/三主题 + 深色变体 + 虚线占位 + 弹窗样式 + 720px 单列） | H5 组件与自动生成 |
| apps/client/src/pages/index/home-dashboard/ | index.tsx 新 prop（homeAiCards/homeAiCardPreviews/loading/failed/onOpen/onEdit/onAdd）渲染 .home-custom-ai-row + 占位；home-dashboard.scss 两列网格 | 首页接线 |
| apps/client/src/pages/index/index.tsx | 状态块（cards/previews/loading/failed/changedAt、编辑弹窗、详情弹窗、删除确认）；changedAt effect 并行读卡+当日缓存、为 daily 缺失自动生成、重读缓存、挂午夜定时器；刷新走 streamExperimentalAiChatEphemeral([{role:'user',content:card.aiPrompt}]) 后 upsert 缓存 | 页面状态与自动化编排 |
| tests/ | home-ai-card-application / backup-v10-home-ai-cards / mysql-home-ai-cards.integration；hono-route-table（+6 路由）；hono-rpc 备份版本断言含 10；api-startup-diagnostics（Schema 26） | 自动化验证 |

## 实施注意事项

- 幂等纪律：编辑器保存卡片不触碰当日缓存；daily 自动生成只在「当天该卡无缓存」时调用，同一 (card, date) 永远只生成一次；页面开着跨 00:00 由定时器补触发。
- 已批准的产品决策：尺寸 small=紧凑 1 列（~120px）/medium=标准 1 列（260px）/large=跨两列整行；主题一期仅 cream/green/beige（既有系统色板）；系统卡保持不动，自定义卡独立成行；拖拽排序、系统卡隐藏开关与更多主题属二期。
- 降级语义：AI 未配置时自动生成跳过并保持空态（手动按钮可用）；单卡生成失败不自动重试；缓存写入失败不伪装成功。
- 备份语义：恢复 V9 及以下旧备份时两集合确定性重置为空（与其它集合快照语义一致）。
- 迁移纪律：026 已按序在 025 之后于本地日常 knowledge_base 执行（迁移前已做逻辑备份 schema25-before-026-2026-08-26-00-59-44.sql，项目外备份目录），/health 实测 ready / schemaVersion=26；UAT 库未迁移不得视为可用。
- 并发约束：与「安全审计中心」在途改动并行开发，涉及 services.ts/app.ts/api-client.ts 等共同文件时以重读后编辑为准，不覆盖他人改动。

## 当前进度

- 数据层/Contracts/备份 V10/Application/API/H5 组件/首页接线/自动化测试全部完成；typecheck 通过，build:h5 通过；home-ai-card-application（7）、backup-v10（3）、hono-route-table（5）、api-startup-diagnostics（7）、mysql-home-ai-cards.integration（3）定向测试通过；git diff --check 待最终执行。
- 真实库 Migration 026 已执行：本地 knowledge_base /health 实测 ready / schemaVersion=26，user_home_ai_cards 与 user_home_ai_card_caches 表已建（0 行）；API 已重启，openapi.json 确认四条 /home-ai-cards 路由注册，未认证请求 401。
- 未完成：真实运行验收需登录后人工执行（创建/自动生成/手动刷新/编辑/删除/大尺寸布局）；未 commit/push（需用户确认）。