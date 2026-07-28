import type { CreateReviewInput, Review, ReviewRepository } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { businessError, rethrowDuplicateAsBusinessError } from './errors'
import { runInMySqlTransaction } from './index'

type ReviewRow = RowDataPacket & {
  id: string
  item_id: string
  actual_action: string
  result: string
  effective: string
  incompatible: string
  reason: string
  adjustment: string
  new_ideas: string
  created_at: string | Date
  updated_at: string | Date
}

const mysqlDateTime = (value: string) => value.replace('T', ' ').replace('Z', '')
const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`

const mapReview = (row: ReviewRow): Review => ({
  id: row.id,
  itemId: row.item_id,
  actualAction: row.actual_action,
  result: row.result,
  effective: row.effective,
  incompatible: row.incompatible,
  reason: row.reason,
  adjustment: row.adjustment,
  newIdeas: row.new_ideas,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

export class MySqlReviewRepository implements ReviewRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateReviewInput): Promise<Review> {
    const createdAt = new Date().toISOString()
    const review: Review = {
      id: createId(),
      itemId: input.itemId,
      actualAction: input.actualAction.trim(),
      result: input.result.trim(),
      effective: input.effective.trim(),
      incompatible: input.incompatible.trim(),
      reason: input.reason.trim(),
      adjustment: input.adjustment.trim(),
      newIdeas: input.newIdeas?.trim() ?? '',
      createdAt,
      updatedAt: createdAt,
    }
    const required = [
      ['实际行动', review.actualAction],
      ['结果', review.result],
    ].filter(([, value]) => !value).map(([label]) => label)
    if (required.length) {
      throw businessError(
        'REVIEW_REQUIRED_FIELDS_MISSING',
        'validation',
        `请填写：${required.join('、')}`,
      )
    }

    return runInMySqlTransaction(this.pool, async connection => {
      const [items] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM items WHERE id=? FOR UPDATE', [review.itemId])
      if (!items[0]) throw businessError('ITEM_NOT_FOUND', 'not-found', '事项不存在')
      const [existing] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM reviews WHERE item_id=? FOR UPDATE', [review.itemId])
      if (existing[0]) {
        throw businessError('REVIEW_ALREADY_COMPLETED', 'conflict', '该事项已经完成复盘')
      }
      try {
        await connection.execute(
          'INSERT INTO reviews(id,item_id,actual_action,result,effective,incompatible,reason,adjustment,new_ideas,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [review.id, review.itemId, review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas, mysqlDateTime(createdAt), mysqlDateTime(createdAt)],
        )
      } catch (error) {
        rethrowDuplicateAsBusinessError(
          error,
          'REVIEW_ALREADY_COMPLETED',
          '该事项已经完成复盘',
        )
      }
      return review
    })
  }

  async getById(id: string): Promise<Review | undefined> {
    const [rows] = await this.pool.query<ReviewRow[]>('SELECT * FROM reviews WHERE id=?', [id])
    return rows[0] ? mapReview(rows[0]) : undefined
  }

  async getByItemId(itemId: string): Promise<Review | undefined> {
    const [rows] = await this.pool.query<ReviewRow[]>('SELECT * FROM reviews WHERE item_id=?', [itemId])
    return rows[0] ? mapReview(rows[0]) : undefined
  }

  async delete(id: string): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      const [reviews] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM reviews WHERE id=? FOR UPDATE', [id])
      if (!reviews[0]) return
      const [evidence] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM method_evidence WHERE review_id=? LIMIT 1 FOR UPDATE', [id])
      const [versions] = await connection.query<Array<RowDataPacket & { id: string }>>('SELECT id FROM method_versions WHERE source_review_id=? LIMIT 1 FOR UPDATE', [id])
      if (evidence[0] || versions[0]) {
        throw businessError(
          'REVIEW_HAS_METHOD_RELATION',
          'conflict',
          '复盘存在方法关联，暂不能删除',
        )
      }
      await connection.execute('DELETE FROM reviews WHERE id=?', [id])
    })
  }
}
