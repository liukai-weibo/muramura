# 在线账户与单用户数据隔离 V0：切片 1 认证 API 产品编码授权

日期：2026-07-29  
状态：产品验收通过并归档；切片 2 可开始，切片 3–5 不得开始

## 范围

- 实现注册、登录、退出与当前会话查询的最小 API、Contracts、Application 与存储编排。
- 以服务端解析的 Cookie 会话建立当前用户上下文；HTTP 下 Cookie 仅声明 HttpOnly、SameSite=Lax、Path、过期时间，不得宣称 Secure 传输已满足。

## 允许修改

- `packages/contracts/src/index.ts`、`packages/domain/src/index.ts`、`packages/application/src/index.ts`。
- `packages/storage-mysql/src/*.ts`、`apps/api/src/index.ts`、`apps/api/src/main.ts`。
- 仅直接测试、架构/QA/产品记录及当天贡献记录。

## 硬边界与验收

- 前端不得提交或控制 `userId`；不得改造现有业务资源读写或 H5 登录门。
- 密码哈希、失败登录、会话过期、退出失效、401/403 与 requestId 必须稳定；不得输出密码、哈希或 session token。
- 仅用随机临时库与独立账号测试；不得触碰任一运行库、配置或部署。

## 产品验收与归档（2026-07-29）

验收通过。QA 已验证注册、重复注册、登录成功/失败、Cookie 属性、当前会话、过期、退出失效、401/403/requestId 与秘密不泄露；密码和会话摘要符合冻结安全参数。测试仅使用随机 `kb_accounts_<UUID>` 临时数据库、独立 app/migrator 账号与随机 loopback API 端口，finally 后无临时库或账号残留；`knowledge_base` 与 `knowledge_base_uat` 前后只读摘要一致，定向集成测试、typecheck 与 `git diff --check` 通过。

既有业务 API 尚未接入认证或 owner 过滤，故本结论不构成在线隔离能力完成。切片 2 条件授权现生效；切片 3–5 继续不得开始。
