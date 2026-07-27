import type { CompleteReviewInput, CompleteReviewResult, Item, Method, ReviewWorkflowRepository } from '@knowledge-base/contracts'
import { assertTransition, createId } from '@knowledge-base/domain'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const now = () => new Date().toISOString()
const mapItem = (row: Row): Item => ({ id: String(row.id), title: String(row.title), content: String(row.content), status: row.status as Item['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.deleted_at == null ? {} : { deletedAt: String(row.deleted_at) }), ...(row.start_action == null ? {} : { startAction: String(row.start_action) }) })

const validateMethod = (input: NonNullable<CompleteReviewInput['method']>) => {
  const value = { title: input.title.trim(), applicable: input.applicable.trim(), unsuitable: input.unsuitable?.trim() ?? '', steps: input.steps.trim() }
  if (!value.title || !value.applicable || !value.steps) throw new Error('请完成方法标题、适用情况和具体步骤')
  return value
}

export class SqliteReviewWorkflowRepository implements ReviewWorkflowRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }

  async complete(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    return this.database.runInTransaction(() => {
      const itemRow = this.raw.prepare('SELECT * FROM items WHERE id=?').get(input.itemId) as Row | undefined
      if (!itemRow || itemRow.deleted_at != null) throw new Error('事项不存在')
      const item = mapItem(itemRow)
      if (item.status !== 'doing' && item.status !== 'waiting_review') throw new Error('只有已开始或待复盘事项可以完成复盘')
      if (this.raw.prepare('SELECT 1 FROM reviews WHERE item_id=?').get(item.id)) throw new Error('该事项已经完成复盘')
      if (input.method && input.existingMethod) throw new Error('不能同时形成新方法和验证已有方法')

      const timestamp = now()
      const review = {
        id: createId(), itemId: item.id, actualAction: input.actualAction.trim(), result: input.result.trim(), effective: input.effective.trim(), incompatible: input.incompatible.trim(), reason: input.reason.trim(), adjustment: input.adjustment.trim(), newIdeas: input.newIdeas?.trim() ?? '', createdAt: timestamp, updatedAt: timestamp,
      }
      const missing = [['实际行动', review.actualAction], ['结果', review.result]].filter(([, value]) => !value).map(([label]) => label)
      if (missing.length) throw new Error(`请填写：${missing.join('、')}`)
      this.raw.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(review.id, review.itemId, review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas, timestamp, timestamp)

      let method: Method | undefined
      if (input.method) {
        const value = validateMethod(input.method)
        method = { id: createId(), ...value, validationCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp }
        this.raw.prepare('INSERT INTO methods VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(method.id, method.title, method.applicable, method.unsuitable, method.steps, 1, 1, timestamp, timestamp)
        this.raw.prepare('INSERT INTO method_versions VALUES(?,?,?,?,?,?,?,?,?)').run(createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, review.id, timestamp)
        this.raw.prepare('INSERT INTO method_evidence VALUES(?,?,?,?,?,?)').run(createId(), method.id, review.id, timestamp, 'formation', 1)
      } else if (input.existingMethod) {
        const methodRow = this.raw.prepare('SELECT * FROM methods WHERE id=?').get(input.existingMethod.methodId) as Row | undefined
        if (!methodRow || methodRow.deleted_at != null) throw new Error('选择的方法不存在')
        if (this.raw.prepare('SELECT 1 FROM method_evidence WHERE method_id=? AND review_id=?').get(input.existingMethod.methodId, review.id)) throw new Error('该复盘已经验证过这个方法')
        const current = { id: String(methodRow.id), title: String(methodRow.title), applicable: String(methodRow.applicable), unsuitable: String(methodRow.unsuitable), steps: String(methodRow.steps), validationCount: Number(methodRow.validation_count), version: Number(methodRow.version), createdAt: String(methodRow.created_at), updatedAt: String(methodRow.updated_at) }
        const revision = input.existingMethod.revision ? validateMethod(input.existingMethod.revision) : undefined
        const version = revision ? current.version + 1 : current.version
        method = revision ? { ...current, ...revision, validationCount: current.validationCount + 1, version, updatedAt: timestamp } : { ...current, validationCount: current.validationCount + 1, updatedAt: timestamp }
        this.raw.prepare('UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=?').run(method.title, method.applicable, method.unsuitable, method.steps, method.validationCount, method.version, timestamp, method.id)
        this.raw.prepare('INSERT INTO method_evidence VALUES(?,?,?,?,?,?)').run(createId(), method.id, review.id, timestamp, revision ? 'revision' : 'validation', version)
        if (revision) this.raw.prepare('INSERT INTO method_versions VALUES(?,?,?,?,?,?,?,?,?)').run(createId(), method.id, version, method.title, method.applicable, method.unsuitable, method.steps, review.id, timestamp)
      }

      const newIdeaTitle = review.newIdeas.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? ''
      let createdIdea: Item | undefined
      if (newIdeaTitle) {
        createdIdea = { id: createId(), title: newIdeaTitle, content: review.newIdeas === newIdeaTitle ? '' : review.newIdeas, status: 'idea_to_try', createdAt: timestamp, updatedAt: timestamp }
        this.raw.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,NULL,NULL)').run(createdIdea.id, createdIdea.title, createdIdea.content, createdIdea.status, timestamp, timestamp)
        this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), createdIdea.id, null, createdIdea.status, timestamp)
        this.raw.prepare('INSERT INTO item_links VALUES(?,?,?,?,?)').run(createId(), review.id, createdIdea.id, 'derived_from_review', timestamp)
      }

      this.raw.prepare('UPDATE items SET status=?,updated_at=? WHERE id=?').run('reviewed', timestamp, item.id)
      this.raw.prepare('INSERT INTO item_status_events VALUES(?,?,?,?,?)').run(createId(), item.id, item.status, 'reviewed', timestamp)
      return { item: { ...item, status: 'reviewed', updatedAt: timestamp }, review, method, createdIdea }
    })
  }
}
