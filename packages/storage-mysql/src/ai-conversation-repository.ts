import crypto from 'node:crypto'
import type { AiConversation, AiConversationBackupStore, AiConversationMessage, AiConversationMessageStatus, AiConversationRepository, AiConversationSnapshot, AiConversationSummary, CurrentUserScope } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type ConversationRow = RowDataPacket & { id: string; owner_user_id: string; title: string; created_at: string | Date; updated_at: string | Date; archived_at: string | Date | null; deleted_at: string | Date | null; summary_content: string | null; summary_version: number | null; summary_through_sequence: number | null; summary_updated_at: string | Date | null }
type MessageRow = RowDataPacket & { id: string; conversation_id: string; owner_user_id: string; sequence_no: number; role_code: 'user' | 'assistant'; status_code: AiConversationMessageStatus; content: string; created_at: string | Date }
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const sqlDate = (value: string) => value.replace('T', ' ').replace('Z', '')
const mapConversation = (row: ConversationRow): AiConversation => ({ id: row.id, title: row.title, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }), ...(row.deleted_at === null ? {} : { deletedAt: iso(row.deleted_at) }), ...(row.summary_content !== null && row.summary_version !== null && row.summary_through_sequence !== null && row.summary_updated_at !== null ? { summary: { content: row.summary_content, version: Number(row.summary_version), throughSequence: Number(row.summary_through_sequence), updatedAt: iso(row.summary_updated_at) } } : {}) })
const mapMessage = (row: MessageRow): AiConversationMessage => ({ id: row.id, conversationId: row.conversation_id, sequence: Number(row.sequence_no), role: row.role_code, status: row.status_code, content: row.content, createdAt: iso(row.created_at) })

export class MySqlAiConversationRepository implements AiConversationRepository, AiConversationBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async getOrCreateDefault(): Promise<AiConversation> {
    const existing = await this.getDefault()
    if (existing) return existing
    return this.createConversation('默认会话')
  }

  async getDefault(): Promise<AiConversation | undefined> {
    const [rows] = await this.pool.query<ConversationRow[]>('SELECT * FROM ai_conversations WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY archived_at IS NOT NULL ASC, updated_at DESC, id ASC LIMIT 1', [this.scope.userId])
    return rows[0] ? mapConversation(rows[0]) : undefined
  }

  async listConversations(includeDeleted = false): Promise<AiConversation[]> {
    const [rows] = await this.pool.query<ConversationRow[]>(`SELECT * FROM ai_conversations WHERE owner_user_id=?${includeDeleted ? '' : ' AND deleted_at IS NULL'} ORDER BY ${includeDeleted ? 'deleted_at IS NULL DESC,' : ''} archived_at IS NOT NULL ASC, updated_at DESC, id ASC`, [this.scope.userId])
    return rows.map(mapConversation)
  }

  async createConversation(title: string): Promise<AiConversation> {
    const now = new Date().toISOString(); const id = crypto.randomUUID(); const normalized = title.trim().slice(0, 160) || '新会话'
    await this.pool.execute('INSERT INTO ai_conversations(id,owner_user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)', [id, this.scope.userId, normalized, sqlDate(now), sqlDate(now)])
    return { id, title: normalized, createdAt: now, updatedAt: now }
  }

  async getConversation(id: string, includeDeleted = false): Promise<AiConversation | undefined> {
    const [rows] = await this.pool.query<ConversationRow[]>(`SELECT * FROM ai_conversations WHERE id=? AND owner_user_id=?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`, [id, this.scope.userId])
    return rows[0] ? mapConversation(rows[0]) : undefined
  }

  private async updateLifecycle(id: string, action: 'archive' | 'restore' | 'delete'): Promise<AiConversation | undefined> {
    const now = sqlDate(new Date().toISOString())
    const update = action === 'archive' ? 'archived_at=?,updated_at=?' : action === 'restore' ? 'archived_at=NULL,deleted_at=NULL,updated_at=?' : action === 'delete' ? 'deleted_at=?,updated_at=?' : 'updated_at=?'
    const values = action === 'archive' || action === 'delete' ? [now, now, id, this.scope.userId] : [now, id, this.scope.userId]
    const predicate = action === 'restore' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'
    await this.pool.execute(`UPDATE ai_conversations SET ${update} WHERE id=? AND owner_user_id=? AND ${predicate}`, values)
    return this.getConversation(id, true)
  }

  async updateConversationTitle(id: string, title: string): Promise<AiConversation | undefined> {
    const normalized = title.trim().slice(0, 160)
    if (!normalized) return undefined
    await this.pool.execute('UPDATE ai_conversations SET title=?,updated_at=? WHERE id=? AND owner_user_id=? AND deleted_at IS NULL', [normalized, sqlDate(new Date().toISOString()), id, this.scope.userId])
    return this.getConversation(id, true)
  }
  archiveConversation(id: string) { return this.updateLifecycle(id, 'archive') }
  restoreConversation(id: string) { return this.updateLifecycle(id, 'restore') }
  deleteConversation(id: string) { return this.updateLifecycle(id, 'delete') }
  async purgeConversation(id: string): Promise<boolean> { const [result] = await this.pool.execute('DELETE FROM ai_conversations WHERE id=? AND owner_user_id=? AND deleted_at IS NOT NULL', [id, this.scope.userId]); return Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1 }

  async listMessages(conversationId: string): Promise<AiConversationMessage[]> {
    const [rows] = await this.pool.query<MessageRow[]>('SELECT m.* FROM ai_conversation_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=? AND m.owner_user_id=? AND c.owner_user_id=? ORDER BY m.sequence_no ASC', [conversationId, this.scope.userId, this.scope.userId])
    return rows.map(mapMessage)
  }

  async listMessagesPage(conversationId: string, input: { limit: number; beforeSequence?: number }): Promise<{ messages: AiConversationMessage[]; hasMoreBefore: boolean }> {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)))
    const beforeClause = input.beforeSequence === undefined ? '' : ' AND m.sequence_no<?'
    const params = input.beforeSequence === undefined
      ? [conversationId, this.scope.userId, this.scope.userId, limit + 1]
      : [conversationId, this.scope.userId, this.scope.userId, input.beforeSequence, limit + 1]
    const [rows] = await this.pool.query<MessageRow[]>(`SELECT m.* FROM ai_conversation_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=? AND m.owner_user_id=? AND c.owner_user_id=?${beforeClause} ORDER BY m.sequence_no DESC LIMIT ?`, params)
    const hasMoreBefore = rows.length > limit
    return { messages: rows.slice(0, limit).reverse().map(mapMessage), hasMoreBefore }
  }

  async appendMessage(input: { conversationId: string; role: 'user' | 'assistant'; status: AiConversationMessageStatus; content: string; createdAt?: string }): Promise<AiConversationMessage> {
    const createdAt = input.createdAt ?? new Date().toISOString()
    return runInMySqlTransaction(this.pool, async connection => {
      const [conversations] = await connection.query<ConversationRow[]>('SELECT * FROM ai_conversations WHERE id=? AND owner_user_id=? FOR UPDATE', [input.conversationId, this.scope.userId])
      if (!conversations[0]) throw new Error('AI conversation not found')
      const [lastRows] = await connection.query<Array<RowDataPacket & { sequence_no: number }>>('SELECT sequence_no FROM ai_conversation_messages WHERE conversation_id=? ORDER BY sequence_no DESC LIMIT 1', [input.conversationId])
      const sequence = Number(lastRows[0]?.sequence_no ?? 0) + 1
      const id = crypto.randomUUID()
      await connection.execute('INSERT INTO ai_conversation_messages(id,conversation_id,owner_user_id,sequence_no,role_code,status_code,content,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, input.conversationId, this.scope.userId, sequence, input.role, input.status, input.content, sqlDate(createdAt)])
      await connection.execute('UPDATE ai_conversations SET updated_at=? WHERE id=? AND owner_user_id=?', [sqlDate(createdAt), input.conversationId, this.scope.userId])
      return { id, conversationId: input.conversationId, sequence, role: input.role, status: input.status, content: input.content, createdAt }
    })
  }

  async updateSummary(conversationId: string, summary: AiConversationSummary): Promise<void> {
    await this.pool.execute('UPDATE ai_conversations SET summary_content=?, summary_version=?, summary_through_sequence=?, summary_updated_at=?, updated_at=? WHERE id=? AND owner_user_id=?', [summary.content, summary.version, summary.throughSequence, sqlDate(summary.updatedAt), sqlDate(summary.updatedAt), conversationId, this.scope.userId])
  }

  async exportBackup(): Promise<AiConversationSnapshot[]> {
    return Promise.all((await this.listConversations(true)).map(async (entry) => ({ conversation: entry, messages: await this.listMessages(entry.id) })))
  }

  async replaceBackup(values: AiConversationSnapshot[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM ai_conversations WHERE owner_user_id=?', [this.scope.userId])
      for (const value of values) {
        await connection.execute('INSERT INTO ai_conversations(id,owner_user_id,title,created_at,updated_at,archived_at,deleted_at,summary_content,summary_version,summary_through_sequence,summary_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [value.conversation.id, this.scope.userId, value.conversation.title || '默认会话', sqlDate(value.conversation.createdAt), sqlDate(value.conversation.updatedAt), value.conversation.archivedAt ? sqlDate(value.conversation.archivedAt) : null, value.conversation.deletedAt ? sqlDate(value.conversation.deletedAt) : null, value.conversation.summary?.content ?? null, value.conversation.summary?.version ?? null, value.conversation.summary?.throughSequence ?? null, value.conversation.summary ? sqlDate(value.conversation.summary.updatedAt) : null])
        for (const message of value.messages) {
          await connection.execute('INSERT INTO ai_conversation_messages(id,conversation_id,owner_user_id,sequence_no,role_code,status_code,content,created_at) VALUES(?,?,?,?,?,?,?,?)', [message.id, value.conversation.id, this.scope.userId, message.sequence, message.role, message.status, message.content, sqlDate(message.createdAt)])
        }
      }
    })
  }
}
