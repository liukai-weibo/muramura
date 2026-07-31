# 平台角色与最小权限管理 V1：切片 1 Schema / Contracts / Repository 冻结记录

日期：2026-07-30
状态：架构契约已按产品裁决修订；切片 1 QA 仍不通过，等待新的最小修复编码授权，不授权真实 Migration 或切片 2–5

## 技术结论

切片 1 有条件可行。本切片只建立平台角色与安全审计的 Schema、共享契约和 MySQL Repository 基础设施，不接入认证角色刷新、CLI、Application、管理 API 或 H5。`CurrentUserScope` 继续只含 `userId`；管理员身份不得成为跨用户业务数据的读取能力。

## Migration 与 Schema

唯一新增 Migration 为 `migrations/006_add_platform_roles_and_security_audit.sql`。列顺序、类型、约束名和索引列顺序固定如下，实施不得改名、增列或使用 JSON / metadata 扩张：

```sql
CREATE TABLE user_roles (
  user_id VARCHAR(128) NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  granted_by_user_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, role_code),
  KEY user_roles_role_user_idx (role_code, user_id),
  KEY user_roles_granted_by_created_idx (granted_by_user_id, created_at),
  CONSTRAINT user_roles_role_code_check CHECK (role_code IN ('member', 'platform_admin')),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT user_roles_granted_by_user_fk FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE security_audit_events (
  id VARCHAR(128) NOT NULL,
  actor_user_id VARCHAR(128) NULL,
  target_user_id VARCHAR(128) NOT NULL,
  action_code VARCHAR(64) NOT NULL,
  operation_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY security_audit_events_operation_unique (operation_id),
  KEY security_audit_events_target_created_idx (target_user_id, created_at, id),
  KEY security_audit_events_actor_created_idx (actor_user_id, created_at, id),
  CONSTRAINT security_audit_events_action_code_check CHECK (action_code IN ('platform_admin_granted', 'platform_admin_revoked', 'user_sessions_revoked')),
  CONSTRAINT security_audit_events_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT security_audit_events_target_user_fk FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO user_roles (user_id, role_code, granted_by_user_id, created_at)
SELECT id, 'member', NULL, created_at
FROM users;
```

冻结语义：

- 固定角色 code 仅为 `member`、`platform_admin`。
- 固定审计 action code 仅为 `platform_admin_granted`、`platform_admin_revoked`、`user_sessions_revoked`。
- Migration 为执行时已存在的每个用户补一条 `member`，不得创建任何 `platform_admin`。
- 后续新用户由 `MySqlAuthRepository.createUser` 在同一 DML transaction 内插入 `users` 与 `member`；两步任一步失败必须整体回滚。系统固定赋予的 `member` 使用 `granted_by_user_id = NULL`，且没有撤销 member 的 Repository 方法。
- `actor_user_id = NULL` 和 `granted_by_user_id = NULL` 仅预留给后续独立授权的受控初始管理员 CLI；本切片不实现 CLI。普通管理 Repository 写入必须保存真实 actor userId。
- `security_audit_events` 禁止新增 metadata、JSON、用户名快照、密码、密码哈希、Cookie、原始会话秘密、会话摘要、业务内容或业务统计。
- 两张表的外键删除策略全部固定为 `RESTRICT`。Backup V1/V2/V3 不包含这两张表，也不包含 users、sessions 或角色数据。

## Contracts 冻结

`packages/contracts/src/index.ts` 仅增加下列共享定义；切片 1 不得修改 `AuthUser`、`AuthSession` 或 `CurrentUserScope`，不得让前端传入角色决定权限：

```ts
export const platformRoles = ['member', 'platform_admin'] as const
export type PlatformRole = (typeof platformRoles)[number]

export const securityAuditActions = [
  'platform_admin_granted',
  'platform_admin_revoked',
  'user_sessions_revoked',
] as const
export type SecurityAuditAction = (typeof securityAuditActions)[number]

export interface PlatformUserSummary {
  id: string
  username: string
  roles: PlatformRole[]
  createdAt: string
}

export interface PlatformUserPage {
  items: PlatformUserSummary[]
  page: number
  pageSize: 20
  total: number
}

export interface PlatformRoleChangeInput {
  actorUserId: string
  targetUserId: string
  auditEventId: string
  operationId: string
  createdAt: string
}

export interface RevokeAllUserSessionsInput extends PlatformRoleChangeInput {
  revokedAt: string
}

export interface SecurityAuditEvent {
  id: string
  actorUserId?: string
  targetUserId: string
  action: SecurityAuditAction
  operationId: string
  createdAt: string
}

export type PlatformAdministrationRepositoryErrorCode =
  | 'invalid-page'
  | 'actor-not-platform-admin'
  | 'user-not-found'
  | 'self-role-change'
  | 'self-session-revoke'
  | 'operation-conflict'

export interface PlatformAdministrationRepository {
  listUsers(input: { page: number; query?: string }): Promise<PlatformUserPage>
  grantPlatformAdmin(input: PlatformRoleChangeInput): Promise<'granted' | 'already-granted'>
  revokePlatformAdmin(input: PlatformRoleChangeInput): Promise<'revoked' | 'already-revoked'>
  revokeAllSessions(input: RevokeAllUserSessionsInput): Promise<{ revokedSessionCount: number }>
  findAuditEventByOperationId(operationId: string): Promise<SecurityAuditEvent | undefined>
}
```

`packages/storage-mysql/src/platform-administration-repository.ts` 必须导出实现上述接口的 `MySqlPlatformAdministrationRepository`，并导出带只读 `code: PlatformAdministrationRepositoryErrorCode` 的 `PlatformAdministrationRepositoryError`。调用方只能按 `code` 稳定识别错误，不得解析 MySQL 文案。`packages/storage-mysql/src/index.ts` 只负责导出新增 Repository、错误类和必要测试钩子。

## 用户列表读取规则

- `page` 从 1 开始，只接受正整数；否则以 `invalid-page` 拒绝。`pageSize` 永远为 20，不接受调用方覆盖。
- `query` 先执行既有字符串 `trim`；缺省或 trim 后为空等同无搜索。
- 非空 query 仅对 `users.username` 做 literal substring 搜索。实现 SQL `LIKE` 时必须转义反斜线、`%`、`_` 并显式使用同一 escape 规则，不得把用户输入解释为通配符。
- 排序固定为 `users.created_at DESC, users.id ASC`，分页总数与 items 必须使用同一搜索条件。
- 每个用户的 roles 固定按 `member`、`platform_admin` 顺序返回；不得依赖数据库无序聚合。
- 读取只返回 `id`、`username`、`roles`、`createdAt`。不得查询或返回 `password_hash`、Cookie、会话秘密/摘要、业务内容或十集合统计。

## 管理写入、并发与审计

三个管理写方法均须使用一个 MySQL DML transaction，并遵循同一锁顺序，保证任意成功提交后至少保留一名管理员：

1. 以 `SELECT user_id FROM user_roles WHERE role_code = 'platform_admin' ORDER BY user_id FOR UPDATE` 锁定 `user_roles_role_user_idx` 对应的管理员集合/范围，使 grant 与 revoke 串行化；不得先读取数量后无锁写入。
2. 按 userId 升序锁定 actor 与 target 的 `users` 行。任一不存在时返回 `user-not-found`，零业务写入、零审计写入。
3. actor 必须在已锁定的管理员集合中，否则返回 `actor-not-platform-admin`。角色调整 actor 与 target 相同时返回 `self-role-change`；会话撤销 actor 与 target 相同时返回 `self-session-revoke`。这些拒绝均发生在任何写入前。
4. 按 `operation_id` 唯一索引执行锁定读取。已有相同 operationId 时返回 `operation-conflict`，不得把它猜测为成功、失败或幂等重试。
5. grant 在 target 已有 `platform_admin` 且 operationId 未使用时返回 `already-granted`；revoke 在 target 已无该角色时返回 `already-revoked`。二者均零写入、零审计。成功变更才插入对应审计事件。
6. `last-platform-admin` 仅是事务必须维持的内部安全不变量，不是 `PlatformAdministrationRepositoryErrorCode`，Repository 不得公开抛出该 code。仅一名管理员时，唯一可撤销目标就是 actor 自己，按第 3 步稳定返回 `self-role-change`。两名管理员并发互撤时，第一个事务成功后，第二个事务重新获得管理员集合锁；其 actor 已不在最新管理员集合中，按第 3 步稳定返回 `actor-not-platform-admin`。不得调整错误优先级或构造不可自然到达的 `last-platform-admin` 分支。管理员集合锁必须保持到 commit / rollback；删除角色前 actor 必须仍在已锁定的管理员集合中且 target 必须与 actor 不同，从而保证成功提交后至少保留 actor 这一名管理员。
7. revokeAllSessions 对 target 执行 `UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`，包括尚未标记撤销的已过期会话；返回实际 affected rows。target 存在且操作合法时即使 affected rows 为 0，也写入一条 `user_sessions_revoked` 审计事件。
8. 角色变更/会话撤销与对应审计 INSERT 必须同事务提交。审计唯一约束、外键或任何写入失败必须整体回滚，不得留下无审计管理变更。

切片 1 Repository 不承担 HTTP 403/404 映射；切片 3 的 Application/API 必须继续用服务端会话角色授权。管理员绝不得绕过十个业务集合的 owner scope，跨用户业务资源继续统一 404。

## unknown-outcome 冻结边界

`MySqlPlatformAdministrationRepository` 构造函数允许仅测试使用的可选钩子：

```ts
export interface MySqlPlatformAdministrationRepositoryTestHooks {
  beforeCommit?: () => void | Promise<void>
  afterCommit?: () => void | Promise<void>
}
```

- `beforeCommit` 在所有 DML 完成后、真实 commit 前调用；失败必须 rollback，角色、会话和审计均不改变。
- `afterCommit` 只在真实 commit 成功后调用；其失败代表 commit 后结果未知。Repository 必须原样抛出且不得自动重试、补写、反向写入或把结果伪装为成功/失败。
- 结果未知后，调用方只能显式调用 `findAuditEventByOperationId` 确认该 operation 是否已有审计，再真实重读用户角色或会话事实；不得重发原写请求。
- `findAuditEventByOperationId` 是只读精确查询，查无记录返回 `undefined`，只返回冻结的脱敏字段。它不自行判断未提交、回滚或尚在执行。
- 测试必须覆盖 commit 前失败整体回滚、commit 后钩子失败但变更与审计已提交、相同 operationId 稳定冲突、显式读取审计确认且写请求只执行一次。

## 测试与运行库保护

- `tests/mysql-platform-security-schema.integration.test.ts` 逐项断言两表列顺序、类型、可空性、默认值、主键、唯一约束、索引列顺序、CHECK、RESTRICT 外键、既有用户 member 回填和不自动创建管理员。
- `tests/mysql-platform-administration-repository.integration.test.ts` 覆盖 createUser 同事务 member、固定分页/搜索/排序/角色顺序、权限拒绝、自操作拒绝、重复角色操作、最后管理员安全不变量、会话撤销、审计同事务和 unknown-outcome。单管理员自撤必须精确断言 `self-role-change`；双管理员并发互撤必须精确断言一次成功、一次 `actor-not-platform-admin`，并断言最终 `platform_admin` 数量至少为 1。测试不得再期待、构造或公开 `last-platform-admin`。
- 所有测试仅使用随机命名的独立临时数据库与独立临时 app/migrator 账号，`finally` 清理。不得连接、迁移或写入 `knowledge_base`、`knowledge_base_uat`、Docker 或云端。
- 测试前后必须对两个运行库执行只读深度快照并得到 `SNAPSHOTS_IDENTICAL`，同时证明无临时数据库或账号残留。

## 切片边界

切片 1 不接入 `AuthUser.roles`、会话角色刷新、初始管理员 CLI、Application、管理 API、H5、Backup、Docker、云端或运行配置；不得执行真实 006 Migration。切片 2–5 必须等待切片 1 独立 QA 与产品验收后另行书面授权。

## 2026-07-30 最小契约修订边界

- 从 Contracts 的 `PlatformAdministrationRepositoryErrorCode` 中移除 `last-platform-admin`。
- Repository 删除公开抛出 `last-platform-admin` 的分支，不用其他公开错误码包装或替代该不可达分支。
- 保留管理员集合范围锁、按 userId 固定锁序、actor 最新角色检查、角色与审计同事务、operationId 唯一冲突、`beforeCommit` 回滚、`afterCommit` unknown-outcome 和显式审计重读。
- 只修订上述错误联合、Repository 分支和两项直接测试断言；Schema 006、两张表、固定 role/action code、`AuthUser`、认证刷新、CLI、Application、API、H5、Backup 与运行环境均不变。
- 本次文档修订不构成最小修复编码授权；切片 1 当前仍为 QA 不通过。
