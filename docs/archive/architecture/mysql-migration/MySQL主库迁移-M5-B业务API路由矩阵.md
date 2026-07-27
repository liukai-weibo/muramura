# MySQL 主库迁移 M5-B 业务 API 路由矩阵

> 状态：M5-B1 实施冻结。仅供候选 loopback API 的真实 MySQL 合成读写验证；IndexedDB 仍是当前唯一运行主库。

所有响应为 JSON，含 `Cache-Control: no-store`、服务端 `X-Request-Id`。失败 DTO 固定为 `{ error: { code, message, requestId } }`。所有 handler 仅调用既有 Application Service。

| Method / Path | 输入 | 成功 DTO | Application 调用 | 业务失败 | 服务失败 | 写入 / 未知结果 |
|---|---|---|---|---|---|---|
| GET `/health` | 无 | 健康 DTO | `getMySqlHealth` | — | `503 MYSQL_SCHEMA_NOT_READY` / `MYSQL_UNAVAILABLE` | 否 |
| GET `/api/v1/search?query=` | query | `SearchResult[]` | `SearchApplicationService.search` | — | `503 MYSQL_UNAVAILABLE` | 否 |
| GET `/api/v1/dashboard?window=` | `7d\|30d\|all` | `DashboardReport` | `DashboardApplicationService.getReport` | `400` | `503` | 否 |
| GET `/api/v1/methods` | 无 | `Method[]` | `ReviewApplicationService.listMethods` | — | `503` | 否 |
| GET `/api/v1/reviews/:id` | id | `Review` | `ReviewApplicationService.getReview` | `404` | `503` | 否 |
| GET `/api/v1/items` | 无 | `Item[]` | `ItemApplicationService.listItems` | — | `503` | 否 |
| GET `/api/v1/items/:id` | id | `Item` | `ItemApplicationService.getItem` | `404` | `503` | 否 |
| GET `/api/v1/items/:id/status-events` | id | `ItemStatusEvent[]` | `ItemApplicationService.listStatusEvents` | `404` | `503` | 否 |
| POST `/api/v1/items` | `CaptureIdeaInput` | `Item` | `ItemApplicationService.createIdea` | `400` | `503` | 是；未知结果仅重新读取 |
| PATCH `/api/v1/items/:id/content` | `{ content }` | `Item` | `ItemApplicationService.updateItemContent` | `400/404` | `503` | 是；未知结果仅重新读取 |
| POST `/api/v1/items/:id/start` | `StartItemExecutionInput` | `Item` | `ItemApplicationService.startExecution` | `404/409` | `503` | 是；未知结果仅重新读取 |
| POST `/api/v1/items/:id/status` | `{ status }` | `Item` | `ItemApplicationService.changeStatus` | `400/404/409` | `503` | 是；未知结果仅重新读取 |
| DELETE `/api/v1/items/:id` | 无 | `204` | `ItemApplicationService.deleteItem` | — | `503` | 是；未知结果仅重新读取 |
| POST `/api/v1/items/:id/restore` | 无 | `Item` | `ItemApplicationService.restoreItem` | `404` | `503` | 是；未知结果仅重新读取 |
| GET `/api/v1/reviews/by-item/:itemId` | id | `Review` | `ReviewApplicationService.getReviewForItem` | `404` | `503` | 否 |
| POST `/api/v1/reviews/complete` | `CompleteReviewInput` | `CompleteReviewResult` | `ReviewApplicationService.completeReview` | `400/404/409` | `503` | 是；未知结果仅重新读取 |
| GET `/api/v1/methods/:id/versions` | id | `MethodVersion[]` | `ReviewApplicationService.listMethodVersions` | — | `503` | 否 |
| GET `/api/v1/methods/:id/evidence` | id | `MethodEvidenceDetail[]` | `ReviewApplicationService.listMethodEvidenceDetails` | — | `503` | 否 |
| GET `/api/v1/methods/by-review/:reviewId` | id | `Method[]` | `ReviewApplicationService.listMethodsFromReview` | — | `503` | 否 |
| DELETE `/api/v1/methods/:id` | 无 | `204` | `MethodLifecycleApplicationService.moveToTrash` | `404/409` | `503` | 是；未知结果仅重新读取 |
| POST `/api/v1/methods/:id/restore` | 无 | `Method` | `MethodLifecycleApplicationService.restore` | `404` | `503` | 是；未知结果仅重新读取 |
| POST `/api/v1/method-applications` | `CreateMethodApplicationInput` | `Item` | `MethodApplicationService.createItem` | `400/404/409` | `503` | 是；未知结果仅重新读取 |
| GET `/api/v1/method-applications/:itemId/context` | id | `MethodApplicationContextResult` | `MethodApplicationService.getContextResultForItem` | — | `503` | 否 |
| GET `/api/v1/method-source-displays?itemIds=` | ≤100 comma-separated IDs | `ItemMethodSourceDisplay[]` | `MethodApplicationService.listSourceDisplaysForItems` | `400` | `503` | 否 |
| GET `/api/v1/trash?filter=` | `all\|item\|method` | `TrashEntry[]` | `TrashApplicationService.listTrashEntries` | `400` | `503` | 否 |
| POST `/api/v1/trash/:type/:id/restore` | `item\|method`, id | `Item\|Method` | existing item/method restore service | `400/404` | `503` | 是；未知结果仅重新读取 |
| GET `/api/v1/backup` | 无 | `BackupDocument` | `BackupApplicationService.createBackup` | — | `503` | 否 |
| POST `/api/v1/backup/restore` | existing `BackupDocument`, ≤16 MiB | `204` | `parseAndValidate` then `restoreBackup` | `400` | `503` | 是；未知结果仅重新读取 |

未列路由、管理/metadata/migration/表浏览/SQL/test 路由均禁止。写请求不接受 `requestId` 作为幂等键，不自动或后台重试，也不提供未知提交结果查询。
