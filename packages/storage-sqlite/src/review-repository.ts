import type { CreateReviewInput, Review, ReviewRepository } from '@knowledge-base/contracts'
import { createId } from '@knowledge-base/domain'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const mapReview = (row: Row): Review => ({ id:String(row.id),itemId:String(row.item_id),actualAction:String(row.actual_action),result:String(row.result),effective:String(row.effective),incompatible:String(row.incompatible),reason:String(row.reason),adjustment:String(row.adjustment),newIdeas:String(row.new_ideas),createdAt:String(row.created_at),updatedAt:String(row.updated_at) })
export class SqliteReviewRepository implements ReviewRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw(){return getRawDatabase(this.database)}
  async create(input:CreateReviewInput):Promise<Review>{const existing=this.raw.prepare('SELECT id FROM reviews WHERE item_id=?').get(input.itemId);if(existing)throw new Error('该事项已经完成复盘');const createdAt=new Date().toISOString(),review:Review={id:createId(),itemId:input.itemId,actualAction:input.actualAction.trim(),result:input.result.trim(),effective:input.effective.trim(),incompatible:input.incompatible.trim(),reason:input.reason.trim(),adjustment:input.adjustment.trim(),newIdeas:input.newIdeas?.trim()??'',createdAt,updatedAt:createdAt};const required=[['实际行动',review.actualAction],['结果',review.result]].filter(([,value])=>!value).map(([label])=>label);if(required.length)throw new Error(`请填写：${required.join('、')}`);this.database.runInTransaction(()=>this.raw.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(review.id,review.itemId,review.actualAction,review.result,review.effective,review.incompatible,review.reason,review.adjustment,review.newIdeas,createdAt,createdAt));return review}
  async getById(id:string):Promise<Review|undefined>{const row=this.raw.prepare('SELECT * FROM reviews WHERE id=?').get(id) as Row|undefined;return row&&mapReview(row)}
  async getByItemId(itemId:string):Promise<Review|undefined>{const row=this.raw.prepare('SELECT * FROM reviews WHERE item_id=?').get(itemId) as Row|undefined;return row&&mapReview(row)}
  async delete(id:string):Promise<void>{this.database.runInTransaction(()=>this.raw.prepare('DELETE FROM reviews WHERE id=?').run(id))}
}
