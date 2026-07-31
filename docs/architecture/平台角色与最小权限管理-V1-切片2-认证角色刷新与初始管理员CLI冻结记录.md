# 平台角色与最小权限管理 V1：切片 2 认证角色刷新与初始管理员 CLI 冻结记录

日期：2026-07-30
状态：架构契约已冻结；尚未授权编码、真实 006 Migration、运行库启动或切片 3–5

## 技术结论

切片 2 有条件可行。本切片只完成认证角色实时读取、登录凭据脱敏边界、初始管理员 Application/Repository 原语、受控 CLI 和 Schema 6 启动保护；不新增管理 HTTP 路由、H5 管理入口、审计页面或跨用户业务能力。

切片 1 已完成产品验收，但本机 `knowledge_base` 与 `knowledge_base_uat` 仍为 15 个 base table、`schemaVersion=5`，且不存在 `user_roles`、`security_audit_events`。当前源码注册链已经依赖 `user_roles`，切片 2 会进一步让全部认证读取依赖该表，因此真实 006 部署前严禁重启、部署或用当前源码替换正在运行的 API。

## Auth Contracts 精确冻结

`PlatformRole` 与 `platformRoles` 沿用切片 1，不增加任何新角色。

`AuthUser` 精确变更为：

```ts
export interface AuthUser {
  id: string
  username: string
  roles: PlatformRole[]
  createdAt: string
}
```

冻结语义：

- `roles` 必填，不得为 `undefined`、`null` 或空数组。
- 普通用户唯一合法序列化为 `['member']`。
- 管理员唯一合法序列化为 `['member', 'platform_admin']`。
- 顺序固定为 `platformRoles` 顺序，先 `member`、后 `platform_admin`；不得依赖 SQL 返回顺序。
- Repository 必须去重并校验固定集合。数据库缺少 member、出现未知角色或只存在 platform_admin 时按数据不变量破坏失败关闭，不得补猜、忽略或授予能力。
- `AuthSession` 仍精确为 `{ user: AuthUser }`，不在 session 顶层复制 roles。
- `CurrentUserScope` 继续精确为 `{ userId: string }`，不得增加 roles、capabilities、isAdmin 或 owner-scope 绕过开关。

为阻止密码哈希随结构化赋值意外进入登录响应，新增：

```ts
export interface CreateAuthUserInput {
  id: string
  username: string
  passwordHash: string
  createdAt: string
}

export interface AuthCredentialRecord {
  user: AuthUser
  passwordHash: string
}
```

`AuthRepository` 精确调整为：

```ts
export interface AuthRepository {
  createUser(input: CreateAuthUserInput): Promise<AuthUser>
  findUserByUsername(username: string): Promise<AuthCredentialRecord | undefined>
  createSession(input: { id: string; userId: string; secretHash: Uint8Array; expiresAt: string; createdAt: string }): Promise<void>
  getSessionBySecretHash(secretHash: Uint8Array, now: string): Promise<AuthUser | undefined>
  revokeSessionBySecretHash(secretHash: Uint8Array, revokedAt: string): Promise<void>
}
```

`passwordHash` 只允许由 `AuthenticationApplicationService.login` 用于 `verifyPassword`。Application 必须把 `record.user` 交给会话创建，禁止把整个 `AuthCredentialRecord`、交叉类型或带额外属性对象放入 `AuthSession`。

## 最新角色与旧会话语义

- `user_sessions` 继续只保存 session id、userId、会话秘密摘要、过期/撤销/创建时间；不新增角色列，不修改 Schema 006。
- Cookie 继续只含原始随机会话秘密，不加入 userId、roles 或 capabilities。
- `MySqlAuthRepository.getSessionBySecretHash` 每次调用必须在验证摘要、`revoked_at IS NULL` 和 `expires_at > now` 的同一次真实数据库读取中取得用户及全部当前角色。
- `findUserByUsername` 在登录时读取该用户当前角色；`createUser` 在 users/member 同事务提交后返回 roles 为 `['member']` 的 AuthUser。
- 不建立进程缓存、内存角色表、Cookie 角色快照或 user_sessions 角色快照。
- `AuthenticationApplicationService.current` 每次调用 Repository，不缓存上次 `AuthSession`。
- 角色 grant/revoke 事务 commit 前，已经完成认证读取的在途请求继续使用该请求开始时取得的角色事实，不追溯改判。
- 角色事务 commit 后，同一旧 Cookie 发起的下一次请求必须读取最新角色，无需退出、重新登录、换 Cookie 或重建 session。
- 管理员被撤销角色后旧会话仍是有效 member 会话；授予管理员后旧会话在下一请求读取 platform_admin。
- 后续管理写入仍须由切片 1 Repository 在事务锁内重新核对 actor 最新角色，不能仅信任请求开始时的 AuthUser.roles。
- 角色变化不自动撤销任何会话；会话撤销仍是独立管理动作。

## API 边界

- 既有注册、登录、`GET /api/v1/auth/session` 响应中的 `AuthUser` 增加冻结 roles；不新增认证路由或错误 DTO。
- `apps/api/src/index.ts` 不在切片 2 修改范围。现有路由自然序列化 Application 返回的 AuthSession。
- 非认证业务请求仍只使用 `session.user.id` 创建 `CurrentUserScope`；必须丢弃角色对业务 Repository 的任何影响。
- 切片 2 不增加 `/api/v1/admin/**`、HTTP 403 映射、角色调整 API、会话撤销 API或 H5 入口。
- 现有 `Cache-Control: no-store`、requestId、401、Cookie 属性和错误映射保持不变。
- 任何注册、登录、当前会话响应均不得出现 `password`、`passwordHash`、`password_hash`、session secret、session hash 或 Cookie 内容。

## 初始管理员 Contracts 与 Repository 原语

新增最小输入：

```ts
export interface InitialPlatformAdminGrantInput {
  targetUserId: string
  auditEventId: string
  operationId: string
  createdAt: string
}

export type InitialPlatformAdminGrantResult = 'granted' | 'already-initialized'

export interface InitialPlatformAdminRepository {
  initializePlatformAdmin(input: InitialPlatformAdminGrantInput): Promise<InitialPlatformAdminGrantResult>
}
```

`MySqlPlatformAdministrationRepository` 实现该接口。允许新增独立错误 code：

- `target-not-member`
- `platform-admin-already-initialized`

既有 `last-platform-admin` 不得恢复。

事务规则固定为：

1. 开启单一 MySQL DML transaction。
2. 使用切片 1 相同的 `user_roles_role_user_idx` 范围锁读取全部 platform_admin，并持锁至 commit/rollback。
3. 锁定显式 target users 行；不存在返回 `user-not-found`。
4. 锁定 target roles；缺少 member 返回 `target-not-member`，零角色、零审计写入。
5. 管理员集合为空时，锁定 operationId，插入 target 的 platform_admin：`granted_by_user_id=NULL`，并插入 `platform_admin_granted` 审计：`actor_user_id=NULL`；两者同事务提交。
6. 管理员集合已经只包含 target 时，返回 `already-initialized`，零写入、零新增审计。这是同一 target 的显式幂等恢复事实。
7. 管理员集合包含任何非 target 用户时，返回 `platform-admin-already-initialized`，不得由 CLI 增加第二名管理员；后续扩张只能通过尚未实现的管理 API。
8. 两个 CLI 并发初始化不同 target 时只允许一个成功；失败方获得锁后返回 `platform-admin-already-initialized`。并发初始化相同 target 时一个成功，另一个返回 `already-initialized`。
9. operationId 冲突、审计失败、`beforeCommit` 失败整体回滚；`afterCommit` 失败代表 unknown-outcome，禁止自动重试、补写或反向写入。

不新增 action code；初始管理员继续使用切片 1 已冻结的 `platform_admin_granted`，以 nullable actor/grantedBy 表示受控 bootstrap。

## Application 边界

新增 `InitialPlatformAdminApplicationService`：

- 输入只能是 CLI 已解析的明确 userId。
- trim 后必须非空且长度不超过 128；无默认用户、无 username 查询、无“第一个注册用户”推断。
- 由 Application 使用既有 `createId()` 生成 auditEventId、operationId，并由注入时钟产生一个 UTC ISO `createdAt`。
- 同一调用中的角色 createdAt 与审计 createdAt 必须一致。
- Application 不接收或处理 MySQL 密码、expected database、apply；这些属于 CLI/基础设施安全门。
- 不自动重试 Repository 写入。
- 返回 target userId、`granted`/`already-initialized`；成功新增时可返回脱敏 operationId 供测试和审计确认，不返回任何秘密。

`AuthenticationApplicationService` 只做两项调整：

- 适配结构化 `AuthCredentialRecord`，验证后只把 `record.user` 传给 `startSession`。
- 保持 register/login/current/logout 与 7 天会话语义不变，不增加授权判断或角色缓存。

## CLI 精确冻结

唯一新增文件：`apps/api/src/grant-initial-platform-admin.ts`。

唯一命令入口：

`corepack pnpm --filter @knowledge-base/api grant-initial-platform-admin -- --user-id=<id> --expected-database=<database> --apply`

参数规则：

- 三个参数全部必填且各出现一次；顺序可交换。
- `--user-id`、`--expected-database` 只接受 `--name=value`，不接受位置参数、空值或隐式默认。
- `--apply` 是无值开关；缺失、重复或带值均拒绝。
- 未知参数、重复参数、额外位置参数全部拒绝。
- 参数校验必须在读取环境、创建连接池前完成；失败只输出固定 usage，退出码非 0，零数据库连接/写入。
- userId trim 后非空且最长 128；expected database trim 后非空且最长 64，不改写大小写。

运行安全门：

- 只使用 `readMySqlConfig(process.env, 'app')` 的现有私有 app 凭据；不接受密码参数、root 或 migrator 凭据。
- 在任何写入前执行真实 `SELECT DATABASE()` 并与 `--expected-database` 完全一致。
- 在任何写入前确认当前 migration 最大版本至少为 6，且 Schema 006 所需两表可读取；Schema 5、缺表、错误数据库或 MySQL 不可用全部拒绝。
- CLI 不运行 Migration、不创建表、不回填 member、不修改 grants、不启动 API/H5。
- 不自动选择首个用户，不按 username 查询，不自动从 0 个管理员以外的状态扩张管理员。

输出和秘密保护：

- stdout 只允许单行 JSON，字段限于 `status`、`database`、`userId`，以及新增成功时可选的 `operationId`。
- stderr 只允许稳定脱敏错误 code/usage；不得输出原始异常、SQL、连接对象、环境变量或堆栈。
- 不输出密码、passwordHash、Cookie、会话秘密/摘要、用户名、其他管理员 userId、业务数据或业务计数。
- 不写日志、临时 SQL、状态文件、备份或配置。
- `granted` 与同 target 的 `already-initialized` 退出码为 0；数据库不匹配、Schema 未就绪、用户不存在、缺 member、已有其他管理员及其他失败退出码非 0。

## unknown-outcome 冻结边界

- Auth 角色读取是只读请求；失败、Abort、503 不得回退到旧缓存角色、member 默认值或空 roles。
- 登录/注册写响应丢失沿用既有认证 unknown-outcome，不自动重发，不伪造会话。
- CLI/Repository commit 前失败整体回滚。
- CLI/Repository commit 后输出中断或 `afterCommit` 失败时，不得自动重跑 initialize。
- 操作者可以明确再次执行同一 target 的 CLI；若首次已提交，必须只读返回 `already-initialized` 且不新增角色/审计；若已有其他管理员，则稳定拒绝。
- 自动化测试必须通过注入固定 ID/时钟捕获 operationId，证明 commit 后异常时角色和唯一审计已经提交，并通过 `findAuditEventByOperationId` 与角色重读确认事实。
- 不增加幂等键表、补偿写、后台重试或新的结果查询 API。

## Schema 6 启动保护

- `MYSQL_REQUIRED_SCHEMA_VERSION` 从 1 冻结提升为 6，因为切片 1/2 源码已经直接依赖 `user_roles`。
- `apps/api/src/main.ts` 必须在创建监听器前使用实际 app 配置建立短连接，确认数据库名正确且 `schemaVersion>=6`；失败时不得调用 `listen`，只输出脱敏启动失败信息并以非 0 退出。
- `/health` 在直接构造测试服务器且 Schema<6 时必须保持脱敏 503，不得返回 ready。
- CLI 使用相同 Schema 6 健康门。
- 切片 2 不修改 `scripts/kb-start.ps1`、UAT 启动器、Docker 或任何配置。它们仍冻结为当前 Schema 5 运行事实，因此不得用来启动切片 2 新源码。
- 真实 006 部署、日常/UAT 启动器升级为 Schema 6、服务重启和 health 验证必须在切片 2 完成 QA 后另行形成运行授权；顺序必须是备份/快照 → 停写 → 006 → Schema 6 核验 → 启动器适配 → API/H5 恢复。该顺序不属于本切片编码授权。
- 当前正在运行的旧 API/H5 不停止、不重启、不替换。

## 精确允许文件范围

切片 2 后续若获编码授权，只允许：

- `packages/contracts/src/index.ts`
- `packages/application/src/index.ts`
- `packages/storage-mysql/src/account-repository.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `packages/storage-mysql/src/index.ts`
- `apps/api/src/main.ts`
- 新增 `apps/api/src/grant-initial-platform-admin.ts`
- `apps/api/package.json`
- `tests/api-auth.integration.test.ts`
- `tests/api-owner-isolation.integration.test.ts`
- `tests/mysql-platform-administration-repository.integration.test.ts`
- `tests/authentication-h5-gate.test.ts`
- `tests/authentication-h5-flow.test.ts`
- 新增 `tests/authentication-role-application.test.ts`
- 新增 `tests/initial-platform-admin-cli.integration.test.ts`
- 新增 `tests/api-schema6-startup.integration.test.ts`
- 必要的切片 2 架构、QA、产品记录和实际验证当日贡献记录

明确禁止修改：

- `migrations/006_add_platform_roles_and_security_audit.sql` 及 001–005
- `apps/api/src/index.ts` 与任何 HTTP 路由/错误 DTO
- `apps/client/src/**`
- 十个业务 Repository、Backup、owner scope、密码算法、Cookie 格式
- 根 `package.json`、Docker、脚本、`.env`、`.env.uat` 或其他运行配置
- `knowledge_base`、`knowledge_base_uat`、现有用户、现有会话或云端

H5 两个测试文件只允许给既有 AuthSession fixture 补 `roles:['member']` 并验证新增字段不破坏现有登录门；不得改页面、交互、样式或增加管理员入口。

## 临时库测试任务书

所有 MySQL 测试必须创建随机独立数据库、随机 app/migrator 账号和随机密码，并首先断言数据库名不等于 `knowledge_base`、`knowledge_base_uat`。仅临时 migrator 执行 001–006；finally 清理数据库和账号。

必须覆盖：

1. 注册返回 `roles:['member']`，users/member 同事务；不自动创建管理员。
2. 登录、注册、当前会话响应均不含 password、passwordHash、password_hash、token、secret 或 session hash；尤其精确断言登录响应没有 Repository 凭据字段。
3. 普通用户旧 Cookie 在直接授予 platform_admin 后，下一次 `GET /auth/session` 返回 member+platform_admin，无需重新登录或换 Cookie。
4. 同一旧 Cookie 在角色撤销后下一请求恢复仅 member；会话仍有效。
5. 角色读取缺 member、未知角色或缺表时失败关闭，不默认 member、不沿用旧 roles。
6. platform_admin 身份仍不能跨 owner scope 访问另一用户业务资源；继续得到既有 404。
7. CLI 缺少 apply、参数重复、额外参数、expected database 不匹配、Schema 5、缺表、用户不存在、缺 member时全部零写入。
8. 首次 CLI 对明确 target 成功；同 target 再执行返回 `already-initialized` 且审计不增加；已有其他管理员时拒绝。
9. 两个不同 target 并发初始化只允许一个成功；相同 target 并发为一个 granted、一个 already-initialized。
10. CLI 初始角色 `granted_by_user_id` 与审计 `actor_user_id` 均为 NULL，action 固定为 `platform_admin_granted`。
11. `beforeCommit` 失败零角色/零审计；`afterCommit` 失败不重试，通过固定 operationId 只读确认唯一角色和唯一审计。
12. Schema 5 API 主入口不监听；Schema 6 才允许监听。错误信息与 CLI 输出均不泄露连接秘密。
13. 既有 session 摘要仍为 BINARY(32)，密码仍为 scrypt 哈希，角色不写入 user_sessions/Cookie/Backup。
14. AuthUser.roles 类型变化只要求 H5 fixture 适配，不出现管理入口或业务行为变化。

运行库保护：

- 测试前后对 `knowledge_base`、`knowledge_base_uat` 做只读深度快照，结果必须分别 `SNAPSHOTS_IDENTICAL`。
- 两库始终保持 15 个 base table、schemaVersion 5、平台两表不存在；不得为了运行新测试给运行库部署 006。
- 最终随机临时数据库和临时账号数量为 0。
- 禁止启动/停止当前 API、H5、Docker 或执行 Backup/claim/业务写入。

工程验收门：

- 切片 2 定向测试通过。
- 完整 MySQL 回归串行通过，不与使用全局 migration lock 的套件并行。
- 既有 H5 认证测试通过。
- `typecheck`、`build:h5`、`git diff --check` 通过。
- 完成工程验证后按协作规则更新实际日期的 daily contribution。
- QA 通过后仍只可转产品验收，不得执行真实 006、重启服务或开始切片 3。

## 风险与保护

- 最大运行风险是 Schema 5 与新源码不兼容：用 API 监听前 Schema 6 门、CLI 写前 Schema 6 门及“禁止重启”三重保护。
- 最大秘密风险是扁平 credential 对象进入 AuthSession：改为 `{user,passwordHash}` 并对 login DTO 做原文脱敏断言。
- 最大授权风险是把 admin 角色传入业务 scope：`CurrentUserScope` 保持仅 userId，API router 文件禁止修改。
- 最大并发风险是两个 bootstrap 同时创建管理员：复用管理员范围锁，确保不同 target 仅一人成功。
- 最大结果未知风险是 commit 后重跑产生重复审计：同 target 以当前角色事实返回 already-initialized，禁止自动重试。

## 当前流转

当前只完成架构冻结，不允许编码、测试数据库创建、Migration、配置修改、服务重启或运行库操作。下一责任岗为产品经理；须逐文件签发切片 2 独立编码授权。
