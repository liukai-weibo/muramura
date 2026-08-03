import type {
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

export interface MySqlPlatformAdministrationRepositoryTestHooks {
  beforeCommit?: () => void | Promise<void>
  afterCommit?: () => void | Promise<void>
}

type UserRow = RowDataPacket & { id: string; username: string; created_at: Date | string; deleted_at: Date | string | null }
type RoleRow = RowDataPacket & { user_id: string; role_code: PlatformRole }
type AuditRow = RowDataPacket & {
  id: string
  actor_user_id: string | null
  target_user_id: string
  action_code: SecurityAuditAction
  operation_id: string
  created_at: Date | string
}

type TransactionResult<T> = { value: T; changed: boolean }

export class MySqlPlatformAdministrationRepository implements PlatformAdministrationRepository, InitialPlatformAdminRepository {
  constructor(
    private readonly pool: Pool,
    private readonly hooks: MySqlPlatformAdministrationRepositoryTestHooks = {},
  ) {}

  async listUsers(input: { page: number; query?: string }): Promise<PlatformUserPage> {
    if (!Number.isSafeInteger(input.page) || input.page < 1) fail('PLATFORM_ADMIN_INVALID_PAGE', '页码无效')
    const query = input.query?.trim() ?? ''
    const where = query ? " WHERE username LIKE ? ESCAPE '='" : ''
    const parameters = query ? [`%${escapeLikeLiteral(query)}%`] : []
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [countRows] = await connection.query<Array<RowDataPacket & { total: number | string }>>(`SELECT COUNT(*) AS total FROM users${where}`, parameters)
      const [users] = await connection.query<UserRow[]>(
        `SELECT id,username,created_at,deleted_at FROM users${where} ORDER BY created_at DESC,id ASC LIMIT 20 OFFSET ?`,
        [...parameters, (input.page - 1) * 20],
      )
      const items = await this.readSummaries(connection, users)
      await connection.commit()
      return { items, page: input.page, pageSize: 20, total: Number(countRows[0]?.total ?? 0) }
    } catch (error) {
      try { await connection.rollback() } catch { /* Preserve the read failure. */ }
      throw error
    } finally {
      connection.release()
    }
  }

  async getUserById(userId: string): Promise<PlatformUserSummary | undefined> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [users] = await connection.query<UserRow[]>('SELECT id,username,created_at,deleted_at FROM users WHERE id=?', [userId])
      const items = await this.readSummaries(connection, users)
      await connection.commit()
      return items[0]
    } catch (error) {
      try { await connection.rollback() } catch { /* Preserve the read failure. */ }
      throw error
    } finally {
      connection.release()
    }
  }

  grantPlatformAdmin(input: PlatformRoleChangeInput): Promise<'granted' | 'already-granted'> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ROLE_CHANGE')
      if (!context.targetIsMember) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可调整平台角色')
      if (context.adminUserIds.has(input.targetUserId)) return { value: 'already-granted', changed: false }
      await connection.query(
        "INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',?,?,?)",
        [input.targetUserId, input.actorUserId, new Date(input.createdAt), new Date(input.createdAt)],
      )
      await this.insertAudit(connection, input, 'platform_admin_granted')
      return { value: 'granted', changed: true }
    })
  }

  revokePlatformAdmin(input: PlatformRoleChangeInput): Promise<'revoked' | 'already-revoked'> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ROLE_CHANGE')
      if (!context.targetIsMember) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可调整平台角色')
      if (!context.adminUserIds.has(input.targetUserId)) return { value: 'already-revoked', changed: false }
      await connection.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [input.targetUserId])
      await this.insertAudit(connection, input, 'platform_admin_revoked')
      return { value: 'revoked', changed: true }
    })
  }

  revokeAllSessions(input: RevokeAllUserSessionsInput): Promise<{ revokedSessionCount: number }> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_SESSION_REVOKE')
      if (context.targetDeletedAt !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可撤销会话')
      const [result] = await connection.query<ResultSetHeader>(
        'UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL',
        [new Date(input.revokedAt), new Date(input.revokedAt), input.targetUserId],
      )
      await this.insertAudit(connection, input, 'user_sessions_revoked')
      return { value: { revokedSessionCount: result.affectedRows }, changed: true }
    })
  }

  softDeleteUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE')
      if (!context.targetIsMember) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (context.targetDeletedAt !== null) {
        return { value: await this.requireUserSummary(connection, input.targetUserId), changed: false }
      }
      const changedAt = new Date(input.createdAt)
      await connection.query('UPDATE users SET deleted_at=?,updated_at=? WHERE id=?', [changedAt, changedAt, input.targetUserId])
      await connection.query(
        'UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE user_id=? AND revoked_at IS NULL',
        [changedAt, changedAt, input.targetUserId],
      )
      await connection.query("DELETE FROM user_roles WHERE user_id=? AND role_code='platform_admin'", [input.targetUserId])
      await this.insertAudit(connection, input, 'user_soft_deleted')
      return { value: await this.requireUserSummary(connection, input.targetUserId), changed: true }
    })
  }

  restoreUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary> {
    return this.write(async connection => {
      const context = await this.lockContext(connection, input, 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE')
      if (!context.targetIsMember) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (context.targetDeletedAt === null) {
        return { value: await this.requireUserSummary(connection, input.targetUserId), changed: false }
      }
      await connection.query('UPDATE users SET deleted_at=NULL,updated_at=? WHERE id=?', [new Date(input.createdAt), input.targetUserId])
      await this.insertAudit(connection, input, 'user_restored')
      return { value: await this.requireUserSummary(connection, input.targetUserId), changed: true }
    })
  }

  initializePlatformAdmin(input: InitialPlatformAdminGrantInput): Promise<InitialPlatformAdminGrantResult> {
    return this.write(async connection => {
      const [admins] = await connection.query<Array<RowDataPacket & { user_id: string }>>(
        "SELECT user_id FROM user_roles FORCE INDEX (user_roles_role_user_idx) WHERE role_code='platform_admin' ORDER BY user_id FOR UPDATE",
      )
      const [users] = await connection.query<Array<RowDataPacket & { deleted_at: Date | string | null }>>('SELECT id,deleted_at FROM users WHERE id=? FOR UPDATE', [input.targetUserId])
      if (users.length === 0) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
      if (users[0]!.deleted_at !== null) fail('PLATFORM_ADMIN_TARGET_DELETED', '已删除账号不可初始化为平台管理员')
      const [roles] = await connection.query<Array<RowDataPacket & { role_code: string }>>('SELECT role_code FROM user_roles WHERE user_id=? ORDER BY role_code FOR UPDATE', [input.targetUserId])
      if (!roles.some(row => row.role_code === 'member')) fail('PLATFORM_ADMIN_TARGET_NOT_MEMBER', '目标账号角色状态不可操作')
      if (admins.length > 0) {
        if (admins.every(row => row.user_id === input.targetUserId)) return { value: 'already-initialized', changed: false }
        fail('PLATFORM_ADMIN_ALREADY_INITIALIZED', '平台管理员已经初始化')
      }
      const [operations] = await connection.query<RowDataPacket[]>('SELECT operation_id FROM security_audit_events WHERE operation_id=? FOR UPDATE', [input.operationId])
      if (operations.length > 0) fail('PLATFORM_ADMIN_OPERATION_CONFLICT', 'operationId 已被使用，不能推断本次成功')
      await connection.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,?,?)", [input.targetUserId, new Date(input.createdAt), new Date(input.createdAt)])
      await connection.query(
        "INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES (?,NULL,?,'platform_admin_granted',?,?,?)",
        [input.auditEventId, input.targetUserId, input.operationId, new Date(input.createdAt), new Date(input.createdAt)],
      )
      return { value: 'granted', changed: true }
    }, true)
  }

  async findAuditEventByOperationId(operationId: string): Promise<SecurityAuditEvent | undefined> {
    const [rows] = await this.pool.query<AuditRow[]>(
      'SELECT id,actor_user_id,target_user_id,action_code,operation_id,created_at FROM security_audit_events WHERE operation_id=?',
      [operationId],
    )
    const row = rows[0]
    return row ? auditEvent(row) : undefined
  }

  private async lockContext(
    connection: PoolConnection,
    input: PlatformRoleChangeInput,
    selfError: 'PLATFORM_ADMIN_SELF_ROLE_CHANGE' | 'PLATFORM_ADMIN_SELF_SESSION_REVOKE' | 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE',
  ): Promise<{ adminUserIds: Set<string>; targetIsMember: boolean; targetDeletedAt: Date | string | null }> {
    const [admins] = await connection.query<Array<RowDataPacket & { user_id: string }>>(
      "SELECT r.user_id FROM user_roles r FORCE INDEX (user_roles_role_user_idx) JOIN users u ON u.id=r.user_id WHERE r.role_code='platform_admin' AND u.deleted_at IS NULL ORDER BY r.user_id FOR UPDATE",
    )
    const ids = [...new Set([input.actorUserId, input.targetUserId])].sort()
    const [users] = await connection.query<Array<RowDataPacket & { id: string; deleted_at: Date | string | null }>>(
      `SELECT id,deleted_at FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
      ids,
    )
    if (users.length !== ids.length) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
    const adminUserIds = new Set(admins.map(row => row.user_id))
    if (!adminUserIds.has(input.actorUserId)) fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行平台管理操作')
    if (input.actorUserId === input.targetUserId) {
      const messages = {
        PLATFORM_ADMIN_SELF_ROLE_CHANGE: '不允许调整自己的平台角色',
        PLATFORM_ADMIN_SELF_SESSION_REVOKE: '不允许通过管理接口撤销自己的会话',
        PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE: '不允许删除或恢复自己的账号',
      } as const
      fail(selfError, messages[selfError])
    }
    const [operations] = await connection.query<RowDataPacket[]>(
      'SELECT operation_id FROM security_audit_events WHERE operation_id=? FOR UPDATE',
      [input.operationId],
    )
    if (operations.length > 0) fail('PLATFORM_ADMIN_OPERATION_CONFLICT', 'operationId 已被使用，不能推断本次成功')
    const [targetRoles] = await connection.query<Array<RowDataPacket & { role_code: string }>>(
      'SELECT role_code FROM user_roles WHERE user_id=? ORDER BY role_code FOR UPDATE',
      [input.targetUserId],
    )
    const target = users.find(row => row.id === input.targetUserId)!
    return { adminUserIds, targetIsMember: targetRoles.some(row => row.role_code === 'member'), targetDeletedAt: target.deleted_at }
  }

  private insertAudit(connection: PoolConnection, input: PlatformRoleChangeInput, action: SecurityAuditAction): Promise<unknown> {
    return connection.query(
      'INSERT INTO security_audit_events(id,actor_user_id,target_user_id,action_code,operation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [input.auditEventId, input.actorUserId, input.targetUserId, action, input.operationId, new Date(input.createdAt), new Date(input.createdAt)],
    )
  }

  private async readSummaries(connection: PoolConnection, users: UserRow[]): Promise<PlatformUserSummary[]> {
    if (users.length === 0) return []
    const [roles] = await connection.query<RoleRow[]>(
      `SELECT user_id,role_code FROM user_roles WHERE user_id IN (${users.map(() => '?').join(',')}) ORDER BY user_id,role_code`,
      users.map(row => row.id),
    )
    const rolesByUser = new Map<string, string[]>()
    for (const role of roles) {
      const values = rolesByUser.get(role.user_id) ?? []
      values.push(role.role_code)
      rolesByUser.set(role.user_id, values)
    }
    return users.map(row => ({
      id: row.id,
      username: row.username,
      roles: orderedRoles(rolesByUser.get(row.id)),
      createdAt: new Date(row.created_at).toISOString(),
      deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    }))
  }

  private async requireUserSummary(connection: PoolConnection, userId: string): Promise<PlatformUserSummary> {
    const [users] = await connection.query<UserRow[]>('SELECT id,username,created_at,deleted_at FROM users WHERE id=?', [userId])
    const summaries = await this.readSummaries(connection, users)
    const summary = summaries[0]
    if (!summary) fail('PLATFORM_ADMIN_USER_READ_FAILED', '读取目标用户失败')
    return summary
  }

  private async write<T>(work: (connection: PoolConnection) => Promise<TransactionResult<T>>, serializeBootstrap = false): Promise<T> {
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
      if (!committed) {
        try { await connection.rollback() } catch { /* Preserve the original failure or unknown commit outcome. */ }
      }
      throw error
    } finally {
      if (serializeBootstrap) {
        try { await connection.query("SELECT RELEASE_LOCK(CONCAT('kb_initial_admin:',MD5(DATABASE())))") } catch { /* Connection close releases the advisory lock. */ }
      }
      connection.release()
    }
  }
}

function escapeLikeLiteral(value: string): string {
  return value.replaceAll('=', '==').replaceAll('%', '=%').replaceAll('_', '=_')
}

function orderedRoles(roles: string[] | undefined): PlatformRole[] {
  const unique = new Set(roles)
  if (!unique.has('member') || [...unique].some(role => role !== 'member' && role !== 'platform_admin')) {
    throw new Error('platform-role-invariant-violated')
  }
  return (['member', 'platform_admin'] as const).filter(role => unique.has(role))
}

function auditEvent(row: AuditRow): SecurityAuditEvent {
  return {
    id: row.id,
    ...(row.actor_user_id === null ? {} : { actorUserId: row.actor_user_id }),
    targetUserId: row.target_user_id,
    action: row.action_code,
    operationId: row.operation_id,
    createdAt: new Date(row.created_at).toISOString(),
  }
}
