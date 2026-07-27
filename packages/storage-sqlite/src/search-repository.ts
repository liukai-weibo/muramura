import type { SearchRepository, SearchResult } from '@knowledge-base/contracts'
import { getRawDatabase, type SqliteKnowledgeDatabase } from './database'

type Row = Record<string, unknown>
const contains = (query: string, ...values: string[]) => values.some(value => value.toLocaleLowerCase('zh-CN').includes(query))

export class SqliteSearchRepository implements SearchRepository {
  constructor(private readonly database: SqliteKnowledgeDatabase) {}
  private get raw() { return getRawDatabase(this.database) }

  async search(query: string): Promise<SearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return []
    return this.database.runInReadTransaction(() => {
      const items = this.raw.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all() as Row[]
      const reviews = this.raw.prepare('SELECT * FROM reviews').all() as Row[]
      const methods = this.raw.prepare('SELECT * FROM methods WHERE deleted_at IS NULL').all() as Row[]
      const versions = this.raw.prepare('SELECT * FROM method_versions').all() as Row[]
      const itemById = new Map(items.map(item => [String(item.id), item]))
      const itemResults: SearchResult[] = items.filter(item => contains(normalized, String(item.title), String(item.content))).map(item => ({ id: `item:${item.id}`, type: 'item', title: String(item.title), excerpt: String(item.content), itemId: String(item.id), itemStatus: item.status as SearchResult['itemStatus'] }))
      const reviewResults: SearchResult[] = reviews.filter(review => itemById.has(String(review.item_id)) && contains(normalized, String(review.actual_action), String(review.result), String(review.effective), String(review.incompatible), String(review.reason), String(review.adjustment), String(review.new_ideas))).map(review => ({ id: `review:${review.id}`, type: 'review', title: String(itemById.get(String(review.item_id))?.title ?? '复盘'), excerpt: [String(review.actual_action), String(review.result)].filter(Boolean).join(' · '), itemId: String(review.item_id) }))
      const methodResults: SearchResult[] = methods.filter(method => contains(normalized, String(method.title), String(method.applicable), String(method.unsuitable), String(method.steps))).map(method => ({ id: `method:${method.id}`, type: 'method', title: String(method.title), excerpt: String(method.steps), methodId: String(method.id) }))
      const historicalResults: SearchResult[] = versions.filter(version => {
        const current = methods.find(method => String(method.id) === String(version.method_id))
        return contains(normalized, String(version.title), String(version.applicable), String(version.unsuitable), String(version.steps)) && !(current && Number(current.version) === Number(version.version) && methodResults.some(result => result.methodId === String(version.method_id)))
      }).map(version => ({ id: `method-version:${version.id}`, type: 'method', title: `${String(version.title)} v${Number(version.version)}`, excerpt: String(version.steps), methodId: String(version.method_id), methodVersion: Number(version.version) }))
      return [...itemResults, ...reviewResults, ...methodResults, ...historicalResults]
    })
  }
}
