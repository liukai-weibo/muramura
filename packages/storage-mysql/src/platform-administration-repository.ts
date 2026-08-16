import type {
  AdminResetPasswordInput,
  AdminResetPasswordResponse,
  AdminUpdateUsernameInput,
  PlatformAdministrationRepository,
  PlatformRole,
  PlatformRoleChangeInput,
  PlatformUserPage,
  PlatformUserSummary,
  RevokeAllUserSessionsInput,
  SecurityAuditAction,
  SecurityAuditEvent,
  InitialPlatformAdminGrantInput,
  InitialPlatformAdminGrantResult,
  InitialPlatformAdminRepository,
} from '@knowledge-base/contracts'
import { fail } from '@knowledge-base/domain'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

type UserRow = RowDataPacket & { id: string; username: string; created_at: Date | string; deleted_at: Date | string | null; is_initial_platform_admin: number }
type RoleRow = RowDataPacket & { user_id: string; role_code: PlatformRole }
type AuditRow = RowDataPacket & { id: string; actor_user_id: string | null; target_user_id: string; action_code: SecurityAuditAction; operation_id: string; created_at: Date | string }
type TxResult<T> = { value: T; changed: boolean }
type Context = { actorIsPlatformAdmin: boolean; actorIsOrdinaryAdmin: boolean; targetIsMember: boolean; targetIsOrdinaryAdmin: boolean; targetIsInitialPlatformAdmin: boolean; targetDeletedAt: Date | string | null }

export interface MySqlPlatformAdministrationRepositoryTestHooks { beforeCommit?: () => void | Promise<void>; afterCommit?: () => void | Promise<void> }

export class MySqlPlatformAdministrationRepository implements PlatformAdministrationRepository, InitialPlatformAdminRepository {
  constructor(private readonly pool: Pool, private readonly hooks: MySqlPlatformAdministrationRepositoryTestHooks = {}) {}

  async listUsers(input: { page: number; query?: string; status?: 'active' | 'deleted'; actorUserId?: string }): Promise<PlatformUserPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) fail('PLATFORM_ADMIN_INVALID_PAGE', '页码无效')
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const actor = await this.readActorCapabilities(connection, input.actorUserId ?? await this.defaultActorId(connection))
      const query = input.query?.trim() ?? ''
      const conditions = [
        ...(query ? ["username LIKE ? ESCAPE '='"] : []),
        ...(input.status === 'deleted' ? ['deleted_at IS NOT NULL'] : ['deleted_at IS NULL']),
        ...(actor.platform ? [] : ["EXISTS (SELECT 1 FROM user_roles rm WHERE rm.user_id=users.id AND rm.role_code='member')", "NOT EXISTS (SELECT 1 FROM user_roles ra WHERE ra.user_id=users.id AND ra.role_code IN ('ordinary_admin','platform_admin'))"]),
      ]
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
      const parameters = query ? [`%${escapeLikeLiteral(query)}%`] : []
      const [countRows] = await connection.query<Array<RowDataPacket & { total: number | string }>>(`SELECT COUNT(*) AS total FROM users${where}`, parameters)
      const [users] = await connection.query<UserRow[]>(`SELECT id,username,created_at,deleted_at,is_initial_platform_admin FROM users${where} ORDER BY created_at DESC,id ASC LIMIT 20 OFFSET ?`, [...parameters, (input.page - 1) * 20])
      const items = await this.readSummaries(connection, users)
      await connection.commit()
      return { items, page: input.page, pageSize: 20, total: Number(countRows[0]?.total ?? 0) }
    } catch (error) { try { await connection.rollback() } catch { /* preserve read error */ } throw error } finally { connection.release() }
  }

  async getUserById(userId: string, actorUserId?: string): Promise<PlatformUserSummary | undefined> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const actor = await this.readActorCapabilities(connection, actorUserId ?? await this.defaultActorId(connection))
      const [users] = await connection.query<UserRow[]>('SELECT id,username,created_at,deleted_at,is_initial_platform_admin FROM users WHERE id=?', [userId])
      if (users[0] && !actor.platform && !this.canOrdinaryAdminSee(await this.readRoles(connection, userId))) return undefined
      const items = await this.readSummaries(connection, users)
      await connection.commit()
      return items[0]
    } catch (error) { try { await connection.rollback() } catch { /* preserve read error */ } throw error } finally { connection.release() }
  }

  grantOrdinaryAdmin(input: PlatformRoleChangeInput): Promise<'granted' | 'already-granted'> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ROLE_CHANGE')
      if (!context.actorIsPlatformAdmin) fail('PLATFORM_ADMIN_FORBIDDEN', '仅平台管理员可以调整普通管理员角色')
      if (!context.targetIsMember) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可调整管理员角色')
      if (context.targetIsOrdinaryAdmin) return { value: 'already-granted', changed: false }
      await connection.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'ordinary_admin',?,?,?)", [input.targetUserId, input.actorUserId, new Date(input.createdAt), new Date(input.createdAt)])
      await this.insertAudit(connection, input, 'ordinary_admin_granted')
      return { value: 'granted', changed: true }
    })
  }

  revokeOrdinaryAdmin(input: PlatformRoleChangeInput): Promise<'revoked' | 'already-revoked'> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ROLE_CHANGE')
      if (!context.actorIsPlatformAdmin) fail('PLATFORM_ADMIN_FORBIDDEN', '仅平台管理员可以调整普通管理员角色')
      if (!context.targetIsOrdinaryAdmin) return { value: 'already-revoked', changed: false }
      await connection.query("DELETE FROM user_roles WHERE user_id=? AND role_code='ordinary_admin'", [input.targetUserId])
      await this.insertAudit(connection, input, 'ordinary_admin_revoked')
      return { value: 'revoked', changed: true }
    })
  }

  grantPlatformAdmin(input: PlatformRoleChangeInput): Promise<'granted' | 'already-granted'> { return this.grantOrdinaryAdmin(input) }
  revokePlatformAdmin(input: PlatformRoleChangeInput): Promise<'revoked' | 'already-revoked'> { return this.revokeOrdinaryAdmin(input) }

  revokeAllSessions(input: RevokeAllUserSessionsInput): Promise<{ revokedSessionCount: number }> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_SESSION_REVOKE')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可撤销会话')
      const [result] = await connection.query<ResultSetHeader>('UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL', [new Date(input.revokedAt), new Date(input.revokedAt), input.targetUserId])
      await this.insertAudit(connection, input, 'user_sessions_revoked')
      return { value: { revokedSessionCount: result.affectedRows }, changed: true }
    })
  }

  softDeleteUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE')
      if (context.targetDeletedAt !== null) return { value: await this.requireUserSummary(connection, input.targetUserId), changed: false }
      const changedAt = new Date(input.createdAt)
      await connection.query('UPDATE users SET deleted_at=?,updated_at=? WHERE id=?', [changedAt, changedAt, input.targetUserId])
      await connection.query('UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL', [changedAt, changedAt, input.targetUserId])
      await this.insertAudit(connection, input, 'user_soft_deleted')
      return { value: await this.requireUserSummary(connection, input.targetUserId), changed: true }
    })
  }

  restoreUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE')
      if (context.targetDeletedAt === null) return { value: await this.requireUserSummary(connection, input.targetUserId), changed: false }
      await connection.query('UPDATE users SET deleted_at=NULL,updated_at=? WHERE id=?', [new Date(input.createdAt), input.targetUserId])
      await this.insertAudit(connection, input, 'user_restored')
      return { value: await this.requireUserSummary(connection, input.targetUserId), changed: true }
    })
  }

  updateUsername(input: AdminUpdateUsernameInput): Promise<PlatformUserSummary> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可修改用户名')
      const current = await this.requireUserSummary(connection, input.targetUserId)
      if (current.username === input.username) return { value: current, changed: false }
      try { const [result] = await connection.query<ResultSetHeader>('UPDATE users SET username=?,updated_at=? WHERE id=? AND deleted_at IS NULL', [input.username, new Date(input.createdAt), input.targetUserId]); if (result.affectedRows !== 1) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在') }
      catch (error) { if (isDuplicateEntry(error)) fail('AUTH_USERNAME_TAKEN', 'username already exists'); throw error }
      await this.insertAudit(connection, input, 'user_username_changed')
      return { value: await this.requireUserSummary(connection, input.targetUserId), changed: true }
    })
  }

  resetPassword(input: AdminResetPasswordInput): Promise<AdminResetPasswordResponse> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可重置密码')
      const changedAt = new Date(input.revokedAt)
      const [userResult] = await connection.query<ResultSetHeader>('UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND deleted_at IS NULL', [input.passwordHash, changedAt, input.targetUserId])
      if (userResult.affectedRows !== 1) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
      const [sessionResult] = await connection.query<ResultSetHeader>('UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL', [changedAt, changedAt, input.targetUserId])
      await this.insertAudit(connection, input, 'user_password_reset')
      return { value: { revokedSessionCount: sessionResult.affectedRows }, changed: true }
    })
  }

  initializePlatformAdmin(input: InitialPlatformAdminGrantInput): Promise<InitialPlatformAdminGrantResult> {
    return this.write(async connection => {
      const [admins] = await connection.query<Array<RowDataPacket & { user_id: string }>>("SELECT user_id FROM user_roles WHERE role_code='platform_admin' ORDER BY user_id FOR UPDATE")
      const [users] = await connection.query<Array<RowDataPacket & { id: string; deleted_at: Date | string | null; is_initial_platform_admin: number }>>('SELECT id,deleted_at,is_initial_platform_admin FROM users WHERE id=? FOR UPDATE', [input.targetUserId])
      if (!users[0]) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
      if (users[0].deleted_at !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可初始化为平台管理员')
      const roles = await this.readRoles(connection, input.targetUserId)
      if (!roles.includes('member')) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (admins.length > 0) {
        if (admins.length === 1 && admins[0]!.user_id === input.targetUserId && users[0].is_initial_platform_admin === 1) return { value: 'already-initialized', changed: false }
        fail('PLATFORM_ADMIN_ALREADY_INITIALIZED', '平台管理员已经初始化')
      }
      const [operations] = await connection.query<RowDataPacket[]>('SELECT operation_id FROM security_audit_events WHERE operation_id=? FOR UPDATE', [input.operationId])
      if (operations.length > 0) fail('PLATFORM_ADMIN_OPERATION_CONFLICT', 'operationId 已被使用')
      await connection.query('UPDATE users SET is_initial_platform_admin=1,updated_at=? WHERE id=?', [new Date(input.createdAt), input.targetUserId])
      await connection.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,?,?)", [input.targetUserId, new Date(input.createdAt), new Date(input.createdAt)])
      await connection.query("INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES (?,NULL,?,'platform_admin_granted',?,?,?)", [input.auditEventId, input.targetUserId, input.operationId, new Date(input.createdAt), new Date(input.createdAt)])
      return { value: 'granted', changed: true }
    }, true)
  }

  async findAuditEventByOperationId(operationId: string): Promise<SecurityAuditEvent | undefined> {
    const [rows] = await this.pool.query<AuditRow[]>('SELECT id,actor_user_id,target_user_id,action_code,operation_id,created_at FROM security_audit_events WHERE operation_id=?', [operationId])
    return rows[0] ? auditEvent(rows[0]) : undefined
  }

  private async readRoles(connection: PoolConnection, userId: string): Promise<PlatformRole[]> {
    const [rows] = await connection.query<RoleRow[]>('SELECT user_id,role_code FROM user_roles WHERE user_id=? ORDER BY role_code FOR UPDATE', [userId])
    return orderedRoles(rows.map(row => row.role_code))
  }

  private async readActorCapabilities(connection: PoolConnection, actorUserId: string): Promise<{ platform: boolean; ordinary: boolean }> {
    const roles = await this.readRoles(connection, actorUserId)
    const platform = roles.includes('platform_admin')
    const ordinary = roles.includes('ordinary_admin')
    if (!platform && !ordinary) fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行管理员操作')
    return { platform, ordinary }
  }

  private async defaultActorId(connection: PoolConnection): Promise<string> {
    const [rows] = await connection.query<Array<RowDataPacket & { user_id: string }>>("SELECT user_id FROM user_roles WHERE role_code='platform_admin' ORDER BY user_id LIMIT 1")
    if (!rows[0]) fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行管理员操作')
    return rows[0].user_id
  }

  private canOrdinaryAdminSee(roles: PlatformRole[]): boolean { return roles.length === 1 && roles[0] === 'member' }

  private async lockContext(connection: PoolConnection, input: PlatformRoleChangeInput, selfError: 'PLATFORM_ADMIN_SELF_ROLE_CHANGE' | 'PLATFORM_ADMIN_SELF_SESSION_REVOKE' | 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE' | 'PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE'): Promise<Context> {
    const ids = [...new Set([input.actorUserId, input.targetUserId])].sort()
    const [users] = await connection.query<UserRow[]>(`SELECT id,username,created_at,deleted_at,is_initial_platform_admin FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, ids)
    if (users.length !== ids.length) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
    const actorRoles = await this.readRoles(connection, input.actorUserId)
    const actorIsPlatformAdmin = actorRoles.includes('platform_admin')
    const actorIsOrdinaryAdmin = actorRoles.includes('ordinary_admin')
    if (!actorIsPlatformAdmin && !actorIsOrdinaryAdmin) fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行管理员操作')
    if (input.actorUserId === input.targetUserId) {
      const messages = { PLATFORM_ADMIN_SELF_ROLE_CHANGE: '不允许调整自己的管理员角色', PLATFORM_ADMIN_SELF_SESSION_REVOKE: '不允许通过管理接口撤销自己的会话', PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE: '不允许删除或恢复自己的账号', PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE: '不允许通过管理接口修改自己的用户名或密码' } as const
      fail(selfError, messages[selfError])
    }
    const [operations] = await connection.query<RowDataPacket[]>('SELECT operation_id FROM security_audit_events WHERE operation_id=? FOR UPDATE', [input.operationId])
    if (operations.length > 0) fail('PLATFORM_ADMIN_OPERATION_CONFLICT', 'operationId 已被使用，不能推断本次成功')
    const target = users.find(row => row.id === input.targetUserId)!
    const targetRoles = await this.readRoles(connection, input.targetUserId)
    const targetIsMember = targetRoles.includes('member')
    const targetIsOrdinaryAdmin = targetRoles.includes('ordinary_admin')
    if (target.is_initial_platform_admin === 1) fail('PLATFORM_ADMIN_FORBIDDEN', '初始平台管理员不可由用户管理接口修改')
    if (actorIsOrdinaryAdmin && (!targetIsMember || targetIsOrdinaryAdmin || targetRoles.includes('platform_admin'))) fail('PLATFORM_ADMIN_FORBIDDEN', '普通管理员只能管理普通成员')
    if (actorIsPlatformAdmin && targetRoles.includes('platform_admin')) fail('PLATFORM_ADMIN_FORBIDDEN', '平台管理员不可通过用户管理接口操作平台管理员')
    return { actorIsPlatformAdmin, actorIsOrdinaryAdmin, targetIsMember, targetIsOrdinaryAdmin, targetIsInitialPlatformAdmin: target.is_initial_platform_admin === 1, targetDeletedAt: target.deleted_at }
  }

  private async insertAudit(connection: PoolConnection, input: PlatformRoleChangeInput, action: SecurityAuditAction): Promise<void> {
    await connection.query('INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [input.auditEventId, input.actorUserId, input.targetUserId, action, input.operationId, new Date(input.createdAt), new Date(input.createdAt)])
  }

  private async readSummaries(connection: PoolConnection, users: UserRow[]): Promise<PlatformUserSummary[]> {
    if (users.length === 0) return []
    const [roles] = await connection.query<RoleRow[]>(`SELECT user_id,role_code FROM user_roles WHERE user_id IN (${users.map(() => '?').join(',')}) ORDER BY user_id,role_code`, users.map(row => row.id))
    const byUser = new Map<string, string[]>()
    for (const role of roles) byUser.set(role.user_id, [...(byUser.get(role.user_id) ?? []), role.role_code])
    return users.map(row => ({ id: row.id, username: row.username, roles: orderedRoles(byUser.get(row.id)), isInitialPlatformAdmin: row.is_initial_platform_admin === 1, createdAt: new Date(row.created_at).toISOString(), deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString() }))
  }

  private async requireUserSummary(connection: PoolConnection, userId: string): Promise<PlatformUserSummary> {
    const [users] = await connection.query<UserRow[]>('SELECT id,username,created_at,deleted_at,is_initial_platform_admin FROM users WHERE id=?', [userId])
    const summary = (await this.readSummaries(connection, users))[0]
    if (!summary) fail('PLATFORM_ADMIN_USER_READ_FAILED', '读取目标用户失败')
    return summary
  }

  private async write<T>(work: (connection: PoolConnection) => Promise<TxResult<T>>, serializeBootstrap = false): Promise<T> {
    const connection = await this.pool.getConnection()
    let committed = false
    try {
      if (serializeBootstrap) {
        const [locks] = await connection.query<Array<RowDataPacket & { acquired: number }>>("SELECT GET_LOCK(CONCAT('kb_initial_admin:',MD5(DATABASE())),30) AS acquired")
        if (locks[0]?.acquired !== 1) throw new Error('initial-platform-admin-lock-unavailable')
      }
      await connection.beginTransaction()
      const result = await work(connection)
      if (result.changed) await this.hooks.beforeCommit?.()
      await connection.commit()
      committed = true
      if (result.changed) await this.hooks.afterCommit?.()
      return result.value
    } catch (error) {
      if (!committed) { try { await connection.rollback() } catch { /* preserve original */ } }
      throw error
    } finally {
      if (serializeBootstrap) { try { await connection.query("SELECT RELEASE_LOCK(CONCAT('kb_initial_admin:',MD5(DATABASE())))") } catch { /* close releases it */ } }
      connection.release()
    }
  }
}

function isDuplicateEntry(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY' }
function escapeLikeLiteral(value: string): string { return value.replaceAll('=', '==').replaceAll('%', '=%').replaceAll('_', '=_') }
function orderedRoles(roles: string[] | undefined): PlatformRole[] {
  const unique = new Set(roles)
  if (!unique.has('member') || [...unique].some(role => !['member', 'ordinary_admin', 'platform_admin'].includes(role))) throw new Error('platform-role-invariant-violated')
  return (['member', 'ordinary_admin', 'platform_admin'] as const).filter(role => unique.has(role))
}
function auditEvent(row: AuditRow): SecurityAuditEvent { return { id: row.id, ...(row.actor_user_id === null ? {} : { actorUserId: row.actor_user_id }), targetUserId: row.target_user_id, action: row.action_code, operationId: row.operation_id, createdAt: new Date(row.created_at).toISOString() } }
