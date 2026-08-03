import { platformRoles, type AuthCredentialRecord, type AuthRepository, type AuthUser, type CreateAuthUserInput, type PlatformRole } from '@knowledge-base/contracts'
import { fail } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

type UserRoleRow = RowDataPacket & { id: string; username: string; password_hash?: string; created_at: Date | string; role_code: string | null }

export class MySqlAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}
  async createUser(input: CreateAuthUserInput): Promise<AuthUser> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.query('INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)', [input.id, input.username, input.passwordHash, new Date(input.createdAt), new Date(input.createdAt)])
      await connection.query("INSERT INTO user_roles(user_id,role_code,granted_by_user_id,created_at,updated_at) VALUES (?,'member',NULL,?,?)", [input.id, new Date(input.createdAt), new Date(input.createdAt)])
      await connection.commit()
      return { id: input.id, username: input.username, roles: ['member'], createdAt: input.createdAt }
    } catch (error) {
      await rollback(connection)
      if (isDuplicateEntry(error)) fail('AUTH_USERNAME_TAKEN', 'username already exists')
      throw error
    } finally {
      connection.release()
    }
  }
  async findUserByUsername(username: string): Promise<AuthCredentialRecord | undefined> {
    const [rows] = await this.pool.query<UserRoleRow[]>('SELECT u.id,u.username,u.password_hash,u.created_at,r.role_code FROM users u LEFT JOIN user_roles r ON r.user_id=u.id WHERE u.username=?', [username])
    if (rows.length === 0) return undefined
    const first = rows[0]!
    return { user: authUser(first, rows.map(row => row.role_code)), passwordHash: first.password_hash! }
  }
  async createSession(input: { id: string; userId: string; secretHash: Uint8Array; expiresAt: string; createdAt: string }): Promise<void> { await this.pool.query('INSERT INTO user_sessions(id,user_id,session_secret_hash,expires_at,revoked_at,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?)', [input.id,input.userId,Buffer.from(input.secretHash),new Date(input.expiresAt),new Date(input.createdAt),new Date(input.createdAt)]) }
  async getSessionBySecretHash(secretHash: Uint8Array, now: string): Promise<AuthUser | undefined> {
    const [rows] = await this.pool.query<UserRoleRow[]>('SELECT u.id,u.username,u.created_at,r.role_code FROM user_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_roles r ON r.user_id=u.id WHERE s.session_secret_hash=? AND s.revoked_at IS NULL AND s.expires_at>?', [Buffer.from(secretHash),new Date(now)])
    return rows.length === 0 ? undefined : authUser(rows[0]!, rows.map(row => row.role_code))
  }
  async revokeSessionBySecretHash(secretHash: Uint8Array, revokedAt: string): Promise<void> { await this.pool.query('UPDATE user_sessions SET revoked_at=?,updated_at=? WHERE session_secret_hash=? AND revoked_at IS NULL', [new Date(revokedAt),new Date(revokedAt),Buffer.from(secretHash)]) }
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
}

function authUser(row: UserRoleRow, values: Array<string | null>): AuthUser {
  const unique = new Set(values)
  if (unique.has(null) || !unique.has('member') || [...unique].some(role => !platformRoles.includes(role as PlatformRole))) throw new Error('auth-role-invariant-violated')
  const roles = platformRoles.filter(role => unique.has(role))
  if (roles.length === 0 || roles[0] !== 'member') throw new Error('auth-role-invariant-violated')
  return { id: row.id, username: row.username, roles, createdAt: new Date(row.created_at).toISOString() }
}

async function rollback(connection: PoolConnection): Promise<void> {
  try { await connection.rollback() } catch { /* Preserve the original write error. */ }
}
