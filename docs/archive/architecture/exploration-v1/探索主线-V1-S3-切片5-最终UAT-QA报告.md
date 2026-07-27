# 探索主线 V1 S3 切片 5：最终 UAT QA 报告

日期：2026-07-26

结论：**QA 通过；`diagnosticId` 最小修复、定向复测与架构技术复审均已完成。等待产品最终验收；不得封板。**

## 已落盘的隔离证据

| 项目 | 实际位置 | 结论 |
| --- | --- | --- |
| 最终 UAT 日常库前快照 | `C:\tmp\kb-s3-uat-complete-20260726\pre-daily` | 已生成 |
| 最终 UAT 日常库后快照 | `C:\tmp\kb-s3-uat-complete-20260726\final-daily` | 比较结果 `DAILY_SNAPSHOTS_IDENTICAL` |
| 最终 UAT 库前快照 | `C:\tmp\kb-s3-uat-complete-20260726\pre-uat` | 已生成 |
| 最终 UAT 库后快照 | `C:\tmp\kb-s3-uat-complete-20260726\final-uat` | 比较结果 `UAT_SNAPSHOTS_IDENTICAL` |
| UAT 恢复前 V3 业务备份 | `C:\tmp\kb-s3-uat-complete-20260726\pre-backup.json` | 已用于恢复临时 UAT 写入 |
| V3 round-trip 备份 | `C:\tmp\kb-s3-uat-20260726\uat-v3-roundtrip.json` | 已存在 |
| 合规清库与 5.1 快照 | `C:\tmp\kb-s3-uat-5_1-20260726` | 已存在 |
| 故障启动器受限临时状态/日志 | `%TEMP%\knowledge-base-uat-fault\state.json`、`launcher.log`、`fault.log`、`fault.err` | 位于项目外；直接检查未匹配密码变量名或故障密码值 |
| 浏览器 503 Network/页面证据 | `C:\tmp\kb-s3-uat-evidence-20260726\mysql-503-browser.json`、`mysql-503-exploration.png` | 已落盘；包含冻结 GET 503、页面错误/非空态断言及 localStorage 为空 |
| 503 前/中/恢复 health 原文 | `C:\tmp\kb-s3-uat-evidence-20260726\health-normal-before.json`、`health-fault.json`、`health-normal-after.json` | 已落盘 |
| health diagnosticId 修复后定向证据 | `C:\tmp\kb-s3-health-diagnosticid-fix-20260726\health-503.json`、`tracks-503.json`、`health-restored.json`、`targeted-tests.txt`、`git-diff-check.txt` | 已落盘；health 503 不含 diagnosticId，冻结 GET 保留 MYSQL_UNAVAILABLE/requestId，恢复后为 UAT ready |
| unknown-outcome Network/页面/重读证据 | `C:\tmp\kb-s3-uat-evidence-20260726\unknown-outcome-verified.json`、`unknown-outcome-verified.png`、`unknown-outcome-verified-reread.json` | 已落盘；一条目标 POST、unknown-outcome 通知与唯一重读入口、草稿保留、GET 重读确认 |
| unknown-outcome 恢复前备份 | `C:\tmp\kb-s3-uat-evidence-20260726\unknown-pre-backup.json` | 已于验证后恢复 |

## 已实际观察的结果

历史说明：早期 `C:\tmp\kb-s3-uat-evidence-20260726\health-fault.json` 含 `diagnosticId`，是修复前的真实历史事实，保留且不得改写。本节中任何“等待 health diagnosticId 最小修复与定向复测”的历史结论，均已被 2026-07-26 的 `C:\tmp\kb-s3-health-diagnosticid-fix-20260726` 定向复测替代。

- 正常 UAT health 原文：`{"status":"ready","database":"knowledge_base_uat","schemaVersion":4}`。
- V3 恢复：清库后 V3 恢复返回 204，恢复后曾确认 `version=3`、`items=1`、`tracks=1` 与精确 Item 主线关联。
- V1/V2：恢复后主线集合为 0，Item 的 `explorationTrackId` 为空。
- 非法 V3 断裂引用：HTTP 400，`error.code=VALIDATION_FAILED`，业务 data 前后一致。
- unknown-outcome：运行时一次性丢弃已完成 POST 响应；Network 观察为一条目标 POST，页面显示“提交结果未确认，未自动重试”，草稿保留；后续 GET 重读确认主线存在。
- MySQL 不可用：启动器故障 API 的 `/health` 返回 503；冻结 GET 返回 `{"error":{"code":"MYSQL_UNAVAILABLE","message":"本地 MySQL 候选环境当前不可用","requestId":"94eb4857-03e8-4b70-b325-b27a3c85643a"}}`；`restore-normal` 后恢复为 ready / knowledge_base_uat / schemaVersion=4。
- 浏览器 503 P1 修复后，初次读取只显示明确错误与“暂时无法载入探索主线”，不渲染主线空态或详情空态。

## 未形成独立归档文件的证据缺口

503 与 unknown-outcome 的浏览器证据已归档。未生成 HAR 或录像，但 JSON、截图、health 原文、备份和快照均已落盘。

## 工作区基线盘点

工作区为大量既有脏改动，QA 未执行 reset、clean、删除、移动、暂存或覆盖。

### 可由本次 S3 授权识别的路径

- `scripts/uat-api-fault.ps1`
- `apps/api/`、`apps/client/src/pages/index/`、`packages/application/`、`packages/contracts/`、`packages/storage-mysql/`
- `tests/api-m5b.integration.test.ts`、`tests/exploration-h5-adapter.test.ts`、`tests/api-client-transport.test.ts` 与 MySQL 探索主线测试
- `docs/product/探索主线-V1-S3-*`、`docs/architecture/探索主线-V1-S3-*`、`docs/daily-contributions/2026-07-26.md`

这些路径中仍混有其他阶段内容，不能仅凭当前 `git status` 判定每个文件都属于本次授权。

### 无法归属或明显超出本次 S3 范围的既有改动

- 根目录与运行/构建文件：`.gitignore`、`README.md`、`docker-compose.yml`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json`、`vitest.config.ts`。
- 旧运行时资产：`packages/domain/`、`packages/storage-indexeddb/`、`packages/storage-sqlite/`、`apps/local-api/`、`docker/`、`migrations/`。
- 大量历史 Sprint 测试、设计、产品、架构、开发文档及未跟踪文件。

完整原始清单以本次盘点时的 `git status --short` 输出为准；本报告不对这些改动的作者、时间或授权归属作推断。

## 转架构复审条件

浏览器 Network/页面状态、恢复后显式 GET 与启动器动作已按本报告“已落盘的隔离证据”列出的项目外路径归档；工作区基线说明已完成，且未触碰无关脏改动。

故障 `/health` 的未冻结 `diagnosticId` 已移除，定向 QA 复测与架构技术复审已完成。上述“待修复、待复测、待架构复审”仅为修复前历史状态，已被当前结论替代。该报告仍不构成产品最终验收或封板。
