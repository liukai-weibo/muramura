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
- Scalar `pageTitle`：`Knowledge Base API 文档`；`url: /openapi.json`

## 明确不做

- 不开放 `0.0.0.0`、不扩大 CORS 到非 `http://127.0.0.1:10086`
- 不改业务语义、Migration、运行库
- 不把 `AUTH_INVALID_CREDENTIALS` 放入对外 `businessCode` 白名单
- 本切片不做 H5 改造

## 回归锚

- `tests/hono-route-table.test.ts`：完整挂载路由表
- 定向：`tests/api-auth.integration.test.ts`、`tests/api-owner-isolation.integration.test.ts`、`tests/api-platform-administration.integration.test.ts`
