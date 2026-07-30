import type { CompleteReviewInput, CompleteReviewResult, CreateMethodInput, CurrentUserScope, Item, ItemStatus, Method, Review, ReviewWorkflowRepository } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { businessError, rethrowDuplicateAsBusinessError } from './errors'
import { runInMySqlTransaction } from './index'

type DateTime = string | Date
type ItemRow = RowDataPacket & { id: string; title: string; content: string; status: ItemStatus; start_action: string | null; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null }
type MethodRow = RowDataPacket & { id: string; title: string; applicable: string; unsuitable: string; steps: string; validation_count: number; version: number; created_at: DateTime; updated_at: DateTime; deleted_at: DateTime | null }

const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: DateTime) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`
const mapItem = (row: ItemRow): Item => ({ id: row.id, title: row.title, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}), ...(row.start_action ? { startAction: row.start_action } : {}) })
const mapMethod = (row: MethodRow): Method => ({ id: row.id, title: row.title, applicable: row.applicable, unsuitable: row.unsuitable, steps: row.steps, validationCount: row.validation_count, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}) })

type NormalizedMethodInput = {
  title: string
  applicable: string
  unsuitable: string
  steps: string
}

function normalizeMethodInput(input: CreateMethodInput): NormalizedMethodInput {
  const normalized = {
    title: input.title.trim(),
    applicable: input.applicable.trim(),
    unsuitable: input.unsuitable?.trim() ?? '',
    steps: input.steps.trim(),
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

export interface MySqlReviewWorkflowRepositoryTestHooks {
  beforeReviewInsert?: () => Promise<void> | void
  beforeMethodWrite?: () => Promise<void> | void
  beforeVersionInsert?: () => Promise<void> | void
  beforeEvidenceInsert?: () => Promise<void> | void
  beforeDerivedItemInsert?: () => Promise<void> | void
  beforeDerivedStatusEventInsert?: () => Promise<void> | void
  beforeItemLinkInsert?: () => Promise<void> | void
  beforeItemUpdate?: () => Promise<void> | void
  beforeStatusEventInsert?: () => Promise<void> | void
  beforeCommit?: (connection: PoolConnection) => Promise<void> | void
}

export class MySqlReviewWorkflowRepository implements ReviewWorkflowRepository {
  constructor(private readonly pool: Pool, private readonly hooks?: MySqlReviewWorkflowRepositoryTestHooks, private readonly scope?: CurrentUserScope) {}

  async complete(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    if (input.method && input.existingMethod) {
      throw businessError(
        'REVIEW_METHOD_MODE_CONFLICT',
        'validation',
        '不能同时形成新方法和验证已有方法',
      )
    }
    const formation = input.method ? normalizeMethodInput(input.method) : undefined
    const revision = input.existingMethod?.revision ? normalizeMethodInput(input.existingMethod.revision) : undefined
    const review = this.buildReview(input)
    return runInMySqlTransaction(this.pool, async connection => {
      const item = await this.lockItem(connection, input.itemId)
      if (!item || item.deleted_at) {
        throw businessError('ITEM_NOT_FOUND', 'not-found', '事项不存在')
      }
      if (item.status !== 'doing' && item.status !== 'waiting_review') {
        throw businessError(
          'ITEM_NOT_REVIEWABLE',
          'conflict',
          '只有已开始或待复盘事项可以完成复盘',
        )
      }
      const [existing] = await connection.query<Array<RowDataPacket & { id: string }>>(this.scope ? 'SELECT id FROM reviews WHERE item_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM reviews WHERE item_id=? FOR UPDATE', this.scope ? [input.itemId, this.scope.userId] : [input.itemId])
      if (existing[0]) {
        throw businessError('REVIEW_ALREADY_COMPLETED', 'conflict', '该事项已经完成复盘')
      }
      const existingMethod = input.existingMethod ? await this.lockActiveMethod(connection, input.existingMethod.methodId) : undefined
      if (input.existingMethod && !existingMethod) {
        throw businessError('METHOD_NOT_FOUND', 'not-found', '选择的方法不存在')
      }
      if (existingMethod) {
        const [evidence] = await connection.query<Array<RowDataPacket & { id: string }>>(this.scope ? 'SELECT id FROM method_evidence WHERE method_id=? AND review_id=? AND owner_user_id=? FOR UPDATE' : 'SELECT id FROM method_evidence WHERE method_id=? AND review_id=? FOR UPDATE', this.scope ? [existingMethod.id, review.id, this.scope.userId] : [existingMethod.id, review.id])
        if (evidence[0]) {
          throw businessError(
            'METHOD_ALREADY_VALIDATED_BY_REVIEW',
            'conflict',
            '该复盘已经验证过这个方法',
          )
        }
      }
      await this.hooks?.beforeReviewInsert?.()
      await this.insertReview(connection, review)
      const method = formation
        ? await this.createMethod(connection, formation, review)
        : existingMethod
          ? await this.validateMethod(connection, existingMethod, review, revision)
          : undefined
      const createdIdea = await this.createDerivedIdea(connection, review)
      const updatedAt = new Date().toISOString()
      await this.hooks?.beforeItemUpdate?.()
      await connection.execute(this.scope ? 'UPDATE items SET status=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE items SET status=?,updated_at=? WHERE id=?', this.scope ? ['reviewed', mysqlDateTime(updatedAt), item.id, this.scope.userId] : ['reviewed', mysqlDateTime(updatedAt), item.id])
      await this.hooks?.beforeStatusEventInsert?.()
      await connection.execute(this.scope ? 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,owner_user_id) VALUES(?,?,?,?,?,?)' : 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,?,?,?)', this.scope ? [createId(), item.id, item.status, 'reviewed', mysqlDateTime(updatedAt), this.scope.userId] : [createId(), item.id, item.status, 'reviewed', mysqlDateTime(updatedAt)])
      await this.hooks?.beforeCommit?.(connection)
      return { item: { ...mapItem(item), status: 'reviewed', updatedAt }, review, ...(method ? { method } : {}), ...(createdIdea ? { createdIdea } : {}) }
    })
  }

  private async insertReview(connection: PoolConnection, review: Review): Promise<void> {
    try {
      await connection.execute(
        this.scope ? 'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        this.scope ? [review.id, review.itemId, review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas, mysqlDateTime(review.createdAt), mysqlDateTime(review.updatedAt), this.scope.userId] : [review.id, review.itemId, review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas, mysqlDateTime(review.createdAt), mysqlDateTime(review.updatedAt)],
      )
    } catch (error) {
      rethrowDuplicateAsBusinessError(
        error,
        'REVIEW_ALREADY_COMPLETED',
        '该事项已经完成复盘',
      )
    }
  }

  private async createMethod(connection: PoolConnection, input: NormalizedMethodInput, review: Review): Promise<Method> {
    const now = new Date().toISOString()
    const method: Method = { id: createId(), ...input, validationCount: 1, version: 1, createdAt: now, updatedAt: now }
    await this.hooks?.beforeMethodWrite?.()
    await connection.execute(
      this.scope ? 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO methods(id,title,applicable,unsuitable,steps,validation_count,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      this.scope ? [method.id, method.title, method.applicable, method.unsuitable, method.steps, method.validationCount, method.version, mysqlDateTime(now), mysqlDateTime(now), this.scope.userId] : [method.id, method.title, method.applicable, method.unsuitable, method.steps, method.validationCount, method.version, mysqlDateTime(now), mysqlDateTime(now)],
    )
    await this.hooks?.beforeVersionInsert?.()
    await connection.execute(
      this.scope ? 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      this.scope ? [createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, review.id, mysqlDateTime(now), this.scope.userId] : [createId(), method.id, 1, method.title, method.applicable, method.unsuitable, method.steps, review.id, mysqlDateTime(now)],
    )
    await this.hooks?.beforeEvidenceInsert?.()
    await connection.execute(
      this.scope ? 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,?,?,?)',
      this.scope ? [createId(), method.id, review.id, 'formation', 1, mysqlDateTime(now), this.scope.userId] : [createId(), method.id, review.id, 'formation', 1, mysqlDateTime(now)],
    )
    return method
  }

  private async validateMethod(connection: PoolConnection, row: MethodRow, review: Review, revision?: NormalizedMethodInput): Promise<Method> {
    const now = new Date().toISOString()
    const method = mapMethod(row)
    const nextVersion = revision ? method.version + 1 : method.version
    const updated: Method = revision
      ? { ...method, ...revision, validationCount: method.validationCount + 1, version: nextVersion, updatedAt: now }
      : { ...method, validationCount: method.validationCount + 1, updatedAt: now }
    await this.hooks?.beforeMethodWrite?.()
    await connection.execute(
      this.scope ? 'UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=? AND owner_user_id=?' : 'UPDATE methods SET title=?,applicable=?,unsuitable=?,steps=?,validation_count=?,version=?,updated_at=? WHERE id=?',
      this.scope ? [updated.title, updated.applicable, updated.unsuitable, updated.steps, updated.validationCount, updated.version, mysqlDateTime(now), updated.id, this.scope.userId] : [updated.title, updated.applicable, updated.unsuitable, updated.steps, updated.validationCount, updated.version, mysqlDateTime(now), updated.id],
    )
    if (revision) {
      await this.hooks?.beforeVersionInsert?.()
      await connection.execute(
        this.scope ? 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)' : 'INSERT INTO method_versions(id,method_id,version,title,applicable,unsuitable,steps,source_review_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        this.scope ? [createId(), updated.id, nextVersion, updated.title, updated.applicable, updated.unsuitable, updated.steps, review.id, mysqlDateTime(now), this.scope.userId] : [createId(), updated.id, nextVersion, updated.title, updated.applicable, updated.unsuitable, updated.steps, review.id, mysqlDateTime(now)],
      )
    }
    await this.hooks?.beforeEvidenceInsert?.()
    try {
      await connection.execute(
        this.scope ? 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at,owner_user_id) VALUES(?,?,?,?,?,?,?)' : 'INSERT INTO method_evidence(id,method_id,review_id,relation,method_version,created_at) VALUES(?,?,?,?,?,?)',
        this.scope ? [createId(), updated.id, review.id, revision ? 'revision' : 'validation', nextVersion, mysqlDateTime(now), this.scope.userId] : [createId(), updated.id, review.id, revision ? 'revision' : 'validation', nextVersion, mysqlDateTime(now)],
      )
    } catch (error) {
      rethrowDuplicateAsBusinessError(
        error,
        'METHOD_ALREADY_VALIDATED_BY_REVIEW',
        '该复盘已经验证过这个方法',
      )
    }
    return updated
  }

  private async lockActiveMethod(connection: PoolConnection, id: string): Promise<MethodRow | undefined> {
    const [methods] = await connection.query<MethodRow[]>(this.scope ? 'SELECT * FROM methods WHERE id=? AND owner_user_id=? FOR UPDATE' : 'SELECT * FROM methods WHERE id=? FOR UPDATE', this.scope ? [id, this.scope.userId] : [id])
    return methods[0] && !methods[0].deleted_at ? methods[0] : undefined
  }

  private async createDerivedIdea(connection: PoolConnection, review: Review): Promise<Item | undefined> {
    const ideas = review.newIdeas
    const title = ideas.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? ''
    if (!title) return undefined
    const now = new Date().toISOString()
    const item: Item = { id: createId(), title, content: ideas === title ? '' : ideas, status: 'idea_to_try', createdAt: now, updatedAt: now }
    await this.hooks?.beforeDerivedItemInsert?.()
    await connection.execute(this.scope ? 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at,owner_user_id) VALUES(?,?,?,?,NULL,?,?,NULL,?)' : 'INSERT INTO items(id,title,content,status,start_action,created_at,updated_at,deleted_at) VALUES(?,?,?,?,NULL,?,?,NULL)', this.scope ? [item.id, item.title, item.content, item.status, mysqlDateTime(now), mysqlDateTime(now), this.scope.userId] : [item.id, item.title, item.content, item.status, mysqlDateTime(now), mysqlDateTime(now)])
    await this.hooks?.beforeDerivedStatusEventInsert?.()
    await connection.execute(this.scope ? 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at,owner_user_id) VALUES(?,?,?,?,?,?)' : 'INSERT INTO item_status_events(id,item_id,from_status,to_status,created_at) VALUES(?,?,?,?,?)', this.scope ? [createId(), item.id, null, item.status, mysqlDateTime(now), this.scope.userId] : [createId(), item.id, null, item.status, mysqlDateTime(now)])
    await this.hooks?.beforeItemLinkInsert?.()
    await connection.execute(this.scope ? 'INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at,owner_user_id) VALUES(?,?,?,?,?,?)' : 'INSERT INTO item_links(id,source_review_id,target_item_id,type,created_at) VALUES(?,?,?,?,?)', this.scope ? [createId(), review.id, item.id, 'derived_from_review', mysqlDateTime(now), this.scope.userId] : [createId(), review.id, item.id, 'derived_from_review', mysqlDateTime(now)])
    return item
  }

  private buildReview(input: CompleteReviewInput): Review {
    const createdAt = new Date().toISOString()
    const review: Review = {
      id: createId(), itemId: input.itemId, actualAction: input.actualAction.trim(), result: input.result.trim(), effective: input.effective.trim(), incompatible: input.incompatible.trim(), reason: input.reason.trim(), adjustment: input.adjustment.trim(), newIdeas: input.newIdeas?.trim() ?? '', createdAt, updatedAt: createdAt,
    }
    const required = [['实际行动', review.actualAction], ['结果', review.result]].filter(([, value]) => !value).map(([label]) => label)
    if (required.length) {
      throw businessError(
        'REVIEW_REQUIRED_FIELDS_MISSING',
        'validation',
        `请填写：${required.join('、')}`,
      )
    }
    return review
  }

  private async lockItem(connection: PoolConnection, id: string): Promise<ItemRow | undefined> {
    const [items] = await connection.query<ItemRow[]>(this.scope ? 'SELECT * FROM items WHERE id=? AND owner_user_id=? FOR UPDATE' : 'SELECT * FROM items WHERE id=? FOR UPDATE', this.scope ? [id, this.scope.userId] : [id])
    return items[0]
  }
}
