# 安全审计中心（一期）

## 目标与最终形态

给平台管理员提供一个只读的「安全审计中心」：在不修改既有业务语义的前提下，真实记录用户在内容模块上的变更与搜索操作，并支持按用户 + 功能模块 + 时间 + 操作类型 + 关键词筛选、分页查看与 CSV 导出。审计中心仅对 `platform_admin` 开放，普通管理员与普通成员不可见、不可访问。

## 主要任务与改动位置

| 改哪里 | 怎么改 | 为什么 |
| --- | --- | --- |
| migrations/025_add_activity_audit_events.sql | 新增 activity_audit_events 表（id VARCHAR(128) 主键；actor_user_id/actor_username；module_code/action_code 带 CHECK 枚举；entity_id 可空；snapshot TEXT 可空；risk_level 默认 normal；created_at DATETIME(3)；两条组合索引 + actor 外键 ON DELETE RESTRICT） | 审计事件的落库结构，独立于既有 security_audit_events（后台角色审计），互不混用 |
| packages/contracts/src/audit.ts + index.ts | auditModules/auditActions/ActivityAuditEvent 等契约与 ActivityAuditRepository/ActivityAuditRecorder/ActivityAuditEventDraft 接口 | 数据契约与分层接口 |
| packages/application/src/audit.ts + index.ts | ScopedActivityAuditRecorder（绑定 actor）与 safeAuditRecord（try/catch，失败仅告警不抛错） | 审计写入永远 best-effort，不阻断业务写入 |
| packages/storage-mysql/src/activity-audit-repository.ts + index.ts | MySqlActivityAuditRepository（record 用 UTC_TIMESTAMP(3)；filter/runPageQuery/runAllQuery；COUNT + LIMIT/OFFSET 按 created_at DESC,id DESC） | MySQL 读写与分页/导出 |
| packages/storage-mysql/src/index.ts | MYSQL_REQUIRED_SCHEMA_VERSION 24→25 | Schema 启动门 |
| packages/application/src/{meals,daily-notes,mood,items-and-tracks,read-models}.ts | 各服务构造器新增可选 auditRecorder，业务写入成功后追加事件：手记 getOrCreateToday=create（仅首次）、updateMine/appendToday=update；情绪 create/update/delete（delete 前预读内容）；三餐 saveDay=update（存后快照）；事项 createIdea=create、updateItemContent/changeStatus/restoreItem=update、deleteItem=delete（delete 前 getById 预读）；搜索 search=search（仅非空 query） | 按冻结的事件→动作映射真实捕获，snapshot 存后内容 |
| apps/api/src/hono/auth-middleware.ts | 新增 requirePlatformAdministrator（403「无权访问审计中心」） | platform_admin 专用鉴权 |
| apps/api/src/hono/services.ts | root.platformAudit = new MySqlActivityAuditRepository(pool)；createScopedHonoServices 组装 auditRecorder | 组装仓储与记录器 |
| apps/api/src/hono/routes/audit.ts | GET /admin/audit/events（OpenAPI）+ GET /admin/audit/export（CSV，BOM + text/csv; charset=utf-8 + attachment） | 后端 API 与导出 |
| apps/api/src/hono/app.ts | buildProtectedApiV1Routes 增加 .use('/admin/audit/*', requirePlatformAdministrator())；业务路由挂 .route('/admin/audit', createAuditRoutes(root)) | 鉴权中间件挂在仅被 .route() 的 buildProtectedApiV1Routes 上，避免破坏 .openapi/.doc 链式类型 |
| apps/client/src/pages/index/api-client.ts | ActivityAuditQuery、parseActivityAuditEvent/Page、listActivityAuditEvents、buildActivityAuditExportUrl | 前端 API 客户端（严格结构校验） |
| apps/client/src/pages/index/audit-center.tsx + audit-center.scss + index.tsx | AuditCenter 页面（共享筛选栏、6 列表格、20 条/页、导出、加载/空态/错误态）+ 奶油线稿样式 + index.tsx 接线（'audit' 纳入 ContentModule/MyTab/moduleLabels、'我' 页仅平台管理员 tab 与渲染门） | H5 页面与入口 |
| tests/ | activity-audit-application / mysql-activity-audit.integration / audit-authorization.integration；hono-route-table（+2 路由 + admin/audit 中间件前缀）；api-startup-diagnostics 与 mysql-common-audit-fields（Schema 25） | 自动化验证 |
| README.md / docs/product/当前运行事实.md / docs/daily-contributions/2026-08-25.md | Schema 24→25、能力条目、状态锚点与每日贡献 | 文档同步 |

## 实施注意事项

- 写入模型：审计在业务写入成功之后 best-effort 追加；safeAuditRecord 永远吞错告警，不因审计失败回滚或阻断用户写入。
- 访问边界：仅 platform_admin（requirePlatformAdministrator）；ordinary_admin 与 member 一律 403/不可见。
- 冻结映射：risk_level 预留为 normal，一期不做风险等级筛选；不新增 audit_admin_log、不加用户字段、不做 per-user 页。
- 迁移纪律：025、027 已在/待执行于本地日常库 knowledge_base（025 已执行；027 为二期枚举扩展，执行前需按当前运行事实做逻辑备份）；UAT 等其余库仍未迁移，未迁移不得视为可用。
- 已知限制：桌面端 Tauri 的 window.open 不会携带 Bearer/credentials，CSV 导出在桌面端可能 401；一期以 H5 同源导出为目标，桌面端导出待 HTTPS/认证通道评审后单独处理。

## 当前进度

- 数据层/Application/API/H5/测试/文档全部完成；typecheck 通过，build:h5 通过，git diff --check 通过；审计相关单测/路由/启动诊断断言通过，MySQL 集成测试在缺少 MYSQL_* 环境时按 runIf 跳过。
- 真实库 Migration 025 已执行：本地日常 knowledge_base /health 实测 ready / schemaVersion=25，迁移前已做逻辑备份；API 已重启待人工验收。
- H5 界面修复：审计中心搜索框改用类选择器（修复 Taro 将 input 元素选择器编译为 taro-input-core 导致原生 <input> 无样式的问题），筛选/清除/导出按钮补审计中心内深底白字/统一边框圆角（修复按钮字体颜色与视觉效果），已重新 build:h5 并在本地渲染实测通过。
- 列表结构修复：三餐保存产生的 meal/update 事件 entity_id 为 NULL 时后端省略 entityId 键，前端曾用 hasExactKeys 强制 9 个键（含 entityId）导致整页报「审计事件响应结构无效」；改为 hasKeysWithOptional 接受 entityId 可选并新增 audit-center-api-client.test.ts 覆盖。
- 二期枚举扩展（2026-08-26）：应用层 13 类新捕获点全部接入（探索轨道/事项分配移除/复盘/方法/回收站 purge/状态小结/饮食推荐/首页 AI 卡片/AI 偏好/AI 会话/AI 配置/手记绑会话），契约枚举 5→14 模块、4→11 动作，Migration 027 扩 CHECK 约束，schema 门槛 26→27；前端过滤选项、CSV 中文标签、api-client 白名单同步；application 测试 15 个全绿、api-client 解析测试 6 个全绿、typecheck/build:h5 通过。**027 真实库已执行（2026-08-26）：** 日常 knowledge_base 经 pnpm db:migrate 应用，迁移前逻辑备份 knowledge_base-before-027-2026-08-26-13-34-43.sql（项目外 维护相关/运行库备份/），/health 实测 schemaVersion=27。
- 未完成：真实运行验收需平台管理员账号人工执行（自动化无法登录）；未 commit/push（需用户确认）。

