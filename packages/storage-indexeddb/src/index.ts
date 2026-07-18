import Dexie, { type EntityTable } from 'dexie'
import type {
  CompleteReviewInput,
  CompleteReviewResult,
  CreateItemInput,
  CreateMethodInput,
  CreateReviewInput,
  Item,
  ItemLink,
  ItemRepository,
  ItemStatus,
  Method,
  MethodEvidence,
  MethodRepository,
  Review,
  ReviewRepository,
  ReviewWorkflowRepository,
} from '@knowledge-base/contracts'
import { assertTransition } from '@knowledge-base/domain'

export { default as Dexie } from 'dexie'
export class KnowledgeDatabase extends Dexie {
  items!: EntityTable<Item, 'id'>
  reviews!: EntityTable<Review, 'id'>
  methods!: EntityTable<Method, 'id'>
  methodEvidence!: EntityTable<MethodEvidence, 'id'>
  itemLinks!: EntityTable<ItemLink, 'id'>

  constructor(name = 'knowledge-base') {
    super(name)
    this.version(1).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
    })
    this.version(2).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
    })
    this.version(3).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    }).upgrade(async (transaction) => {
      const reviews = await transaction.table<Review, string>('reviews').toArray()
      const ideasAndLinks = reviews.flatMap((review) => {
        const newIdeas = review.newIdeas.trim()
        const title = newIdeas.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? ''
        if (!title) return []

        const itemId = crypto.randomUUID()
        const item: Item = {
          id: itemId,
          title,
          content: newIdeas === title ? '' : newIdeas,
          status: 'idea_to_try',
          createdAt: review.updatedAt,
          updatedAt: review.updatedAt,
        }
        const link: ItemLink = {
          id: crypto.randomUUID(),
          sourceReviewId: review.id,
          targetItemId: itemId,
          type: 'derived_from_review',
          createdAt: review.updatedAt,
        }
        return [{ item, link }]
      })

      await transaction.table<Item, string>('items').bulkAdd(ideasAndLinks.map(({ item }) => item))
      await transaction.table<ItemLink, string>('itemLinks').bulkAdd(ideasAndLinks.map(({ link }) => link))
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

export class IndexedDbReviewRepository implements ReviewRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async create(input: CreateReviewInput): Promise<Review> {
    const existing = await this.getByItemId(input.itemId)
    if (existing) throw new Error('该事项已经完成复盘')

    const now = new Date().toISOString()
    const review: Review = {
      id: crypto.randomUUID(),
      itemId: input.itemId,
      actualAction: input.actualAction.trim(),
      result: input.result.trim(),
      effective: input.effective.trim(),
      incompatible: input.incompatible.trim(),
      reason: input.reason.trim(),
      adjustment: input.adjustment.trim(),
      newIdeas: input.newIdeas?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    }

    const required = [review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment]
    if (required.some((value) => !value)) throw new Error('请完成所有必填复盘项')
    await this.database.reviews.add(review)
    return review
  }

  getByItemId(itemId: string): Promise<Review | undefined> {
    return this.database.reviews.where('itemId').equals(itemId).first()
  }

  delete(id: string): Promise<void> {
    return this.database.reviews.delete(id)
  }
}

export class IndexedDbMethodRepository implements MethodRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async createFromReview(input: CreateMethodInput, reviewId: string): Promise<Method> {
    const title = input.title.trim()
    const applicable = input.applicable.trim()
    const steps = input.steps.trim()
    if (!title || !applicable || !steps) throw new Error('请完成方法标题、适用情况和具体步骤')

    const now = new Date().toISOString()
    const method: Method = {
      id: crypto.randomUUID(),
      title,
      applicable,
      unsuitable: input.unsuitable?.trim() ?? '',
      steps,
      validationCount: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    const evidence: MethodEvidence = {
      id: crypto.randomUUID(),
      methodId: method.id,
      reviewId,
      createdAt: now,
    }

    await this.database.transaction('rw', this.database.methods, this.database.methodEvidence, async () => {
      await this.database.methods.add(method)
      await this.database.methodEvidence.add(evidence)
    })
    return method
  }

  list(): Promise<Method[]> {
    return this.database.methods.orderBy('updatedAt').reverse().toArray()
  }

  async listByReviewId(reviewId: string): Promise<Method[]> {
    const evidence = await this.database.methodEvidence.where('reviewId').equals(reviewId).toArray()
    return this.database.methods.bulkGet(evidence.map((entry) => entry.methodId)).then((methods) =>
      methods.filter((method): method is Method => Boolean(method)),
    )
  }
}

export class IndexedDbReviewWorkflowRepository implements ReviewWorkflowRepository {
  constructor(
    private readonly database: KnowledgeDatabase,
    private readonly itemRepository: IndexedDbItemRepository,
    private readonly reviewRepository: IndexedDbReviewRepository,
    private readonly methodRepository: IndexedDbMethodRepository,
  ) {}

  async complete(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    return this.database.transaction(
      'rw',
      this.database.items,
      this.database.reviews,
      this.database.methods,
      this.database.methodEvidence,
      this.database.itemLinks,
      async () => {
        const item = await this.itemRepository.getById(input.itemId)
        if (!item || item.deletedAt) throw new Error('事项不存在')
        if (item.status !== 'waiting_review') throw new Error('只有待复盘事项可以完成复盘')

        const review = await this.reviewRepository.create(input)
        const method = input.method
          ? await this.methodRepository.createFromReview(input.method, review.id)
          : undefined
        const newIdeas = input.newIdeas?.trim() ?? ''
        const newIdeaTitle = newIdeas.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? ''
        const createdIdea = newIdeaTitle
          ? await this.itemRepository.create({
            title: newIdeaTitle,
            content: newIdeas === newIdeaTitle ? '' : newIdeas,
            status: 'idea_to_try',
          })
          : undefined
        if (createdIdea) {
          await this.database.itemLinks.add({
            id: crypto.randomUUID(),
            sourceReviewId: review.id,
            targetItemId: createdIdea.id,
            type: 'derived_from_review',
            createdAt: new Date().toISOString(),
          })
        }
        const reviewedItem = await this.itemRepository.changeStatus(item.id, 'reviewed')
        return { item: reviewedItem, review, method, createdIdea }
      },
    )
  }
}

export function createIndexedDbRepository(name?: string): {
  database: KnowledgeDatabase
  repository: IndexedDbItemRepository
  reviewRepository: IndexedDbReviewRepository
  methodRepository: IndexedDbMethodRepository
  reviewWorkflowRepository: IndexedDbReviewWorkflowRepository
} {
  const database = new KnowledgeDatabase(name)
  const repository = new IndexedDbItemRepository(database)
  const reviewRepository = new IndexedDbReviewRepository(database)
  const methodRepository = new IndexedDbMethodRepository(database)
  return {
    database,
    repository,
    reviewRepository,
    methodRepository,
    reviewWorkflowRepository: new IndexedDbReviewWorkflowRepository(
      database,
      repository,
      reviewRepository,
      methodRepository,
    ),
  }
}
