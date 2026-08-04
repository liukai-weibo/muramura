import crypto from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../packages/domain/src/index'
import {
  createMySqlPool,
  MySqlAuthRepository,
  MySqlPlatformAdministrationRepository,
  runMySqlMigrations,
} from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''
let appUser = ''
let migratorUser = ''
let root: Pool
let app: Pool
let migrator: Pool
const at = '2026-07-30T08:00:00.000Z'

const change = (actorUserId: string, targetUserId: string, operationId = crypto.randomUUID()) => ({
  actorUserId,
  targetUserId,
  auditEventId: crypto.randomUUID(),
  operationId,
  createdAt: at,
})

describe.runIf(enabled)('platform administration repository', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_platform_repo_${suffix}`
    appUser = `kb_platform_app_${suffix.slice(0, 15)}`
    migratorUser = `kb_platform_mig_${suffix.slice(0, 15)}`
    expect(database).not.toMatch(/^knowledge_base(?:_uat)?$/)
    const appPassword = crypto.randomUUID()
    const migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    app = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: appUser, password: appPassword, connectionLimit: 6 })
    migrator = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    await runMySqlMigrations(migrator, `${process.cwd()}/migrations`)
  })

  beforeEach(async () => {
    await app.query('DELETE FROM security_audit_events')
    await app.query('DELETE FROM user_sessions')
    await app.query('DELETE FROM user_roles')
    await app.query('DELETE FROM users')
  })

  afterAll(async () => {
    await app?.end()
    await migrator?.end()
    await root?.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root?.end()
  })

  async function user(id: string, username = id, createdAt = at): Promise<void> {
    await new MySqlAuthRepository(app).createUser({ id, username, passwordHash: 'scrypt$redacted', createdAt })
  }

  async function admin(id: string, username = id, createdAt = at): Promise<void> {
    await user(id, username, createdAt)
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'platform_admin',NULL,?,?)", [id, new Date(createdAt), new Date(createdAt)])
  }

  async function securitySnapshot(): Promise<unknown> {
    const [users] = await app.query('SELECT id,deleted_at,updated_at FROM users ORDER BY id')
    const [roles] = await app.query('SELECT * FROM user_roles ORDER BY user_id,role_code')
    const [sessions] = await app.query('SELECT * FROM user_sessions ORDER BY id')
    const [audit] = await app.query('SELECT * FROM security_audit_events ORDER BY id')
    return { users, roles, sessions, audit }
  }

  it('creates users and member atomically, rolling the user back when member insertion fails', async () => {
    await user('valid')
    expect((await app.query("SELECT user_id,role_code,granted_by_user_id FROM user_roles WHERE user_id='valid'"))[0]).toEqual([{ user_id: 'valid', role_code: 'member', granted_by_user_id: null }])
    await migrator.query("ALTER TABLE user_roles ADD CONSTRAINT test_reject_rolled_back CHECK (user_id <> 'rolled-back')")
    try {
      await expect(new MySqlAuthRepository(app).createUser({ id: 'rolled-back', username: 'rolled-back', passwordHash: 'scrypt$redacted', createdAt: at })).rejects.toThrow()
      expect((await app.query("SELECT id FROM users WHERE id='rolled-back'"))[0]).toEqual([])
    } finally {
      await migrator.query('ALTER TABLE user_roles DROP CHECK test_reject_rolled_back')
    }
  })

  it('lists fixed pages with literal search, stable ordering, ordered roles, and no secret fields', async () => {
    for (let index = 0; index < 21; index++) await user(`u-${String(index).padStart(2, '0')}`, index === 7 ? 'literal%_=name' : `user-${index}`, `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`)
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('u-20','platform_admin',NULL,?,?)", [new Date(at), new Date(at)])
    const repository = new MySqlPlatformAdministrationRepository(app)
    const first = await repository.listUsers({ page: 1 })
    expect(first.pageSize).toBe(20)
    expect(first.total).toBe(21)
    expect(first.items).toHaveLength(20)
    expect(first.items[0]).toMatchObject({ id: 'u-20', roles: ['member', 'platform_admin'] })
    expect(Object.keys(first.items[0]!).sort()).toEqual(['createdAt', 'deletedAt', 'id', 'roles', 'username'])
    expect((await repository.listUsers({ page: 2 })).items.map(item => item.id)).toEqual(['u-00'])
    expect((await repository.listUsers({ page: 1, query: '  %_=  ' })).items.map(item => item.id)).toEqual(['u-07'])
    expect(await repository.getUserById('u-20')).toEqual(first.items[0])
    expect(await repository.getUserById('missing')).toBeUndefined()
    await expect(repository.listUsers({ page: 0 })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_INVALID_PAGE' })
  })

  it('fails list and single-user reads closed for missing member or unknown role facts', async () => {
    await user('role-user')
    const repository = new MySqlPlatformAdministrationRepository(app)
    await app.query("DELETE FROM user_roles WHERE user_id='role-user' AND role_code='member'")
    await expect(repository.listUsers({ page: 1 })).rejects.toThrow('platform-role-invariant-violated')
    await expect(repository.getUserById('role-user')).rejects.toThrow('platform-role-invariant-violated')
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('role-user','member',NULL,?,?)", [new Date(at), new Date(at)])
    await migrator.query('ALTER TABLE user_roles DROP CHECK user_roles_role_code_check')
    try {
      await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('role-user','unknown-role',NULL,?,?)", [new Date(at), new Date(at)])
      await expect(repository.listUsers({ page: 1 })).rejects.toThrow('platform-role-invariant-violated')
      await expect(repository.getUserById('role-user')).rejects.toThrow('platform-role-invariant-violated')
    } finally {
      await app.query("DELETE FROM user_roles WHERE role_code='unknown-role'")
      await migrator.query("ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_code_check CHECK (role_code IN ('member', 'platform_admin'))")
    }
  })

  it('enforces actor, target, self, operation, no-op, audit, and rollback rules', async () => {
    await admin('actor')
    await user('target')
    await user('outsider')
    await app.query("DELETE FROM user_roles WHERE user_id='outsider' AND role_code='member'")
    const repository = new MySqlPlatformAdministrationRepository(app)
    const baseline = await securitySnapshot()
    await expect(repository.grantPlatformAdmin(change('outsider', 'target'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_FORBIDDEN' })
    await expect(repository.grantPlatformAdmin(change('actor', 'missing'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_USER_NOT_FOUND' })
    await expect(repository.grantPlatformAdmin(change('actor', 'actor'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_ROLE_CHANGE' })
    await expect(repository.grantPlatformAdmin(change('actor', 'outsider'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_NOT_MEMBER' })
    expect(await securitySnapshot()).toEqual(baseline)

    const granted = change('actor', 'target')
    expect(await repository.grantPlatformAdmin(granted)).toBe('granted')
    expect(await repository.findAuditEventByOperationId(granted.operationId)).toMatchObject({ actorUserId: 'actor', targetUserId: 'target', action: 'platform_admin_granted' })
    const afterGrant = await securitySnapshot()
    expect(await repository.grantPlatformAdmin(change('actor', 'target'))).toBe('already-granted')
    expect(await securitySnapshot()).toEqual(afterGrant)
    await expect(repository.revokePlatformAdmin({ ...change('actor', 'target'), operationId: granted.operationId })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_OPERATION_CONFLICT' })
    expect(await securitySnapshot()).toEqual(afterGrant)

    const revoked = change('actor', 'target')
    expect(await repository.revokePlatformAdmin(revoked)).toBe('revoked')
    expect(await repository.revokePlatformAdmin(change('actor', 'target'))).toBe('already-revoked')
    expect(await repository.findAuditEventByOperationId(revoked.operationId)).toMatchObject({ action: 'platform_admin_revoked' })

    await user('audit-failure')
    const beforeFailure = await securitySnapshot()
    await expect(repository.grantPlatformAdmin({ ...change('actor', 'audit-failure'), auditEventId: revoked.auditEventId })).rejects.toThrow()
    expect(await securitySnapshot()).toEqual(beforeFailure)
  })

  it('serializes concurrent reciprocal revokes and never removes the final administrator', async () => {
    await admin('only-admin')
    const repository = new MySqlPlatformAdministrationRepository(app)
    await expect(repository.revokePlatformAdmin(change('only-admin', 'only-admin'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_ROLE_CHANGE' })
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([{ user_id: 'only-admin' }])

    await app.query('DELETE FROM user_roles')
    await app.query('DELETE FROM users')
    await admin('admin-a')
    await admin('admin-b')
    const results = await Promise.allSettled([
      repository.revokePlatformAdmin(change('admin-a', 'admin-b')),
      repository.revokePlatformAdmin(change('admin-b', 'admin-a')),
    ])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]).toMatchObject({ value: 'revoked' })
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { code: 'PLATFORM_ADMIN_FORBIDDEN' } })
    const [admins] = await app.query<RowDataPacket[]>("SELECT user_id FROM user_roles WHERE role_code='platform_admin'")
    expect(admins.length).toBeGreaterThanOrEqual(1)
    expect((await app.query("SELECT id FROM security_audit_events WHERE action_code='platform_admin_revoked'"))[0]).toHaveLength(1)
  })

  it('revokes every unrevoked session, audits zero-count changes, and rejects self-session revocation', async () => {
    await admin('actor')
    await user('target')
    await app.query('INSERT INTO user_sessions(id,user_id,session_secret_hash,expires_at,revoked_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?),(?,?,?,?,NULL,?,?)', [
      'expired', 'target', crypto.randomBytes(32), new Date('2020-01-01T00:00:00Z'), new Date('2019-01-01T00:00:00Z'), new Date('2019-01-01T00:00:00Z'),
      'active', 'target', crypto.randomBytes(32), new Date('2030-01-01T00:00:00Z'), new Date(at), new Date(at),
    ])
    const repository = new MySqlPlatformAdministrationRepository(app)
    await expect(repository.revokeAllSessions({ ...change('actor', 'actor'), revokedAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_SESSION_REVOKE' })
    const first = change('actor', 'target')
    expect(await repository.revokeAllSessions({ ...first, revokedAt: at })).toEqual({ revokedSessionCount: 2 })
    expect(await repository.revokeAllSessions({ ...change('actor', 'target'), revokedAt: at })).toEqual({ revokedSessionCount: 0 })
    expect((await app.query("SELECT id FROM security_audit_events WHERE action_code='user_sessions_revoked'"))[0]).toHaveLength(2)
  })

  it('soft-deletes and restores accounts atomically without restoring sessions or administrator roles', async () => {
    await admin('actor')
    await admin('target')
    const auth = new MySqlAuthRepository(app)
    expect(await auth.createSession({ id: 'target-session', userId: 'target', secretHash: Buffer.alloc(32, 8), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })).toBe('created')
    const repository = new MySqlPlatformAdministrationRepository(app)

    await expect(repository.softDeleteUser(change('actor', 'actor'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_ACCOUNT_STATE_CHANGE' })
    const deletion = change('actor', 'target')
    const deleted = await repository.softDeleteUser(deletion)
    expect(deleted).toMatchObject({ id: 'target', roles: ['member'], deletedAt: at })
    expect(await auth.findUserByUsername('target')).toBeUndefined()
    expect(await auth.getSessionBySecretHash(Buffer.alloc(32, 8), at)).toBeUndefined()
    expect(await auth.createSession({ id: 'late-session', userId: 'target', secretHash: Buffer.alloc(32, 9), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })).toBe('account-unavailable')
    expect((await app.query("SELECT role_code FROM user_roles WHERE user_id='target' ORDER BY role_code"))[0]).toEqual([{ role_code: 'member' }])
    expect(await repository.findAuditEventByOperationId(deletion.operationId)).toMatchObject({ action: 'user_soft_deleted' })
    await expect(repository.grantPlatformAdmin(change('actor', 'target'))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_DELETED' })
    await expect(repository.revokeAllSessions({ ...change('actor', 'target'), revokedAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_DELETED' })

    const deleteNoOp = change('actor', 'target')
    expect((await repository.softDeleteUser(deleteNoOp)).deletedAt).toBe(at)
    expect(await repository.findAuditEventByOperationId(deleteNoOp.operationId)).toBeUndefined()
    await expect(repository.softDeleteUser(deletion)).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_OPERATION_CONFLICT' })

    const restoration = { ...change('actor', 'target'), createdAt: '2026-07-30T09:00:00.000Z' }
    expect((await repository.restoreUser(restoration)).deletedAt).toBeNull()
    expect(await auth.findUserByUsername('target')).toBeDefined()
    expect(await auth.getSessionBySecretHash(Buffer.alloc(32, 8), '2026-07-30T09:00:00.000Z')).toBeUndefined()
    expect((await app.query("SELECT role_code FROM user_roles WHERE user_id='target' ORDER BY role_code"))[0]).toEqual([{ role_code: 'member' }])
    expect(await repository.findAuditEventByOperationId(restoration.operationId)).toMatchObject({ action: 'user_restored' })
    const restoreNoOp = change('actor', 'target')
    expect((await repository.restoreUser(restoreNoOp)).deletedAt).toBeNull()
    expect(await repository.findAuditEventByOperationId(restoreNoOp.operationId)).toBeUndefined()
  })

  it('rolls back the account marker, sessions, role and audit together when deletion fails before commit', async () => {
    await admin('actor')
    await admin('target')
    const auth = new MySqlAuthRepository(app)
    await auth.createSession({ id: 'target-session', userId: 'target', secretHash: Buffer.alloc(32, 6), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })
    const before = await securitySnapshot()
    const repository = new MySqlPlatformAdministrationRepository(app, { beforeCommit: () => { throw new Error('before account deletion commit') } })
    await expect(repository.softDeleteUser(change('actor', 'target'))).rejects.toThrow('before account deletion commit')
    expect(await securitySnapshot()).toEqual(before)
  })

  it('does not create a session when deletion wins the password-check to session-create race', async () => {
    await admin('actor')
    await user('target')
    const auth = new MySqlAuthRepository(app)
    let markDeletionReady!: () => void
    let allowCommit!: () => void
    const deletionReady = new Promise<void>(resolve => { markDeletionReady = resolve })
    const commitAllowed = new Promise<void>(resolve => { allowCommit = resolve })
    const repository = new MySqlPlatformAdministrationRepository(app, {
      beforeCommit: async () => { markDeletionReady(); await commitAllowed },
    })

    const deletion = repository.softDeleteUser(change('actor', 'target'))
    await deletionReady
    const session = auth.createSession({ id: 'racing-session', userId: 'target', secretHash: Buffer.alloc(32, 5), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })
    allowCommit()

    expect((await deletion).deletedAt).toBe(at)
    expect(await session).toBe('account-unavailable')
    expect((await app.query("SELECT id FROM user_sessions WHERE id='racing-session'"))[0]).toEqual([])
  })

  it('rolls back before commit and exposes committed unknown outcomes only through explicit audit reads', async () => {
    await admin('actor')
    await user('target')
    const before = await securitySnapshot()
    const beforeFailure = change('actor', 'target')
    const rollbackRepository = new MySqlPlatformAdministrationRepository(app, { beforeCommit: () => { throw new Error('before commit failure') } })
    await expect(rollbackRepository.grantPlatformAdmin(beforeFailure)).rejects.toThrow('before commit failure')
    expect(await securitySnapshot()).toEqual(before)
    expect(await rollbackRepository.findAuditEventByOperationId(beforeFailure.operationId)).toBeUndefined()

    let afterCommitCalls = 0
    const unknown = change('actor', 'target')
    const unknownRepository = new MySqlPlatformAdministrationRepository(app, { afterCommit: () => { afterCommitCalls++; throw new Error('response lost after commit') } })
    await expect(unknownRepository.grantPlatformAdmin(unknown)).rejects.toThrow('response lost after commit')
    expect(afterCommitCalls).toBe(1)
    expect(await unknownRepository.findAuditEventByOperationId(unknown.operationId)).toMatchObject({ action: 'platform_admin_granted', targetUserId: 'target' })
    expect((await app.query("SELECT role_code FROM user_roles WHERE user_id='target' ORDER BY role_code"))[0]).toEqual([{ role_code: 'member' }, { role_code: 'platform_admin' }])
    await expect(unknownRepository.grantPlatformAdmin(unknown)).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_OPERATION_CONFLICT' })
    expect(afterCommitCalls).toBe(1)
  })

  it('fails authentication role reads closed for missing member and unknown role data', async () => {
    await user('role-user')
    const auth = new MySqlAuthRepository(app)
    await auth.createSession({ id: 'role-session', userId: 'role-user', secretHash: Buffer.alloc(32, 7), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })
    await app.query("DELETE FROM user_roles WHERE user_id='role-user' AND role_code='member'")
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('role-user','platform_admin',NULL,?,?)", [new Date(at), new Date(at)])
    await expect(auth.findUserByUsername('role-user')).rejects.toThrow('auth-role-invariant-violated')
    await expect(auth.getSessionBySecretHash(Buffer.alloc(32, 7), at)).rejects.toThrow('auth-role-invariant-violated')
    await app.query("DELETE FROM user_roles WHERE user_id='role-user' AND role_code='platform_admin'")
    await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('role-user','member',NULL,?,?)", [new Date(at), new Date(at)])
    await migrator.query('ALTER TABLE user_roles DROP CHECK user_roles_role_code_check')
    try {
      await app.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES ('role-user','unknown-role',NULL,?,?)", [new Date(at), new Date(at)])
      await expect(auth.findUserByUsername('role-user')).rejects.toThrow('auth-role-invariant-violated')
      await expect(auth.getSessionBySecretHash(Buffer.alloc(32, 7), at)).rejects.toThrow('auth-role-invariant-violated')
    } finally {
      await app.query("DELETE FROM user_roles WHERE role_code='unknown-role'")
      await migrator.query("ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_code_check CHECK (role_code IN ('member', 'platform_admin'))")
    }
  })

  it('updates usernames and resets passwords with audit, rejecting self and deleted targets', async () => {
    await admin('actor')
    const passwordHash = await hashPassword('password-old')
    await new MySqlAuthRepository(app).createUser({ id: 'target', username: 'target', passwordHash, createdAt: at })
    await new MySqlAuthRepository(app).createUser({ id: 'other', username: 'other', passwordHash: 'scrypt$redacted', createdAt: at })
    const auth = new MySqlAuthRepository(app)
    expect(await auth.createSession({ id: 'target-session', userId: 'target', secretHash: Buffer.alloc(32, 3), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })).toBe('created')
    const repository = new MySqlPlatformAdministrationRepository(app)

    await expect(repository.updateUsername({ ...change('actor', 'actor'), username: 'self' })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE' })
    await expect(repository.resetPassword({ ...change('actor', 'actor'), passwordHash: 'x', revokedAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_SELF_CREDENTIAL_CHANGE' })

    const rename = { ...change('actor', 'target'), username: 'renamed-target' }
    expect(await repository.updateUsername(rename)).toMatchObject({ id: 'target', username: 'renamed-target', deletedAt: null })
    expect(await repository.findAuditEventByOperationId(rename.operationId)).toMatchObject({ action: 'user_username_changed' })
    await expect(repository.updateUsername({ ...change('actor', 'target'), username: 'other' })).rejects.toMatchObject({ code: 'AUTH_USERNAME_TAKEN' })

    const reset = { ...change('actor', 'target'), passwordHash: await hashPassword('password-new'), revokedAt: at }
    expect(await repository.resetPassword(reset)).toEqual({ revokedSessionCount: 1 })
    expect(await auth.getSessionBySecretHash(Buffer.alloc(32, 3), at)).toBeUndefined()
    expect(await repository.findAuditEventByOperationId(reset.operationId)).toMatchObject({ action: 'user_password_reset' })
    const credential = await auth.findCredentialByUserId('target')
    expect(credential).toBeDefined()
    expect(await verifyPassword('password-new', credential!.passwordHash)).toBe(true)

    await repository.softDeleteUser(change('actor', 'target'))
    await expect(repository.updateUsername({ ...change('actor', 'target'), username: 'again' })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_DELETED' })
    await expect(repository.resetPassword({ ...change('actor', 'target'), passwordHash: 'x', revokedAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_DELETED' })
  })

  it('lets an account rename itself and rotate its password while revoking sessions', async () => {
    const passwordHash = await hashPassword('password-old')
    await new MySqlAuthRepository(app).createUser({ id: 'self', username: 'self', passwordHash, createdAt: at })
    await new MySqlAuthRepository(app).createUser({ id: 'taken', username: 'taken', passwordHash: 'scrypt$redacted', createdAt: at })
    const auth = new MySqlAuthRepository(app)
    expect(await auth.createSession({ id: 'self-session', userId: 'self', secretHash: Buffer.alloc(32, 4), expiresAt: '2030-01-01T00:00:00.000Z', createdAt: at })).toBe('created')

    expect(await auth.updateUsername({ userId: 'self', username: 'self-renamed', updatedAt: at })).toMatchObject({ id: 'self', username: 'self-renamed' })
    await expect(auth.updateUsername({ userId: 'self', username: 'taken', updatedAt: at })).rejects.toMatchObject({ code: 'AUTH_USERNAME_TAKEN' })

    const newPasswordHash = await hashPassword('password-new')
    expect(await auth.updatePasswordHashAndRevokeSessions({
      userId: 'self',
      expectedPasswordHash: passwordHash,
      passwordHash: newPasswordHash,
      revokedAt: at,
    })).toEqual({ revokedSessionCount: 1 })
    await expect(auth.updatePasswordHashAndRevokeSessions({
      userId: 'self',
      expectedPasswordHash: passwordHash,
      passwordHash: await hashPassword('password-stale'),
      revokedAt: at,
    })).rejects.toMatchObject({ code: 'AUTH_CURRENT_PASSWORD_INVALID' })
    expect(await auth.getSessionBySecretHash(Buffer.alloc(32, 4), at)).toBeUndefined()
    const credential = await auth.findCredentialByUserId('self')
    expect(await verifyPassword('password-new', credential!.passwordHash)).toBe(true)
  })

  it('initializes exactly one explicit member as bootstrap administrator and is idempotent only for that target', async () => {
    await user('target-a')
    await user('target-b')
    await app.query("INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES ('no-member','no-member','scrypt$redacted',?,?)", [new Date(at), new Date(at)])
    const repository = new MySqlPlatformAdministrationRepository(app)
    await expect(repository.initializePlatformAdmin({ targetUserId: 'missing', auditEventId: 'missing-audit', operationId: 'missing-op', createdAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_USER_NOT_FOUND' })
    await expect(repository.initializePlatformAdmin({ targetUserId: 'no-member', auditEventId: 'member-audit', operationId: 'member-op', createdAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_TARGET_NOT_MEMBER' })
    const input = { targetUserId: 'target-a', auditEventId: 'bootstrap-audit', operationId: 'bootstrap-op', createdAt: at }
    expect(await repository.initializePlatformAdmin(input)).toBe('granted')
    expect(await repository.initializePlatformAdmin({ ...input, auditEventId: 'unused-audit', operationId: 'unused-op' })).toBe('already-initialized')
    await expect(repository.initializePlatformAdmin({ targetUserId: 'target-b', auditEventId: 'other-audit', operationId: 'other-op', createdAt: at })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_ALREADY_INITIALIZED' })
    expect((await app.query("SELECT user_id,role_code,granted_by_user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([{ user_id: 'target-a', role_code: 'platform_admin', granted_by_user_id: null }])
    expect((await app.query('SELECT id,actor_user_id,target_user_id,action_code,operation_id FROM security_audit_events'))[0]).toEqual([{ id: 'bootstrap-audit', actor_user_id: null, target_user_id: 'target-a', action_code: 'platform_admin_granted', operation_id: 'bootstrap-op' }])
  })

  it('serializes concurrent bootstrap attempts and preserves commit boundaries', async () => {
    await user('target-a')
    await user('target-b')
    const repository = new MySqlPlatformAdministrationRepository(app)
    const different = await Promise.allSettled([
      repository.initializePlatformAdmin({ targetUserId: 'target-a', auditEventId: 'audit-a', operationId: 'op-a', createdAt: at }),
      repository.initializePlatformAdmin({ targetUserId: 'target-b', auditEventId: 'audit-b', operationId: 'op-b', createdAt: at }),
    ])
    expect(different.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(different.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'PLATFORM_ADMIN_ALREADY_INITIALIZED' }) })])
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toHaveLength(1)
    expect((await app.query('SELECT id FROM security_audit_events'))[0]).toHaveLength(1)

    await app.query('DELETE FROM security_audit_events')
    await app.query("DELETE FROM user_roles WHERE role_code='platform_admin'")
    const same = await Promise.all([
      repository.initializePlatformAdmin({ targetUserId: 'target-a', auditEventId: 'same-a', operationId: 'same-op-a', createdAt: at }),
      repository.initializePlatformAdmin({ targetUserId: 'target-a', auditEventId: 'same-b', operationId: 'same-op-b', createdAt: at }),
    ])
    expect(same.sort()).toEqual(['already-initialized', 'granted'])
    expect((await app.query('SELECT id FROM security_audit_events'))[0]).toHaveLength(1)

    await app.query('DELETE FROM security_audit_events')
    await app.query("DELETE FROM user_roles WHERE role_code='platform_admin'")
    const beforeFailure = new MySqlPlatformAdministrationRepository(app, { beforeCommit: () => { throw new Error('before bootstrap commit') } })
    await expect(beforeFailure.initializePlatformAdmin({ targetUserId: 'target-a', auditEventId: 'before-audit', operationId: 'before-op', createdAt: at })).rejects.toThrow('before bootstrap commit')
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([])
    expect((await app.query('SELECT id FROM security_audit_events'))[0]).toEqual([])

    const afterFailure = new MySqlPlatformAdministrationRepository(app, { afterCommit: () => { throw new Error('after bootstrap commit') } })
    await expect(afterFailure.initializePlatformAdmin({ targetUserId: 'target-a', auditEventId: 'after-audit', operationId: 'after-op', createdAt: at })).rejects.toThrow('after bootstrap commit')
    expect(await afterFailure.findAuditEventByOperationId('after-op')).toMatchObject({ targetUserId: 'target-a', action: 'platform_admin_granted' })
    expect((await app.query("SELECT user_id FROM user_roles WHERE role_code='platform_admin'"))[0]).toEqual([{ user_id: 'target-a' }])
  })
})
