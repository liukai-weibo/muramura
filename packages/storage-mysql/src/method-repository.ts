import type {
  CreateMethodInput,
  Method,
  MethodEvidenceDetail,
  MethodEvidenceRelation,
  MethodRepository,
  MethodVersion,
  CurrentUserScope,
} from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { businessError, rethrowDuplicateAsBusinessError } from './errors'
import { runInMySqlTransaction } from './index'

type DateTime = string | Date

type MethodRow = RowDataPacket & {
  id: string; title: string; applicable: string; unsuitable: string; steps: string
  validation_count: number; version: number; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null
}
type VersionRow = RowDataPacket & {
  id: string; method_id: string; version: number; title: string; applicable: string; unsuitable: string; steps: string
  source_review_id: string | null; created_at: DateTime
}
type EvidenceDetailRow = RowDataPacket & {
  evidence_id: string; method_id: string; review_id: string; evidence_created_at: DateTime
  relation: MethodEvidenceRelation | null; method_version: number | null
  item_id: string | null; item_title: string | null; item_deleted_at: DateTime | null
  review_created_at: DateTime | null; actual_action: string | null; result: string | null
}

const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: DateTime) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mapMethod = (row: MethodRow): Method => ({
  id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps,
  validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
})
const mapVersion = (row: VersionRow): MethodVersion => ({
  id: row.id, methodId: row.method_id, version: row.version, title: row.title, applicable: row.applicable,
  unsuitable: row.unsuitable, steps: row.steps, createdAt: iso(row.created_at),
  ...(row.source_review_id ? { sourceReviewId: row.source_review_id } : {}),
})

function normalizeInput(input: CreateMethodInput) {
  const normalized = {
    title: input.title.trim(), applicable: input.applicable.trim(), unsuitable: input.unsuitable?.trim() ?? '', steps: input.steps.trim(),
  }
  if (!normalized.title || !normalized.applicable || !normalized.steps) {
    throw businessError(
      'METHOD_REQUIRED_FIELDS_MISSING',
      'validation',
      '请完成方法标题、适用情况和具体步骤',
    )
  }
  return normalized
}

export interface MySqlMethodRepositoryTestHooks {
  beforeWrite?: (step: 'create-version' | 'create-evidence' | 'validate-version' | 'validate-evidence' | 'purge-delete-method') => Promise<void> | void
}

export class MySqlMethodRepository implements MethodRepository {
  constructor(private readonly pool: Pool, private readonly testHooks?: MySqlMethodRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}

  async createFromReview(input: CreateMethodInput, reviewId: string): Promise<Method> {
    const data = normalizeInput(input)
    return runInMySqlTransaction(this.pool, async connection => {
      await this.lockReview(connection, reviewId)
      const now = new Date().toISOString()
      const method: Method = { id: createId(), ...data, validationCount: 1, version: 1, createdAt: now, updatedAt: now }
      await connection.execute(
        this.scope ? 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        this.scope ? [method.id, method.title, method.applicable, method.unsuitable, method.steps, 1, 1, mysqlDateTime(now), mysqlDateTime(now), this.scope.userId] : [method.id, method.title, method.applicable, method.unsuitable, method.steps, 1, 1, mysqlDateTime(now), mysqlDateTime(now)],
      )
      await this.testHooks?.beforeWrite?.('create-version')
      await connection.execute(
        this.scope ? 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        this.scope ? [createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, reviewId, mysqlDateTime(now), this.scope.userId] : [createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, reviewId, mysqlDateTime(now)],
      )
      await this.testHooks?.beforeWrite?.('create-evidence')
      await connection.execute(
        this.scope ? 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,?,?,?)',
        this.scope ? [createId(), method.id, reviewId, 'formation', 1, mysqlDateTime(now), this.scope.userId] : [createId(), method.id, reviewId, 'formation', 1, mysqlDateTime(now)],
      )
      return method
    })
  }

  async list(): Promise<Method[]> {
    const [rows] = await this.pool.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE deleted_at IS NULL AND owner_user_id=? ORDER BY updated_at ASC,id ASC' : 'SELECT * FROM methods WHERE deleted_at IS NULL ORDER BY updated_at ASC,id ASC', this.scope ? [this.scope.userId] : [])
    return rows.map(mapMethod)
  }

  async listDeleted(): Promise<Method[]> {
    const [rows] = await this.pool.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE deleted_at IS NOT NULL AND owner_user_id=? ORDER BY deleted_at ASC,id ASC' : 'SELECT * FROM methods WHERE deleted_at IS NOT NULL ORDER BY deleted_at ASC,id ASC', this.scope ? [this.scope.userId] : [])
    return rows.map(mapMethod)
  }

  async listByReviewId(reviewId: string): Promise<Method[]> {
    if (this.scope) {
      const [reviews] = await this.pool.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM reviews WHERE id=? AND owner_user_id=?', [reviewId, this.scope.userId])
      if (!reviews[0]) throw new Error('复盘不存在')
    }
    const [rows] = await this.pool.query<MethodRow[]>(
      this.scope ? `SELECT DISTINCT m.* FROM methods m INNER JOIN method_evidence e ON e.method_id=m.id WHERE e.review_id=? AND m.deleted_at IS NULL AND m.owner_user_id=? AND e.owner_user_id=? ORDER BY m.updated_at ASC,m.id ASC` : `SELECT DISTINCT m.* FROM methods m INNER JOIN method_evidence e ON e.method_id=m.id WHERE e.review_id=? AND m.deleted_at IS NULL ORDER BY m.updated_at ASC,m.id ASC`, this.scope ? [reviewId,this.scope.userId,this.scope.userId] : [reviewId],
    )
    return rows.map(mapMethod)
  }

  async listVersions(methodId: string): Promise<MethodVersion[]> {
    if (this.scope && !(await this.ownsMethod(methodId))) throw new Error('方法不存在')
    const [rows] = await this.pool.query<VersionRow[]>(this.scope ? 'SELECT * FROM method_versions WHERE method_id=? AND owner_user_id=? ORDER BY version ASC,id ASC' : 'SELECT * FROM method_versions WHERE method_id=? ORDER BY version ASC,id ASC', this.scope ? [methodId,this.scope.userId] : [methodId])
    return rows.map(mapVersion)
  }

  async listEvidenceDetails(methodId: string): Promise<MethodEvidenceDetail[]> {
    if (this.scope && !(await this.ownsMethod(methodId))) throw new Error('方法不存在')
    const [rows] = await this.pool.query<EvidenceDetailRow[]>(
      `SELECT e.id AS evidence_id,e.method_id,e.review_id,e.created_at AS evidence_created_at,e.relation,e.method_version,
              r.item_id,r.created_at AS review_created_at,r.actual_action,r.result,i.title AS item_title,i.deleted_at AS item_deleted_at
       FROM method_evidence e
       LEFT JOIN reviews r ON r.id=e.review_id${this.scope ? ' AND r.owner_user_id=e.owner_user_id' : ''}
       LEFT JOIN items i ON i.id=r.item_id${this.scope ? ' AND i.owner_user_id=e.owner_user_id' : ''}
       WHERE e.method_id=?${this.scope ? ' AND e.owner_user_id=?' : ''} ORDER BY r.created_at DESC, e.created_at DESC, e.id ASC`, this.scope ? [methodId, this.scope.userId] : [methodId],
    )
    return rows.map(row => {
      const reviewExists = Boolean(row.review_created_at)
      const itemExists = Boolean(row.item_id && row.item_title && !row.item_deleted_at)
      const reviewSummary = reviewExists
        ? [row.actual_action, row.result].filter(Boolean).join(' · ') || '复盘内容为空'
        : '关联复盘已不存在'
      return {
        evidenceId: row.evidence_id, methodId: row.method_id, reviewId: row.review_id,
        itemId: row.item_id ?? '', itemTitle: itemExists ? row.item_title! : '关联事项已不存在',
        reviewCreatedAt: reviewExists ? iso(row.review_created_at!) : iso(row.evidence_created_at),
        reviewSummary, relation: row.relation ?? 'unknown',
        ...(row.method_version !== null ? { methodVersion: row.method_version } : {}),
      }
    })
  }

  async moveToTrash(methodId: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const method = await this.lockMethod(connection, methodId)
      if (!method) throw businessError('METHOD_NOT_FOUND', 'not-found', '方法不存在')
      if (method.deleted_at) {
        throw businessError('METHOD_ALREADY_IN_TRASH', 'conflict', '方法已在回收站')
      }
      const now = new Date().toISOString()
      await connection.execute(this.scope ? 'UPDATE methods SET deleted_at=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE methods SET deleted_at=?,updated_at=? WHERE id=?', this.scope ? [mysqlDateTime(now), mysqlDateTime(now), methodId,this.scope.userId] : [mysqlDateTime(now), mysqlDateTime(now), methodId])
    })
  }

  async restore(methodId: string): Promise<Method> {
    return runInMySqlTransaction(this.pool, async connection => {
      const method = await this.lockMethod(connection, methodId)
      if (!method?.deleted_at) {
        throw businessError('METHOD_NOT_IN_TRASH', 'not-found', '回收站中不存在该方法')
      }
      const now = new Date().toISOString()
      await connection.execute(this.scope ? 'UPDATE methods SET deleted_at=NULL,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE methods SET deleted_at=NULL,updated_at=? WHERE id=?', this.scope ? [mysqlDateTime(now), methodId,this.scope.userId] : [mysqlDateTime(now), methodId])
      return { ...mapMethod(method), updatedAt: now, deletedAt: undefined }
    })
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const [methods] = await connection.query<MethodRow[]>(
        this.scope ? 'SELECT * FROM methods WHERE deleted_at IS NOT NULL AND deleted_at<=? AND owner_user_id=? ORDER BY id ASC FOR UPDATE' : 'SELECT * FROM methods WHERE deleted_at IS NOT NULL AND deleted_at<=? ORDER BY id ASC FOR UPDATE', this.scope ? [mysqlDateTime(cutoff), this.scope.userId] : [mysqlDateTime(cutoff)],
      )
      for (const method of methods) {
        const [versions] = await connection.query<VersionRow[]>(this.scope ? 'SELECT * FROM method_versions WHERE method_id=? AND owner_user_id=? ORDER BY version ASC,id ASC FOR UPDATE' : 'SELECT * FROM method_versions WHERE method_id=? ORDER BY version ASC,id ASC FOR UPDATE', this.scope ? [method.id, this.scope.userId] : [method.id])
        await connection.query(this.scope ? 'SELECT id FROM method_evidence WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM method_evidence WHERE method_id=? FOR UPDATE', this.scope ? [method.id, this.scope.userId] : [method.id])
        const [applications] = await connection.query<Array<RowDataPacket & { method_version: number }>>(this.scope ? 'SELECT method_version FROM method_applications WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT method_version FROM method_applications WHERE method_id=? FOR UPDATE', this.scope ? [method.id, this.scope.userId] : [method.id])
        const [tombstones] = await connection.query<Array<RowDataPacket & { method_id: string }>>(this.scope ? 'SELECT method_id FROM method_tombstones WHERE method_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT method_id FROM method_tombstones WHERE method_id=? FOR UPDATE', this.scope ? [method.id, this.scope.userId] : [method.id])
        if (tombstones[0]) {
          throw businessError(
            'METHOD_TOMBSTONE_ALREADY_EXISTS',
            'conflict',
            '方法永久清理记录已存在',
          )
        }
        const versionNumbers = versions.map(version => ({ version: version.version }))
        if (applications.some(application => !versionNumbers.some(version => version.version === application.method_version))) {
          throw businessError(
            'METHOD_VERSION_HISTORY_UNPROVABLE',
            'internal',
            '方法应用引用了无法证明的历史版本',
          )
        }
        const permanentlyDeletedAt = new Date().toISOString()
        await connection.execute(this.scope ? 'INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions,owner_user_id) VALUES(?,?,?,?,?)' : 'INSERT INTO method_tombstones(method_id,title,permanently_deleted_at,versions) VALUES(?,?,?,?)', this.scope ? [method.id, method.title, mysqlDateTime(permanentlyDeletedAt), JSON.stringify(versionNumbers), this.scope.userId] : [method.id, method.title, mysqlDateTime(permanentlyDeletedAt), JSON.stringify(versionNumbers)])
        await connection.execute(this.scope ? 'DELETE FROM method_versions WHERE method_id=? AND owner_user_id=?' : 'DELETE FROM method_versions WHERE method_id=?', this.scope ? [method.id, this.scope.userId] : [method.id])
        await this.testHooks?.beforeWrite?.('purge-delete-method')
        await connection.execute(this.scope ? 'DELETE FROM methods WHERE id=? AND owner_user_id=?' : 'DELETE FROM methods WHERE id=?', this.scope ? [method.id, this.scope.userId] : [method.id])
      }
    })
  }

  async validateFromReview(methodId: string, reviewId: string, revision?: CreateMethodInput): Promise<Method> {
    const revisionData = revision ? normalizeInput(revision) : undefined
    return runInMySqlTransaction(this.pool, async connection => {
      const methodRow = await this.lockMethod(connection, methodId)
      if (!methodRow || methodRow.deleted_at) {
        throw businessError('METHOD_NOT_FOUND', 'not-found', '选择的方法不存在')
      }
      await this.lockReview(connection, reviewId)
      const [existing] = await connection.query<Array<RowDataPacket & { id: string }>>(
        this.scope ? 'SELECT id FROM method_evidence WHERE method_id=? AND review_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM method_evidence WHERE method_id=? AND review_id=? FOR UPDATE', this.scope ? [methodId, reviewId, this.scope.userId] : [methodId, reviewId],
      )
      if (existing[0]) {
        throw businessError(
          'METHOD_ALREADY_VALIDATED_BY_REVIEW',
          'conflict',
          '该复盘已经验证过这个方法',
        )
      }
      const method = mapMethod(methodRow)
      const now = new Date().toISOString()
      const nextVersion = revisionData ? method.version + 1 : method.version
      const updated: Method = revisionData
        ? { ...method, ...revisionData, validationCount: method.validationCount + 1, version: nextVersion, updatedAt: now }
        : { ...method, validationCount: method.validationCount + 1, updatedAt: now }
      await connection.execute(
        this.scope ? 'UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=?',
        this.scope ? [updated.title, updated.applicable, updated.unsuitable, updated.steps, updated.validationCount, updated.version, mysqlDateTime(now), methodId, this.scope.userId] : [updated.title, updated.applicable, updated.unsuitable, updated.steps, updated.validationCount, updated.version, mysqlDateTime(now), methodId],
      )
      if (revisionData) {
        await this.testHooks?.beforeWrite?.('validate-version')
        await connection.execute(
          this.scope ? 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          this.scope ? [createId(), methodId, nextVersion, updated.title, updated.applicable, updated.unsuitable, updated.steps, reviewId, mysqlDateTime(now), this.scope.userId] : [createId(), methodId, nextVersion, updated.title, updated.applicable, updated.unsuitable, updated.steps, reviewId, mysqlDateTime(now)],
        )
      }
      await this.testHooks?.beforeWrite?.('validate-evidence')
      try {
        await connection.execute(
          this.scope ? 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,?,?,?)',
          this.scope ? [createId(), methodId, reviewId, revisionData ? 'revision' : 'validation', nextVersion, mysqlDateTime(now), this.scope.userId] : [createId(), methodId, reviewId, revisionData ? 'revision' : 'validation', nextVersion, mysqlDateTime(now)],
        )
      } catch (error) {
        rethrowDuplicateAsBusinessError(
          error,
          'METHOD_ALREADY_VALIDATED_BY_REVIEW',
          '该复盘已经验证过这个方法',
        )
      }
      return updated
    })
  }

  private async lockReview(connection: PoolConnection, reviewId: string): Promise<void> {
    const [reviews] = await connection.query<Array<RowDataPacket & { id: string }>>(this.scope ? 'SELECT id FROM reviews WHERE id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM reviews WHERE id=? FOR UPDATE', this.scope ? [reviewId,this.scope.userId] : [reviewId])
    if (!reviews[0]) throw businessError('REVIEW_NOT_FOUND', 'not-found', '关联复盘不存在')
  }

  private async lockMethod(connection: PoolConnection, methodId: string): Promise<MethodRow | undefined> {
    const [methods] = await connection.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE id=? AND owner_user_id=? FOR UPDATE' : 'SELECT * FROM methods WHERE id=? FOR UPDATE', this.scope ? [methodId,this.scope.userId] : [methodId])
    return methods[0]
  }

  private async ownsMethod(methodId: string): Promise<boolean> {
    const [methods] = await this.pool.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM methods WHERE id=? AND owner_user_id=?', [methodId, this.scope!.userId])
    return Boolean(methods[0])
  }
}
