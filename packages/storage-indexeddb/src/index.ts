import Dexie, { type EntityTable } from 'dexie'
import type { CreateItemInput, Item, ItemRepository, ItemStatus } from '@knowledge-base/contracts'
import { assertTransition } from '@knowledge-base/domain'

export class KnowledgeDatabase extends Dexie {
  items!: EntityTable<Item, 'id'>

  constructor(name = 'knowledge-base') {
    super(name)
    this.version(1).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
    })
  }
}

export class IndexedDbItemRepository implements ItemRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString()
    const item: Item = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      content: input.content?.trim() ?? '',
      status: input.status ?? 'idea_to_try',
      createdAt: now,
      updatedAt: now,
    }

    if (!item.title) throw new Error('标题不能为空')
    await this.database.items.add(item)
    return item
  }

  getById(id: string): Promise<Item | undefined> {
    return this.database.items.get(id)
  }

  list(): Promise<Item[]> {
    return this.database.items.filter((item) => !item.deletedAt).sortBy('createdAt')
  }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    const item = await this.getById(id)
    if (!item || item.deletedAt) throw new Error('事项不存在')
    assertTransition(item.status, status)

    const updated = { ...item, status, updatedAt: new Date().toISOString() }
    await this.database.items.put(updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const item = await this.getById(id)
    if (!item) return
    await this.database.items.put({
      ...item,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
}

export function createIndexedDbRepository(name?: string): {
  database: KnowledgeDatabase
  repository: IndexedDbItemRepository
} {
  const database = new KnowledgeDatabase(name)
  return { database, repository: new IndexedDbItemRepository(database) }
}
