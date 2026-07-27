# MySQL 主库迁移 — M5-B1 错误边界补正后稳定审阅结论

> 状态：**架构稳定审阅通过；允许流转产品经理进行 M5-B1 封板裁决。M5-B2 仍须在产品封板后独立书面授权。**
>
> 主库边界不变：IndexedDB 是当前唯一运行主库；MySQL 仅为候选 Repository 与候选 loopback API 路径；SQLite 是实验 / 测试资产。

## 审阅结论

M5-B1 已满足候选 loopback 完整业务 API 的稳定性、Application 边界、错误诚实性和本地安全边界要求。

- 路由矩阵范围内的业务 API 均经既有 Application Service；未发现路由直连 SQL、事务拼装、Repository / pool 暴露或额外管理路由。
- `POST /api/v1/reviews/complete` 唯一调用 `ReviewApplicationService.completeReview()`；M4 已封板的跨对象 MySQL 单事务语义保持。
- Backup restore 在 restore 前执行 `parseAndValidate()`；业务备份 format、v1/v2、九集合原子恢复和 `system_metadata` 隔离未变化。
- Item 删除仍是软删除，Method 删除仍是 moveToTrash；未暴露永久清理入口。
- M5-A 只读 API 和 M5-B1 写 API 的候选 MySQL 集成回归通过，且无 `.env` 时按设计跳过、不连接 MySQL。

## 错误边界补正确认

`apps/api/src/index.ts` 已执行以下受限补正：

```text
已识别 MySQL / pool / connection 驱动错误
→ 503 MYSQL_UNAVAILABLE

MySqlSchemaNotReadyError
→ 503 MYSQL_SCHEMA_NOT_READY

未分类异常
→ 500 INTERNAL_ERROR
```

所有上述失败继续返回 `Cache-Control: no-store`、`X-Request-Id` 及失败 DTO 中的 `requestId`，并保持不泄露 SQL、stack、driver 原文、连接信息或凭据。

`GET /api/v1/method-source-displays?itemIds=` 已在调用 `MethodApplicationService` 前同时执行：

```text
pathname + search ≤ 8 KiB
itemIds ≤ 100
无空 ID
```

任一不满足时稳定返回：

```text
400 VALIDATION_FAILED
itemIds 参数无效
```

## 验证依据

QA 已复验：

```text
M5-A + M5-B1 定向真实 MySQL：2 files / 10 tests passed
M1～M5-B1 串行真实 MySQL：11 files / 102 tests passed
无 .env：M5-B1 1 file / 4 tests 明确跳过，未连接 MySQL
typecheck、全量 test、build:h5、git diff --check：通过
```

补正定向覆盖：

```text
畸形 URL 编码 → 500 INTERNAL_ERROR
错误 MySQL app 凭据 → 503 MYSQL_UNAVAILABLE
超过 8 KiB itemIds URL → 400 VALIDATION_FAILED，未进入 Application
```

`build:h5` 仅保留既有包体积与 Webpack cache 告警，不影响本裁决。

## 流转裁决

1. **允许 M5-B1 流转产品经理封板裁决。**
2. **M5-B2 不自动授权。** 只有产品经理书面封板 M5-B1 后，才可由架构师另行书面授权 M5-B2。
3. 如 M5-B2 获得授权，其范围仅能是：

```text
H5 HTTP Adapter
移除 H5 运行时 Dexie / IndexedDB Repository 组装
API → MySQL 候选单写 UI 验证
读取取消、最新请求胜出、submitting、失败态与 unknown-outcome
无 IndexedDB fallback、双写、同步、回填或数据合并
```

## 持续冻结

在产品 M5-B1 封板和 M5-B2 独立书面授权前，持续禁止：

```text
M5-B2 / M5-C 实施
apps/client/** 修改
H5 API Adapter 与单写 UI 验证
真实 IndexedDB 历史迁移
IndexedDB / MySQL 双写、同步、回填、fallback 或主库切换
远程监听、认证、多用户、浏览器直连 MySQL
Schema / Migration
```
