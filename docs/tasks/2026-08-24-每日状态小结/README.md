# 每日状态小结 实施记录（2026-08-24）

## 要解决的问题
首页情绪/三餐卡并排后，用户缺少一眼回看「今天状态与要点」的入口；手记、事项、复盘、方法都在数据层，但首页没有基于这些记录自动汇总结论的能力。本次新增「今日状态小结」：首页第三卡预览当日小结，点击进入详情弹窗（日期切换），并在跨天或页面开着跨午夜时由 AI 静默生成当天小结。

## 最终形态
- 首页 checkin-row 三卡并排（情绪 / 三餐 / 状态小结），小屏单列；小结卡显示当日内容预览或空态引导。
- 弹窗：日期前后切换（不晚于今天）、空态、内容 pre-wrap 展示、手动「生成今日状态小结」按钮、ESC/蒙层关闭。
- 当天无小结且 AI 已配置 → 进入首页或跨午夜自动生成一次并落库；已有小结不重复调用。

## 改动位置与原因
| 文件/层 | 改动 | 原因 |
| --- | --- | --- |
| 数据层 | Migration 023（daily_summaries 表）、MYSQL_REQUIRED_SCHEMA_VERSION 22→23、MySqlDailySummaryRepository（upsert/范围/备份替换） | 每用户每日一条小结，TEXT 不带 DEFAULT（021 教训）；upsert 保证幂等 |
| 契约 | contracts/src/daily-summary.ts（DailySummary/Input/Repository/BackupStore）、errors 增 DAILY_SUMMARY_INVALID | 分层边界与业务错误码 |
| 应用层 | DailySummaryApplicationService（日期/长度/未来校验） | 与 meals/mood 同构校验，禁止前端拼表 |
| API | routes/daily-summaries.ts（GET 范围/GET 单日/PUT upsert）；服务组装 | 读写入口，无 DELETE |
| Backup | BackupDataV8 = V7 + dailySummaries；parse/restore 兼容 ≤7（视为空） | JSON 备份不破坏既有版本 |
| AI 通道 | 新增 GET /experimental/ai-config-status 与 POST /experimental/ai-chat/stream-ephemeral（不落 AI 会话历史） | 普通用户判断 AI 是否配置；流式生成不污染用户 AI 对话历史（计划非目标）；AI 层 / Application 层零改动 |
| 前端 | api-client 3 方法 + getAiConfigStatus + streamEphemeral；features/daily-summary/（auto 模块、detail modal、scss）；首页第三卡；index.tsx 状态/自动生成/午夜定时/弹窗接线 | 卡片/弹窗/自动生成三件套，cream SCSS token |
| 测试 | daily-summary-application / mysql-daily-summaries.integration / backup-v8 / hono-route-table 更新 | 校验、集成、备份、路由四类覆盖 |

## 实施注意事项
- 编辑器触发 `*.tmpdir` 会让 Taro H5 watch 的 FSWatcher EBUSY 崩溃：编辑后清理 tmpdir 再重启 watch（本项目已知问题，非本次引入）。
- H5 访问 dev server 用 `/index.html`（根路径 404 是 dev server 行为）；Playwright 以该 URL 验收。
- `ai_chat/stream` 现有端点强制创建默认会话并 append 历史；本次刻意新增 `stream-ephemeral` 不落历史，已在真实场景实测。
- 自动生成一天最多一次，`generateStartedRef` + 当天日期做幂等；手动生成不受限（计划批准）。真实库 admin 用户 2026-08-24 已有自动生成记录（真实数据，保留）。

## 迭代记录
- 2026-08-24 体验收敛：弹窗暂时移除日期前后切换，固定只看今天（initialDate 接口保留兼容，SCSS 导航样式保留待恢复）。

## 当前进度
数据层/Backup/AI 通道/前端/测试/QA 全部完成：typecheck、定向测试（41+29 通过）、build:h5、Playwright 全链路（含真实 AI 自动生成）通过；文档已更新；待提交（分支 fast-ui，提交前与用户确认 push）。
