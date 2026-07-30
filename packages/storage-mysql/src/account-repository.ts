import type { AuthRepository, AuthUser } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'

type UserRow = RowDataPacket & { id: string; username: string; password_hash: string; created_at: Date | string }
const user = (row: { id: string; username: string; created_at: Date | string }): AuthUser => ({ id: row.id, username: row.username, createdAt: new Date(row.created_at).toISOString() })
export class MySqlAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}
  async createUser(input: AuthUser & { passwordHash: string }): Promise<AuthUser> { await this.pool.query('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)', [input.id, input.username, input.passwordHash, new Date(input.createdAt)]); return { id: input.id, username: input.username, createdAt: input.createdAt } }
  async findUserByUsername(username: string): Promise<(AuthUser & { passwordHash: string }) | undefined> { const [rows] = await this.pool.query<UserRow[]>('SELECT id,username,password_hash,created_at FROM users WHERE username=?', [username]); const row = rows[0]; return row ? { ...user(row), passwordHash: row.password_hash } : undefined }
  async createSession(input: { id: string; userId: string; secretHash: Uint8Array; expiresAt: string; createdAt: string }): Promise<void> { await this.pool.query('INSERT INTO user_sessions(id,user_id,session_secret_hash,expires_at,revoked_at,created_at) VALUES (?,?,?,?,NULL,?)', [input.id,input.userId,Buffer.from(input.secretHash),new Date(input.expiresAt),new Date(input.createdAt)]) }
  async getSessionBySecretHash(secretHash: Uint8Array, now: string): Promise<AuthUser | undefined> { const [rows] = await this.pool.query<Array<RowDataPacket & { id: string; username: string; created_at: Date | string }>>('SELECT u.id,u.username,u.created_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_secret_hash=? AND s.revoked_at IS NULL AND s.expires_at>?', [Buffer.from(secretHash),new Date(now)]); return rows[0] ? user(rows[0]) : undefined }
  async revokeSessionBySecretHash(secretHash: Uint8Array, revokedAt: string): Promise<void> { await this.pool.query('UPDATE user_sessions SET revoked_at=? WHERE session_secret_hash=? AND revoked_at IS NULL', [new Date(revokedAt),Buffer.from(secretHash)]) }
}
