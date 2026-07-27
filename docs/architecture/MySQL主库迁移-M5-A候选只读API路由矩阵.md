# MySQL 主库迁移 M5-A 候选只读 API 路由矩阵

> 状态：M5-A 实施记录。仅候选 API 运行组合；IndexedDB 仍是唯一运行主库。

| Method / Path | 请求与上限 | 成功响应 | Application 调用 | 业务失败 | MySQL 失败 | 写请求 |
|---|---|---|---|---|---|---|
| `GET /health` | 无 body | `200` 健康 DTO | M1 `getMySqlHealth` | 不适用 | `503 MYSQL_SCHEMA_NOT_READY` / `MYSQL_UNAVAILABLE` | 否 |
| `GET /api/v1/search?query=` | 无 body | `200 SearchResult[]` | `SearchApplicationService.search` | 不适用 | `503 MYSQL_UNAVAILABLE` | 否 |
| `GET /api/v1/dashboard?window=7d\|30d\|all` | 无 body | `200 DashboardReport` | `DashboardApplicationService.getReport` | `400 VALIDATION_FAILED` | `503 MYSQL_UNAVAILABLE` | 否 |
| `GET /api/v1/methods` | 无 body | `200 Method[]` | `ReviewApplicationService.listMethods` | 不适用 | `503 MYSQL_UNAVAILABLE` | 否 |
| `GET /api/v1/reviews/:id` | 无 body | `200 Review` | `ReviewApplicationService.getReview` | `404 NOT_FOUND` | `503 MYSQL_UNAVAILABLE` | 否 |

所有响应均为 JSON，包含 `Cache-Control: no-store` 与服务端生成的 `X-Request-Id`。失败 DTO 固定为 `{ error: { code, message, requestId } }`；不暴露 SQL、连接信息、凭据、堆栈或驱动原始错误。

M5-A 不接受业务写请求。非 `GET` API 方法返回 `405 METHOD_NOT_ALLOWED`，因此没有未知提交结果策略；`requestId` 仅用于日志与错误关联，不是幂等键或重试授权。

CORS 仅精确允许 `http://127.0.0.1:10086`，允许 `GET, OPTIONS` 和 `content-type, x-request-id`；不使用 wildcard 或 credentials。普通 JSON 请求声明长度超过 `64 KiB` 返回 `413 REQUEST_TOO_LARGE`；M5-A 未暴露备份恢复路由。
