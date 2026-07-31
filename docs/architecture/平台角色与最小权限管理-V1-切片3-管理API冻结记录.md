# 平台角色与最小权限管理 V1—切片 3 管理 API 冻结记录

日期：2026-07-30
状态：架构冻结完成；尚未获得切片 3 编码授权

## 技术结论

有条件可行。切片 1 已提供平台角色、审计 Schema 与事务 Repository，切片 2 已提供每次会话读取最新角色、初始管理员 CLI 和 Schema 6 启动保护。切片 3 只新增管理 Application、三条管理 HTTP 路由及必要的脱敏读回能力，不新增 Schema、Migration、角色、权限、业务对象或 H5。

实现前提是所有管理请求先由服务端安全 Cookie 恢复 `AuthSession`，权限判断只使用该次认证从数据库读取的最新 `AuthUser.roles`；路径、请求体和前端状态中的任何 userId 或 roles 都不得决定 actor 身份或最终权限。管理写事务必须继续由 Repository 再次确认 actor 仍为 `platform_admin`。

## 当前基线与保留边界

- `AuthUser.roles` 固定为去重后的 `member`、`platform_admin` 顺序，并由 `AuthenticationApplicationService.current()` 在每次请求中从数据库重读。
- `CurrentUserScope` 仍只有 `{ userId }`。平台管理员身份不得加入或扩大该 scope。
- `PlatformAdministrationRepository` 已具备用户分页、授予/撤销管理员、撤销全部会话、operationId 唯一审计、管理员集合锁、固定用户锁序、事务回滚及 before/afterCommit unknown-outcome 原语。
- 当前 `knowledge_base` 与 `knowledge_base_uat` 均为 15 表、`schemaVersion=5`、平台表 0；真实 006 未执行。切片 3 的实现与测试不得改变该事实。
- 当前新源码依赖 Schema 6。真实 006 获得单独运行授权前，不得重启、部署或替换当前 API；Schema 5 下 API 主入口继续必须在监听前失败关闭。

## 冻结 Contracts

保留既有 `PlatformRole`、`PlatformUserSummary`、`PlatformUserPage`、`PlatformAdministrationRepositoryErrorCode`、Repository 写入输入及审计契约。只允许补充以下 HTTP/Application 边界类型：

```ts
export interface AdminSetUserRolesRequest {
  roles: PlatformRole[]
  operationId: string
}

export interface AdminRevokeUserSessionsRequest {
  operationId: string
}

export interface AdminRevokeUserSessionsResponse {
  revokedSessionCount: number
}
```

`PlatformUserSummary` 的序列化字段及顺序冻结为 `id`、`username`、`roles`、`createdAt`；其中 `id` 只供管理操作定位。`PlatformUserPage` 冻结为：

```json
{
  "items": [
    {
      "id": "内部 userId",
      "username": "用户名",
      "roles": ["member", "platform_admin"],
      "createdAt": "ISO 8601 UTC 时间"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

响应不得包含 `password`、`passwordHash`、`password_hash`、Cookie、会话原文或摘要、审计内容、用户业务内容、Backup 内容、业务数量及不存在的邮箱字段。`roles` 必须去重并固定按 `member`、`platform_admin` 排序；缺少 `member`、出现未知角色或角色数据不可读时整次请求失败关闭，不得返回不完整角色事实。

Repository 仅允许新增：

```ts
getUserById(userId: string): Promise<PlatformUserSummary | undefined>
```

该方法只返回上述脱敏用户摘要，用于角色写入明确成功后的真实重读；不得返回认证凭据、会话或业务数据。`listUsers` 的 count、当前页 users 与 roles 必须来自同一次一致性只读快照，避免并发注册或角色变更造成一页内混合事实。

## Application 契约

新增 `PlatformAdministrationApplicationService`，仅暴露：

```ts
listUsers(
  actor: AuthUser,
  input: { page: number; query?: string }
): Promise<PlatformUserPage>

setUserRoles(
  actor: AuthUser,
  input: {
    targetUserId: string
    roles: PlatformRole[]
    operationId: string
  }
): Promise<PlatformUserSummary>

revokeAllUserSessions(
  actor: AuthUser,
  input: {
    targetUserId: string
    operationId: string
  }
): Promise<AdminRevokeUserSessionsResponse>
```

Application 规则冻结如下：

- 三个方法均先检查 `actor.roles` 包含 `platform_admin`；失败时不得调用 Repository。
- actorUserId 只能取 `actor.id`。targetUserId 只能取已校验的路径参数；请求体不得接受 actorUserId、targetUserId、auditEventId、createdAt 或 revokedAt。
- 角色请求只接受精确规范数组 `['member']` 或 `['member', 'platform_admin']`。不接受缺 member、颠倒顺序、重复值、未知角色或额外字段。
- `['member', 'platform_admin']` 调用既有 `grantPlatformAdmin`；`['member']` 调用既有 `revokePlatformAdmin`。目标已是所需状态时沿用 Repository 的零写入结果，不新增审计事件。
- 每次明确写操作的 `operationId` 由客户端生成并必填；必须是规范 UUID 文本。HTTP `requestId` 不得代替或派生 operationId。
- Application 为每次调用生成新的服务端 `auditEventId`，并在同一时刻生成 `createdAt`；会话撤销的 `revokedAt` 与该 `createdAt` 使用同一个时钟值。前端不得提交这些值。
- 角色写入明确成功或明确为既有状态后，必须调用 `getUserById(targetUserId)` 真实重读并返回服务端事实；不得按请求体拼出成功响应。重读失败时整次 HTTP 结果保持失败或未知，不伪造成功。
- 会话撤销返回 Repository 已提交结果 `{ revokedSessionCount }`。不新增会话状态查询接口。
- 不新增自动重试、幂等成功推断、补偿写入或后台任务。

## HTTP 路由与精确结构

只允许新增以下三条路由，不接受别名或额外管理路由：

### GET /api/v1/admin/users?page=&query=

- `page` 可省略，默认 `1`；提供时必须是十进制正安全整数。重复 page、空 page、0、负数、小数、指数、带符号或超出安全整数均为 400。
- `query` 可省略；提供时只允许一个，trim 后长度不超过 80 个 JavaScript 字符单元。空字符串等同未筛选。
- query 按 username 做转义后的字面量子串匹配；`%`、`_` 和转义字符不得被解释为 SQL 通配符。
- 每页固定 20，不接受 `pageSize`。除 `page`、`query` 外的任何 query 参数均为 400。
- 排序固定为 `createdAt DESC, userId ASC`；超过末页返回 `items: []`，保留真实 page、`pageSize:20` 与 total，不返回 404。
- 成功返回 HTTP 200 `PlatformUserPage`。

### PUT /api/v1/admin/users/:id/roles

- `:id` URL 解码后为不透明内部 userId，长度 1–128，不得含首尾空白、控制字符、`/`、`?` 或 `#`；非法编码或非法值返回 400。
- `Content-Type` 必须为 JSON；请求体只允许 `{ "roles": [...], "operationId": "..." }` 两个字段，二者必填，未知字段一律 400。
- roles 只接受 `['member']` 或 `['member','platform_admin']`；operationId 只接受规范 UUID 文本。
- 成功返回 HTTP 200 和真实重读后的 `PlatformUserSummary`。

### POST /api/v1/admin/users/:id/revoke-sessions

- `:id` 规则同上。
- `Content-Type` 必须为 JSON；请求体只允许 `{ "operationId": "..." }`，字段必填，未知字段一律 400。
- 成功返回 HTTP 200 `{ "revokedSessionCount": number }`。
- 本路由只撤销目标用户当时尚未撤销的全部会话；不得删除会话记录、修改角色或业务数据。

三条路由继续使用既有 64 KiB 普通请求体限制、`Cache-Control: no-store`、`X-Request-Id` 和冻结错误 DTO：

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "无权执行平台管理操作",
    "requestId": "服务端请求 ID"
  }
}
```

不得新增错误字段、诊断字段或管理专用错误 DTO。

## 认证授权与不泄露边界

请求处理顺序冻结为：

1. 既有 Cookie 解析和 `auth.current()`；无有效会话返回 401 `UNAUTHORIZED`。
2. 对任意 `/api/v1/admin/**`，立即检查本次数据库读取的 `session.user.roles`。不含 `platform_admin` 时统一返回 403 `FORBIDDEN + requestId`。
3. 只有管理员门通过后，才匹配具体管理路由、方法、query、目标 ID 和请求体。
4. 管理写调用 Repository 时，在事务锁内再次检查 actor 仍为管理员。

因此 member 对目标存在/不存在、合法/非法 ID、合法/非法请求体和未知 `/api/v1/admin/**` 均只能观察到同一 403，且零写入。管理员通过授权门后，目标用户不存在才返回 404。管理员角色在一次列表请求完成认证读取后才被并发撤销时，该在途读可按其授权检查点完成；撤销提交后的下一请求必须因重新读取最新角色返回 403。管理写无论何时都以事务内的再次检查为准。

管理路由必须使用独立的 Platform Administration Application/Repository，不得用路径目标 id 创建 `CurrentUserScope`。既有十个业务集合及 Backup 的 scope 继续只能是当前 Cookie 用户的 `session.user.id`；`platform_admin` 请求其他用户业务资源继续返回不泄露存在性的既有 404。

## Repository 错误到 HTTP 的冻结映射

| Repository / Application 事实 | HTTP | 既有 code | 脱敏语义 |
| --- | ---: | --- | --- |
| 未认证 | 401 | `UNAUTHORIZED` | authentication required |
| Application 管理员门失败、`actor-not-platform-admin` | 403 | `FORBIDDEN` | 无权执行平台管理操作 |
| `self-role-change` | 403 | `FORBIDDEN` | 不允许调整自己的平台角色 |
| `self-session-revoke` | 403 | `FORBIDDEN` | 不允许通过管理接口撤销自己的会话 |
| `user-not-found` | 404 | `NOT_FOUND` | 目标用户不存在 |
| `invalid-page`、请求结构或参数非法 | 400 | `VALIDATION_FAILED` | 对应的脱敏校验说明 |
| `operation-conflict` | 409 | `CONFLICT` | operationId 已被使用，不能推断本次成功 |
| `target-not-member` | 409 | `CONFLICT` | 目标账号角色状态不可操作；不得自动修复 |
| `platform-admin-already-initialized` | 500 | `INTERNAL_ERROR` | 仅属 CLI，管理 API 出现即按未分类内部错误失败关闭 |
| MySQL 不可用 | 503 | `MYSQL_UNAVAILABLE` | 复用既有脱敏文案 |
| Schema 未就绪 | 503 | `MYSQL_SCHEMA_NOT_READY` | 复用既有脱敏文案 |

`last-platform-admin` 不得重新加入错误联合、HTTP 映射或文案。最后一个管理员由既有自操作禁止和事务锁安全不变量保护；两名管理员并发互撤仍必须为一次成功、一次 `actor-not-platform-admin`。

## operationId、审计与 unknown-outcome

- operationId 由调用端为一次用户明确点击生成，跨三类管理写操作全局唯一；服务端写入 `security_audit_events.operation_id`，不得使用 requestId、时间戳或 userId 代替。
- 已提交过的同一 operationId 在 actor 仍有权限、目标有效且非自操作时再次提交，稳定返回 409 `CONFLICT`；既有事务错误优先级仍为 actor 权限、自操作、operationId 冲突，不得为制造 409 改写自然可达行为。客户端在任何情况下都不得把 409 推断为前次已成功。
- 角色改变与对应审计、会话撤销与对应审计必须继续处于既有单一事务。beforeCommit 失败整体回滚；afterCommit 断连、Abort、503 或响应丢失属于 unknown-outcome。
- HTTP 明确成功后，角色操作以响应中的服务端真实重读结果更新；管理 H5 后续仍须显式重读列表。
- 角色操作结果未知时保留旧列表，不自动重试，只允许用户显式 GET 列表确认当前角色事实。
- 会话撤销结果未知时保留旧列表和未知状态，不自动重试。因本切片不新增会话状态读取接口，GET 用户列表不能证明会话撤销是否提交；用户再次明确撤销时必须生成新的 operationId。
- `findAuditEventByOperationId` 不接入 HTTP，不向 H5 暴露；仅保留为内部 Repository 测试与受控故障确认能力。

## 实施切片与精确允许文件

切片 3 应作为一个独立后端切片实施，顺序固定为：Contracts DTO → Application 编排与校验 → Repository 脱敏单用户重读/一致性列表 → API 三路由与错误映射 → 随机临时库测试。不得并行混入 H5。

产品后续如签发切片 3 编码授权，源码与测试仅允许：

- `packages/contracts/src/index.ts`
- `packages/application/src/index.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `apps/api/src/index.ts`
- `tests/platform-administration-application.test.ts`（新增）
- `tests/api-platform-administration.integration.test.ts`（新增）
- `tests/mysql-platform-administration-repository.integration.test.ts`（仅补 `getUserById`、一致性列表和失败关闭直接覆盖）
- `tests/api-owner-isolation.integration.test.ts`（仅补管理员经 HTTP 后仍不能跨 owner 的直接回归）
- 与本切片直接对应的架构、QA、产品验收记录；完成工程验证后按章程追加当天唯一贡献记录

未经产品再次明确，不允许修改：

- `migrations/006_add_platform_roles_and_security_audit.sql` 或任一 Migration
- `packages/storage-mysql/src/account-repository.ts`、认证角色读取、初始管理员 CLI 或 API main 启动保护
- 十个业务集合 Repository、Backup Repository、owner scope、Contracts 业务 DTO 或既有业务 API
- `apps/client/src/**`、H5 API client、页面、样式或管理入口
- 根 package、Docker、脚本、`.env`、`.env.uat`、公开示例配置、端口、账号、grants 或部署文件
- `knowledge_base`、`knowledge_base_uat`、现有用户、会话、业务数据、MySQL 容器、云端或任何运行库状态

## 随机独立临时库测试任务书

所有 MySQL/API 测试必须使用随机名称的独立临时 database、临时 app/migrator 账号和随机秘密；只在该临时库执行 001–006，串行运行并在 finally 清理。禁止对 `.env` 或 `.env.uat` 指定的 database 执行 DDL、DML、Migration、注册、登录、角色或会话操作。

最低直接测试：

1. 无 Cookie 调用三路由均为 401；member 调用任意 `/api/v1/admin/**` 均为相同 403，覆盖目标存在/不存在、合法/非法 body 与未知管理路径，并断言用户、角色、会话、审计零写入。
2. 管理员列表覆盖默认页、空末页、固定 20、total、username 字面量子串搜索、稳定排序、特殊 LIKE 字符、重复/未知 query 参数及非法 page。
3. 列表与单用户摘要只含允许字段，roles 固定排序；缺 member 或异常角色事实失败关闭，不泄露密码、会话、审计、业务内容或业务数量。
4. 角色授予、撤销及相同状态零写入；成功响应来自真实重读；管理员不能调整自己；目标不存在为 404。
5. 会话撤销只影响目标全部有效旧 Cookie，目标后续请求为 401；actor 与其他用户会话不受影响；管理员不能通过管理页撤销自己。
6. actor 在 HTTP 认证读取后、Repository 写事务加锁前被降级，写请求稳定 403 且角色、会话、审计零副作用。
7. 两名管理员并发互撤只允许一次成功、另一次 `actor-not-platform-admin` 映射 403；最终至少一名管理员且只有一条成功审计。
8. operationId 重复为 409，审计 operationId 唯一；不把冲突映射为成功。beforeCommit 故障整体回滚；afterCommit 响应丢失不自动重试，角色仅以显式 GET 重读确认当前事实。
9. MySQL 不可用为既有 503 DTO + requestId；恢复后只由显式 GET 重读。所有成功与错误响应均为 `Cache-Control: no-store` 并含 requestId。
10. platform_admin 对其他用户可按资源 ID 寻址的十个业务集合读写、删除和恢复继续返回既有不泄露 404；列表、回收站与 Backup 仍只能看到或处理当前会话 owner scope，Backup 不新增目标 userId，包含其他 owner 数据 ID 的导入继续沿用既有 ownership-conflict 拒绝语义。不得因管理 API 扩权。
11. Schema 5 下 API 主入口继续不创建服务器或监听；切片 3 API 测试仅在具备完整 Schema 6 的随机临时库启动。
12. 测试前后对 `knowledge_base`、`knowledge_base_uat` 做只读深度快照，结果必须分别 `SNAPSHOTS_IDENTICAL`；两库仍为 15 表、Schema 5、平台表 0；额外临时数据库和账号最终为 0，秘密不得进入 stdout、stderr、Git、构建产物或日志。

建议授权后的验证门为切片 3 定向 Application/Repository/API 测试、完整 MySQL 回归、`typecheck`、`git diff --check`。本切片不修改 H5，不以 `build:h5` 作为功能完成证据；若全量工程门要求执行构建，只记录既有构建事实，不扩大允许文件。

## 验收与后续禁止

切片 3 只有在独立 QA 证明三路由、最新角色授权、双层写保护、错误映射、事务审计、unknown-outcome、owner 不扩权、Schema 5 启动保护及运行库零污染后，才能转产品经理验收。

本冻结记录不授权编码、测试环境创建、真实 006、运行库操作、API 重启/部署、H5 管理入口或切片 4–5。切片 3 产品最终验收前，不得开始切片 4。
