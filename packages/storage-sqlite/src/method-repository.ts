import type { CreateMethodInput, Method, MethodEvidence, MethodEvidenceDetail, MethodEvidenceRelation, MethodRepository, MethodTombstone, MethodVersion, Review } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const now = () => new Date().toISOString()
const optional = (value: unknown) => value == null ? undefined : String(value)
const mapMethod = (row: Row): Method => ({ id: String(row.id), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), validationCount: Number(row.validation_count), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(optional(row.deleted_at) ? { deletedAt: optional(row.deleted_at) } : {}) })
const mapVersion = (row: Row): MethodVersion => ({ id: String(row.id), methodId: String(row.method_id), version: Number(row.version), title: String(row.title), applicable: String(row.applicable), unsuitable: String(row.unsuitable), steps: String(row.steps), ...(optional(row.source_review_id) ? { sourceReviewId: optional(row.source_review_id) } : {}), createdAt: String(row.created_at) })
const mapEvidence = (row: Row): MethodEvidence => ({ id: String(row.id), methodId: String(row.method_id), reviewId: String(row.review_id), createdAt: String(row.created_at), ...(optional(row.relation) ? { relation: row.relation as MethodEvidenceRelation } : {}), ...(row.method_version == null ? {} : { methodVersion: Number(row.method_version) }) })
const mapTombstone = (row: Row): MethodTombstone => ({ methodId: String(row.method_id), title: String(row.title), permanentlyDeletedAt: String(row.permanently_deleted_at), versions: JSON.parse(String(row.versions_json)) })

function normalized(input: CreateMethodInput) {
  const value = { title: input.title.trim(), applicable: input.applicable.trim(), unsuitable: input.unsuitable?.trim() ?? '', steps: input.steps.trim() }
  if (!value.title || !value.applicable || !value.steps) throw new Error('请完成方法标题、适用情况和具体步骤')
  return value
}

export class SqliteMethodRepository implements MethodRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }

  async createFromReview(input: CreateMethodInput, reviewId: string): Promise<Method> {
    const value = normalized(input)
    const createdAt = now()
    const method: Method = { id: createId(), ...value, validationCount: 1, version: 1, createdAt, updatedAt: createdAt }
    this.database.runInTransaction(() => {
      if (!this.raw.prepare('SELECT 1 FROM reviews WHERE id=?').get(reviewId)) throw new Error('关联复盘不存在')
      this.raw.prepare('INSERT INTO methods VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(method.id, method.title, method.applicable, method.unsuitable, method.steps, 1, 1, createdAt, createdAt)
      this.raw.prepare('INSERT INTO method_versions VALUES(?,?,?,?,?,?,?,?,?)').run(createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, reviewId, createdAt)
      this.raw.prepare('INSERT INTO method_evidence VALUES(?,?,?,?,?,?)').run(createId(), method.id, reviewId, createdAt, 'formation', 1)
    })
    return method
  }

  async list(): Promise<Method[]> { return (this.raw.prepare('SELECT * FROM methods WHERE deleted_at IS NULL ORDER BY updated_at').all() as Row[]).map(mapMethod) }
  async listDeleted(): Promise<Method[]> { return (this.raw.prepare('SELECT * FROM methods WHERE deleted_at IS NOT NULL ORDER BY deleted_at').all() as Row[]).map(mapMethod) }
  async listVersions(methodId: string): Promise<MethodVersion[]> { return (this.raw.prepare('SELECT * FROM method_versions WHERE method_id=? ORDER BY version').all(methodId) as Row[]).map(mapVersion) }

  async moveToTrash(methodId: string): Promise<void> {
    this.database.runInTransaction(() => {
      const row = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(methodId) as Row | undefined
      if (!row) throw new Error('方法不存在')
      if (row.deleted_at != null) throw new Error('方法已在回收站')
      const timestamp = now()
      this.raw.prepare('UPDATE methods SET deleted_at=?, updated_at=? WHERE id=?').run(timestamp, timestamp, methodId)
    })
  }

  async restore(methodId: string): Promise<Method> {
    return this.database.runInTransaction(() => {
      const row = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(methodId) as Row | undefined
      if (!row || row.deleted_at == null) throw new Error('回收站中不存在该方法')
      const updatedAt = now()
      this.raw.prepare('UPDATE methods SET deleted_at=NULL, updated_at=? WHERE id=?').run(updatedAt, methodId)
      const method = mapMethod(row)
      delete method.deletedAt
      return { ...method, updatedAt }
    })
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    this.database.runInTransaction(() => {
      const expired = this.raw.prepare('SELECT * FROM methods WHERE deleted_at IS NOT NULL AND deleted_at<=?').all(cutoff) as Row[]
      for (const row of expired) {
        const method = mapMethod(row)
        const versions = (this.raw.prepare('SELECT * FROM method_versions WHERE method_id=? ORDER BY version').all(method.id) as Row[]).map(mapVersion)
        const applications = this.raw.prepare('SELECT method_version FROM method_applications WHERE method_id=?').all(method.id) as Row[]
        if (applications.some(application => !versions.some(version => version.version === Number(application.method_version)))) throw new Error('方法应用引用了无法证明的历史版本')
        if (this.raw.prepare('SELECT 1 FROM method_tombstones WHERE method_id=?').get(method.id)) throw new Error('方法墓碑已存在')
        this.raw.prepare('INSERT INTO method_tombstones VALUES(?,?,?,?)').run(method.id, method.title, now(), JSON.stringify(versions.map(({ version }) => ({ version }))))
        this.raw.prepare('DELETE FROM method_versions WHERE method_id=?').run(method.id)
        this.raw.prepare('DELETE FROM methods WHERE id=?').run(method.id)
      }
    })
  }

  async listByReviewId(reviewId: string): Promise<Method[]> {
    return this.database.runInReadTransaction(() => {
      const rows = this.raw.prepare(`SELECT m.* FROM methods m JOIN method_evidence e ON e.method_id=m.id WHERE e.review_id=? AND m.deleted_at IS NULL`).all(reviewId) as Row[]
      return rows.map(mapMethod)
    })
  }

  async listEvidenceDetails(methodId: string): Promise<MethodEvidenceDetail[]> {
    return this.database.runInReadTransaction(() => {
      const evidence = (this.raw.prepare('SELECT * FROM method_evidence WHERE method_id=?').all(methodId) as Row[]).map(mapEvidence)
      return evidence.map(entry => {
        const reviewRow = this.raw.prepare('SELECT * FROM reviews WHERE id=?').get(entry.reviewId) as Row | undefined
        const review = reviewRow ? { id: String(reviewRow.id), itemId: String(reviewRow.item_id), actualAction: String(reviewRow.actual_action), result: String(reviewRow.result), createdAt: String(reviewRow.created_at) } : undefined
        const item = review ? this.raw.prepare('SELECT * FROM items WHERE id=? AND deleted_at IS NULL').get(review.itemId) as Row | undefined : undefined
        return { evidenceId: entry.id, methodId: entry.methodId, reviewId: entry.reviewId, itemId: review?.itemId ?? '', itemTitle: item ? String(item.title) : '关联事项已不存在', reviewCreatedAt: review?.createdAt ?? entry.createdAt, reviewSummary: review ? [review.actualAction, review.result].filter(Boolean).join(' · ') || '复盘内容为空' : '关联复盘已不存在', relation: entry.relation ?? 'unknown', ...(entry.methodVersion === undefined ? {} : { methodVersion: entry.methodVersion }) }
      }).sort((left, right) => right.reviewCreatedAt.localeCompare(left.reviewCreatedAt))
    })
  }

  async validateFromReview(methodId: string, reviewId: string, revision?: CreateMethodInput): Promise<Method> {
    return this.database.runInTransaction(() => {
      if (!this.raw.prepare('SELECT 1 FROM reviews WHERE id=?').get(reviewId)) throw new Error('关联复盘不存在')
      const methodRow = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(methodId) as Row | undefined
      if (!methodRow || methodRow.deleted_at != null) throw new Error('选择的方法不存在')
      if (this.raw.prepare('SELECT 1 FROM method_evidence WHERE method_id=? AND review_id=?').get(methodId, reviewId)) throw new Error('该复盘已经验证过这个方法')
      const current = mapMethod(methodRow)
      const updatedAt = now()
      const revisionValue = revision ? normalized(revision) : undefined
      const version = revisionValue ? current.version + 1 : current.version
      const updated: Method = revisionValue ? { ...current, ...revisionValue, validationCount: current.validationCount + 1, version, updatedAt } : { ...current, validationCount: current.validationCount + 1, updatedAt }
      this.raw.prepare('UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=?').run(updated.title, updated.applicable, updated.unsuitable, updated.steps, updated.validationCount, updated.version, updated.updatedAt, methodId)
      this.raw.prepare('INSERT INTO method_evidence VALUES(?,?,?,?,?,?)').run(createId(), methodId, reviewId, updatedAt, revisionValue ? 'revision' : 'validation', version)
      if (revisionValue) this.raw.prepare('INSERT INTO method_versions VALUES(?,?,?,?,?,?,?,?,?)').run(createId(), methodId, version, updated.title, updated.applicable, updated.unsuitable, updated.steps, reviewId, updatedAt)
      return updated
    })
  }
}
