import Dexie, { type EntityTable } from 'dexie'
import type {
  BackupData,
  BackupRepository,
  CompleteReviewInput,
  CompleteReviewResult,
  CreateItemInput,
  CreateMethodApplicationInput,
  CreateMethodInput,
  CreateReviewInput,
  DashboardRepository,
  DashboardSnapshot,
  Item,
  ItemLink,
  ItemRepository,
  ItemStatus,
  ItemStatusEvent,
  Method,
  MethodApplication,
  MethodApplicationContext,
  MethodApplicationRepository,
  MethodEvidence,
  MethodRepository,
  MethodVersion,
  Review,
  ReviewRepository,
  ReviewWorkflowRepository,
  SearchRepository,
  SearchResult,
} from '@knowledge-base/contracts'
import { assertTransition, createId } from '@knowledge-base/domain'

export { default as Dexie } from 'dexie'
export class KnowledgeDatabase extends Dexie {
  items!: EntityTable<Item, 'id'>
  reviews!: EntityTable<Review, 'id'>
  methods!: EntityTable<Method, 'id'>
  methodApplications!: EntityTable<MethodApplication, 'id'>
  methodEvidence!: EntityTable<MethodEvidence, 'id'>
  methodVersions!: EntityTable<MethodVersion, 'id'>
  itemLinks!: EntityTable<ItemLink, 'id'>
  itemStatusEvents!: EntityTable<ItemStatusEvent, 'id'>

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

        const itemId = createId()
        const item: Item = {
          id: itemId,
          title,
          content: newIdeas === title ? '' : newIdeas,
          status: 'idea_to_try',
          createdAt: review.updatedAt,
          updatedAt: review.updatedAt,
        }
        const link: ItemLink = {
          id: createId(),
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
    this.version(4).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    }).upgrade(async (transaction) => {
      const methods = await transaction.table<Method, string>('methods').toArray()
      const evidence = await transaction.table<MethodEvidence, string>('methodEvidence').toArray()
      const versions: MethodVersion[] = methods.map((method) => ({
        id: createId(),
        methodId: method.id,
        version: method.version,
        title: method.title,
        applicable: method.applicable,
        unsuitable: method.unsuitable,
        steps: method.steps,
        sourceReviewId: evidence.find((entry) => entry.methodId === method.id)?.reviewId,
        createdAt: method.createdAt,
      }))
      await transaction.table<MethodVersion, string>('methodVersions').bulkAdd(versions)
    })
    this.version(5).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
      methodApplications: 'id, methodId, methodVersion, &itemId, [methodId+methodVersion]',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
    })
    this.version(6).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
      methodVersions: 'id, methodId, version, [methodId+version], sourceReviewId',
      methodApplications: 'id, methodId, methodVersion, &itemId, [methodId+methodVersion]',
      itemLinks: 'id, sourceReviewId, targetItemId, type',
      itemStatusEvents: 'id, itemId, fromStatus, toStatus, createdAt, [itemId+createdAt]',
    }).upgrade(async (transaction) => {
      const items = await transaction.table<Item, string>('items').toArray()
      const events: ItemStatusEvent[] = items.map((item) => ({
        id: createId(),
        itemId: item.id,
        toStatus: item.status,
        createdAt: item.createdAt,
      }))
      await transaction.table<ItemStatusEvent, string>('itemStatusEvents').bulkAdd(events)
    })
  }
}

export class IndexedDbItemRepository implements ItemRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString()
    const item: Item = {
      id: createId(),
      title: input.title.trim(),
      content: input.content?.trim() ?? '',
      status: input.status ?? 'idea_to_try',
      createdAt: now,
      updatedAt: now,
    }

    if (!item.title) throw new Error('标题不能为空')
    await this.database.transaction('rw', [this.database.items, this.database.itemStatusEvents], async () => {
      await this.database.items.add(item)
      await this.database.itemStatusEvents.add({
        id: createId(),
        itemId: item.id,
        toStatus: item.status,
        createdAt: now,
      })
    })
    return item
  }

  getById(id: string): Promise<Item | undefined> {
    return this.database.items.get(id)
  }

  list(): Promise<Item[]> {
    return this.database.items.filter((item) => !item.deletedAt).sortBy('createdAt')
  }

  listDeleted(): Promise<Item[]> {
    return this.database.items.filter((item) => Boolean(item.deletedAt)).sortBy('deletedAt')
  }

  listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> {
    return this.database.itemStatusEvents.where('itemId').equals(itemId).sortBy('createdAt')
  }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    const item = await this.getById(id)
    if (!item || item.deletedAt) throw new Error('事项不存在')
    assertTransition(item.status, status)

    const now = new Date().toISOString()
    const updated = { ...item, status, updatedAt: now }
    await this.database.transaction('rw', [this.database.items, this.database.itemStatusEvents], async () => {
      await this.database.items.put(updated)
      await this.database.itemStatusEvents.add({
        id: createId(),
        itemId: item.id,
        fromStatus: item.status,
        toStatus: status,
        createdAt: now,
      })
    })
    return updated
  }

  async delete(id: string): Promise<void> {
    const item = await this.getById(id)
    if (!item || item.deletedAt) return
    const now = new Date().toISOString()
    await this.database.items.put({ ...item, deletedAt: now, updatedAt: now })
  }

  async restore(id: string): Promise<Item> {
    const item = await this.getById(id)
    if (!item?.deletedAt) throw new Error('回收站中不存在该事项')
    const { deletedAt: _deletedAt, ...restoredItem } = item
    const restored = { ...restoredItem, updatedAt: new Date().toISOString() }
    await this.database.items.put(restored)
    return restored
  }

  async purgeDeletedBefore(cutoff: string): Promise<void> {
    const expiredItems = await this.database.items
      .filter((item) => Boolean(item.deletedAt && item.deletedAt <= cutoff))
      .toArray()
    if (!expiredItems.length) return

    await this.database.transaction(
      'rw',
      [
        this.database.items,
        this.database.reviews,
        this.database.methods,
        this.database.methodApplications,
        this.database.methodEvidence,
        this.database.methodVersions,
        this.database.itemLinks,
        this.database.itemStatusEvents,
      ],
      async () => {
        for (const item of expiredItems) {
          const review = await this.database.reviews.where('itemId').equals(item.id).first()
          if (review) {
            const evidence = await this.database.methodEvidence.where('reviewId').equals(review.id).toArray()
            await this.database.methodEvidence.bulkDelete(evidence.map((entry) => entry.id))
            await this.database.reviews.delete(review.id)
            for (const methodId of new Set(evidence.map((entry) => entry.methodId))) {
              const evidenceCount = await this.database.methodEvidence.where('methodId').equals(methodId).count()
              const applicationCount = await this.database.methodApplications.where('methodId').equals(methodId).count()
              if (evidenceCount === 0 && applicationCount === 0) {
                await this.database.methodVersions.where('methodId').equals(methodId).delete()
                await this.database.methods.delete(methodId)
              }
            }
            await this.database.itemLinks.where('sourceReviewId').equals(review.id).delete()
          }
          await this.database.methodApplications.where('itemId').equals(item.id).delete()
          await this.database.itemLinks.where('targetItemId').equals(item.id).delete()
          await this.database.itemStatusEvents.where('itemId').equals(item.id).delete()
          await this.database.items.delete(item.id)
        }
      },
    )
  }
}

export class IndexedDbDashboardRepository implements DashboardRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async getSnapshot(): Promise<DashboardSnapshot> {
    const [items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemStatusEvents] = await Promise.all([
      this.database.items.filter((item) => !item.deletedAt).toArray(),
      this.database.reviews.toArray(),
      this.database.methods.toArray(),
      this.database.methodEvidence.toArray(),
      this.database.methodVersions.toArray(),
      this.database.methodApplications.toArray(),
      this.database.itemStatusEvents.toArray(),
    ])
    return { items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemStatusEvents }
  }
}

export class IndexedDbSearchRepository implements SearchRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async search(query: string): Promise<SearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return []
    const contains = (...values: string[]) => values.some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized))
    const [items, reviews, methods, versions] = await Promise.all([
      this.database.items.filter((item) => !item.deletedAt).toArray(),
      this.database.reviews.toArray(),
      this.database.methods.toArray(),
      this.database.methodVersions.toArray(),
    ])
    const itemById = new Map(items.map((item) => [item.id, item]))
    const itemResults: SearchResult[] = items.filter((item) => contains(item.title, item.content)).map((item) => ({
      id: `item:${item.id}`, type: 'item', title: item.title, excerpt: item.content,
      itemId: item.id, itemStatus: item.status,
    }))
    const reviewResults: SearchResult[] = reviews.filter((review) => itemById.has(review.itemId) && contains(
      review.actualAction, review.result, review.effective, review.incompatible, review.reason, review.adjustment, review.newIdeas,
    )).map((review) => ({
      id: `review:${review.id}`, type: 'review', title: itemById.get(review.itemId)?.title ?? '复盘',
      excerpt: [review.actualAction, review.result].filter(Boolean).join(' · '), itemId: review.itemId,
    }))
    const methodResults: SearchResult[] = methods.filter((method) => contains(method.title, method.applicable, method.unsuitable, method.steps)).map((method) => ({
      id: `method:${method.id}`, type: 'method', title: method.title, excerpt: method.steps, methodId: method.id,
    }))
    const historicalResults: SearchResult[] = versions.filter((version) => {
      const current = methods.find((method) => method.id === version.methodId)
      return contains(version.title, version.applicable, version.unsuitable, version.steps)
        && !(current?.version === version.version && methodResults.some((result) => result.methodId === version.methodId))
    }).map((version) => ({
      id: `method-version:${version.id}`, type: 'method', title: `${version.title} v${version.version}`,
      excerpt: version.steps, methodId: version.methodId, methodVersion: version.version,
    }))
    return [...itemResults, ...reviewResults, ...methodResults, ...historicalResults]
  }
}

export class IndexedDbMethodApplicationRepository implements MethodApplicationRepository {
  constructor(
    private readonly database: KnowledgeDatabase,
    private readonly itemRepository: IndexedDbItemRepository,
  ) {}

  async createItem(input: CreateMethodApplicationInput): Promise<Item> {
    const method = await this.database.methods.get(input.methodId)
    if (!method) throw new Error('选择的方法不存在')

    return this.database.transaction('rw', [this.database.items, this.database.methodApplications, this.database.itemStatusEvents], async () => {
      const item = await this.itemRepository.create({ title: input.title, content: input.content, status: 'idea_to_try' })
      await this.database.methodApplications.add({
        id: createId(),
        methodId: method.id,
        methodVersion: method.version,
        itemId: item.id,
        createdAt: new Date().toISOString(),
      })
      return item
    })
  }

  async getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined> {
    const application = await this.database.methodApplications.where('itemId').equals(itemId).first()
    if (!application) return undefined
    const [method, version] = await Promise.all([
      this.database.methods.get(application.methodId),
      this.database.methodVersions.where('[methodId+version]').equals([application.methodId, application.methodVersion]).first(),
    ])
    return method && version ? { application, method, version } : undefined
  }
}

export class IndexedDbReviewRepository implements ReviewRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async create(input: CreateReviewInput): Promise<Review> {
    const existing = await this.getByItemId(input.itemId)
    if (existing) throw new Error('该事项已经完成复盘')

    const now = new Date().toISOString()
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
      createdAt: now,
      updatedAt: now,
    }

    const required = [
      ['实际行动', review.actualAction],
      ['结果', review.result],
    ].filter(([, value]) => !value).map(([label]) => label)
    if (required.length) throw new Error(`请填写：${required.join('、')}`)
    await this.database.reviews.add(review)
    return review
  }

  getById(id: string): Promise<Review | undefined> {
    return this.database.reviews.get(id)
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
      id: createId(),
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
      id: createId(),
      methodId: method.id,
      reviewId,
      createdAt: now,
    }

    const version: MethodVersion = {
      id: createId(),
      methodId: method.id,
      version: 1,
      title,
      applicable,
      unsuitable: method.unsuitable,
      steps,
      sourceReviewId: reviewId,
      createdAt: now,
    }

    await this.database.transaction('rw', this.database.methods, this.database.methodEvidence, this.database.methodVersions, async () => {
      await this.database.methods.add(method)
      await this.database.methodEvidence.add(evidence)
      await this.database.methodVersions.add(version)
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

  listVersions(methodId: string): Promise<MethodVersion[]> {
    return this.database.methodVersions.where('methodId').equals(methodId).sortBy('version')
  }

  async validateFromReview(methodId: string, reviewId: string, revision?: CreateMethodInput): Promise<Method> {
    const method = await this.database.methods.get(methodId)
    if (!method) throw new Error('选择的方法不存在')
    if (await this.database.methodEvidence.where('[methodId+reviewId]').equals([methodId, reviewId]).count()) {
      throw new Error('该复盘已经验证过这个方法')
    }

    const now = new Date().toISOString()
    const nextVersion = revision ? method.version + 1 : method.version
    const updated: Method = revision ? {
      ...method,
      title: revision.title.trim(),
      applicable: revision.applicable.trim(),
      unsuitable: revision.unsuitable?.trim() ?? '',
      steps: revision.steps.trim(),
      validationCount: method.validationCount + 1,
      version: nextVersion,
      updatedAt: now,
    } : { ...method, validationCount: method.validationCount + 1, updatedAt: now }
    if (!updated.title || !updated.applicable || !updated.steps) throw new Error('请完成方法标题、适用情况和具体步骤')

    await this.database.methods.put(updated)
    await this.database.methodEvidence.add({ id: createId(), methodId, reviewId, createdAt: now })
    if (revision) {
      await this.database.methodVersions.add({
        id: createId(), methodId, version: nextVersion,
        title: updated.title, applicable: updated.applicable, unsuitable: updated.unsuitable, steps: updated.steps,
        sourceReviewId: reviewId, createdAt: now,
      })
    }
    return updated
  }
}

export class IndexedDbBackupRepository implements BackupRepository {
  constructor(private readonly database: KnowledgeDatabase) {}

  async exportData(): Promise<BackupData> {
    const [items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemLinks, itemStatusEvents] = await Promise.all([
      this.database.items.toArray(),
      this.database.reviews.toArray(),
      this.database.methods.toArray(),
      this.database.methodEvidence.toArray(),
      this.database.methodVersions.toArray(),
      this.database.methodApplications.toArray(),
      this.database.itemLinks.toArray(),
      this.database.itemStatusEvents.toArray(),
    ])
    return { items, reviews, methods, methodEvidence, methodVersions, methodApplications, itemLinks, itemStatusEvents }
  }

  replaceData(data: BackupData): Promise<void> {
    return this.database.transaction(
      'rw',
      [
        this.database.items,
        this.database.reviews,
        this.database.methods,
        this.database.methodApplications,
        this.database.methodEvidence,
        this.database.methodVersions,
        this.database.itemLinks,
        this.database.itemStatusEvents,
      ],
      async () => {
        await Promise.all([
          this.database.itemLinks.clear(),
          this.database.itemStatusEvents.clear(),
          this.database.methodApplications.clear(),
          this.database.methodEvidence.clear(),
          this.database.methodVersions.clear(),
          this.database.reviews.clear(),
          this.database.methods.clear(),
          this.database.items.clear(),
        ])
        await this.database.items.bulkAdd(data.items)
        await this.database.reviews.bulkAdd(data.reviews)
        await this.database.methods.bulkAdd(data.methods)
        await this.database.methodEvidence.bulkAdd(data.methodEvidence)
        await this.database.methodVersions.bulkAdd(data.methodVersions)
        await this.database.methodApplications.bulkAdd(data.methodApplications)
        await this.database.itemLinks.bulkAdd(data.itemLinks)
        await this.database.itemStatusEvents.bulkAdd(data.itemStatusEvents)
      },
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
      [
        this.database.items,
        this.database.reviews,
        this.database.methods,
        this.database.methodEvidence,
        this.database.methodVersions,
        this.database.itemLinks,
        this.database.itemStatusEvents,
      ],
      async () => {
        const item = await this.itemRepository.getById(input.itemId)
        if (!item || item.deletedAt) throw new Error('事项不存在')
        if (item.status !== 'waiting_review') throw new Error('只有待复盘事项可以完成复盘')

        const review = await this.reviewRepository.create(input)
        if (input.method && input.existingMethod) throw new Error('不能同时形成新方法和验证已有方法')
        const method = input.method
          ? await this.methodRepository.createFromReview(input.method, review.id)
          : input.existingMethod
            ? await this.methodRepository.validateFromReview(input.existingMethod.methodId, review.id, input.existingMethod.revision)
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
            id: createId(),
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
  dashboardRepository: IndexedDbDashboardRepository
  searchRepository: IndexedDbSearchRepository
  methodApplicationRepository: IndexedDbMethodApplicationRepository
  backupRepository: IndexedDbBackupRepository
  reviewWorkflowRepository: IndexedDbReviewWorkflowRepository
} {
  const database = new KnowledgeDatabase(name)
  const repository = new IndexedDbItemRepository(database)
  const reviewRepository = new IndexedDbReviewRepository(database)
  const methodRepository = new IndexedDbMethodRepository(database)
  const dashboardRepository = new IndexedDbDashboardRepository(database)
  const searchRepository = new IndexedDbSearchRepository(database)
  const methodApplicationRepository = new IndexedDbMethodApplicationRepository(database, repository)
  const backupRepository = new IndexedDbBackupRepository(database)
  return {
    database,
    repository,
    reviewRepository,
    methodRepository,
    dashboardRepository,
    searchRepository,
    methodApplicationRepository,
    backupRepository,
    reviewWorkflowRepository: new IndexedDbReviewWorkflowRepository(
      database,
      repository,
      reviewRepository,
      methodRepository,
    ),
  }
}
