# Hono 完整接入与 Scalar OpenAPI 文档冻结

> 状态：已实施  
> 日期：2026-08-02

## 决策

```text
1A：日常入口与 createApiServer 均以 Hono 为唯一 HTTP 实现
2A：路由与 OpenAPI 同源（@hono/zod-openapi）；文档 UI 为 Scalar（@scalar/hono-api-reference）
```

## 运行形态

```text
H5 → /api 代理 → 127.0.0.1:32146
  → OpenAPIHono
  → Cookie kb_session + owner scoped Application
  → MySQL

文档：GET /openapi.json + GET /docs（仅 loopback，不扩大 CORS）
```

`createApiServer` 仅为 `@hono/node-server` 的 `createAdaptorServer` 薄封装，供既有集成测试与 `main.ts` 复用；手写原生 `route()` 分发已移除，避免双实现漂移。

## 认证与管理门

```text
/health、/api/v1/auth/*、/openapi.json、/docs 公开
其余 /api/v1/* 需要有效会话，并注入 createScopedHonoServices(pool, userId)
/api/v1/admin/* 另需 platform_admin；body 413 在鉴权与角色门之后
非 admin 路径仍在进入业务前做 content-length / bodyLimit
```

## OpenAPI 约定

- 根应用为 `OpenAPIHono`；标签分组：Health / Auth / Admin / Items / ExplorationTracks / Methods / Reviews / MethodApplications / Backup / Trash / Search / Dashboard
- 统一错误体 schema；成功与常见 4xx 写入各 `createRoute`
- 成功响应 DTO 集中定义在 `apps/api/src/hono/schemas.ts`，按业务分区组织并以 `@knowledge-base/contracts` 类型约束；路由不得使用 `z.unknown()`、`z.array(z.unknown())` 或 `.loose()` 代替真实响应字段
- 备份恢复输入继续由 Application 完成旧版本兼容、跨集合引用与事务前可信校验；Hono schema 只提供 RPC 输入类型，不提前改变既有拒绝语义
- Scalar `pageTitle`：`Knowledge Base API 文档`；`url: /openapi.json`

## Hono RPC 类型导出

- 包入口：`@knowledge-base/api/rpc` → `export type { AppType }`
- 客户端：`hc<AppType>('http://127.0.0.1:32146', { init: { credentials: 'include' } })`
- `buildHonoApp` 是真实运行时组装，负责认证、管理员授权、body limit、404/405 与异常映射
- `buildRpcContractRoutes` 是纯路由契约，只负责从同一批 route handler 推导客户端端点；它不是第二套 API 实现
- 业务路由清单只有一个组合入口；运行时安全外壳和 RPC 契约共同挂载该路由树，避免维护两份路由表
- 为保留 RPC schema，业务路由以链式 `.openapi` / `.route` 组装；`requireJson` 放在对应 `createRoute.middleware`
- `apps/api/test/hono-rpc.typecheck.ts` 对事项、探索主线、复盘、方法上下文、搜索、Dashboard、备份、回收站、动态参数、平台管理与会话响应做具体端点编译期守卫，不能只检查 `api` 顶级键
- Hono 的全局中间件与 `onError` 响应不会自动进入 RPC 推导；客户端仍须按统一错误契约处理非成功响应
- **不**替代现有 H5 `api-client` + `@knowledge-base/contracts`（本切片仅导出类型）

## 明确不做

- 不开放 `0.0.0.0`、不扩大 CORS 到非 `http://127.0.0.1:10086`
- 不改业务语义、Migration、运行库
- 不把 `AUTH_INVALID_CREDENTIALS` 放入对外 `businessCode` 白名单
- 本切片不做 H5 改造 / 不强制切换到 `hc`

## 回归锚

- `tests/hono-route-table.test.ts`：完整挂载路由表、RPC/运行时端点一致性、认证与管理员授权外壳、OpenAPI 具体 DTO 字段
- `apps/api/test/hono-rpc.typecheck.ts`：由根级 typecheck 执行的具体 RPC 路径、请求参数与响应类型断言
- 定向：`tests/api-auth.integration.test.ts`、`tests/api-owner-isolation.integration.test.ts`、`tests/api-platform-administration.integration.test.ts`
