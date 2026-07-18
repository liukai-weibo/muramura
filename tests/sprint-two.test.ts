import { afterEach, describe, expect, it } from 'vitest'
import { ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { Item, Review } from '@knowledge-base/contracts'
import { Dexie, createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-two-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    itemApplication: new ItemApplicationService(storage.repository),
    reviewApplication: new ReviewApplicationService(
      storage.reviewRepository,
      storage.methodRepository,
      storage.reviewWorkflowRepository,
    ),
    storage,
  }
}

const reviewInput = {
  actualAction: '每天晚饭后练字二十五分钟',
  result: '连续练习七天，完成七页临摹',
  effective: '晚饭后开始最自然，二十五分钟没有压力',
  incompatible: '情绪激烈时直接练字很难进入状态',
  reason: '固定触发点降低启动成本，时长适中',
  adjustment: '情绪激烈时先散步十分钟再开始',
  newIdeas: '测试不同字帖对专注度的影响',
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 2 复盘与方法工作流', () => {
  it('完成复盘并从现实证据形成方法', async () => {
    const { itemApplication, reviewApplication, storage } = createServices()
    const idea = await itemApplication.createIdea({ title: '学习瘦金体' })
    await itemApplication.changeStatus(idea.id, 'doing')
    await itemApplication.changeStatus(idea.id, 'waiting_review')

    const result = await reviewApplication.completeReview({
      itemId: idea.id,
      ...reviewInput,
      method: {
        title: '我的练字启动方式',
        applicable: '普通工作日晚饭后',
        unsuitable: '情绪特别激烈时',
        steps: '收拾桌面 → 临摹二十五分钟 → 拍照记录',
      },
    })

    expect(result.item.status).toBe('reviewed')
    expect(result.method?.version).toBe(1)
    expect(result.method?.validationCount).toBe(1)
    expect(result.createdIdea?.title).toBe('测试不同字帖对专注度的影响')
    expect(result.createdIdea?.status).toBe('idea_to_try')
    expect((await itemApplication.listItems()).some((item) => item.id === result.createdIdea?.id)).toBe(true)
    expect(await storage.database.itemLinks.where('targetItemId').equals(result.createdIdea?.id ?? '').count()).toBe(1)
    expect((await reviewApplication.getReviewForItem(idea.id))?.result).toContain('七页')
    expect((await reviewApplication.listMethods()).map((method) => method.title)).toEqual(['我的练字启动方式'])
    expect((await reviewApplication.listMethodsFromReview(result.review.id)).map((method) => method.id)).toEqual([result.method?.id])
  })

  it('允许只完成复盘而不提炼方法', async () => {
    const { itemApplication, reviewApplication } = createServices()
    const item = await itemApplication.createIdea({ title: '完成一次普通实验' })
    await itemApplication.changeStatus(item.id, 'doing')
    await itemApplication.changeStatus(item.id, 'waiting_review')

    const result = await reviewApplication.completeReview({ itemId: item.id, ...reviewInput, newIdeas: '' })

    expect(result.item.status).toBe('reviewed')
    expect(result.method).toBeUndefined()
    expect(result.createdIdea).toBeUndefined()
    expect(await reviewApplication.listMethods()).toEqual([])
  })

  it('将 v2 复盘中的历史新想法迁移到想试试且不会重复', async () => {
    const databaseName = `sprint-two-migration-${crypto.randomUUID()}`
    const legacyDatabase = new Dexie(databaseName)
    legacyDatabase.version(2).stores({
      items: 'id, status, createdAt, updatedAt, deletedAt',
      reviews: 'id, &itemId, createdAt, updatedAt',
      methods: 'id, createdAt, updatedAt',
      methodEvidence: 'id, methodId, reviewId, [methodId+reviewId]',
    })

    const timestamp = '2026-07-01T08:00:00.000Z'
    const historicalItem: Item = {
      id: crypto.randomUUID(),
      title: '我想学做饭',
      content: '',
      status: 'reviewed',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const historicalReview: Review = {
      id: crypto.randomUUID(),
      itemId: historicalItem.id,
      actualAction: '学习并完成一道菜',
      result: '成功完成番茄炒蛋',
      effective: '先准备全部食材有效',
      incompatible: '临时寻找调料会打断节奏',
      reason: '提前准备降低执行阻力',
      adjustment: '下次先列出调料清单',
      newIdeas: '想再学习土豆炒肉\n记录不同火候的效果',
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await legacyDatabase.open()
    await legacyDatabase.table<Item, string>('items').add(historicalItem)
    await legacyDatabase.table<Review, string>('reviews').add(historicalReview)
    legacyDatabase.close()

    const storage = createIndexedDbRepository(databaseName)
    databases.push(storage.database)
    await storage.database.open()

    expect(await storage.database.items.get(historicalItem.id)).toEqual(historicalItem)
    expect(await storage.database.reviews.get(historicalReview.id)).toEqual(historicalReview)
    const migratedIdeas = await storage.database.items.where('status').equals('idea_to_try').toArray()
    expect(migratedIdeas).toHaveLength(1)
    expect(migratedIdeas[0]).toMatchObject({
      title: '想再学习土豆炒肉',
      content: historicalReview.newIdeas,
      createdAt: timestamp,
    })
    expect(await storage.database.itemLinks.where('sourceReviewId').equals(historicalReview.id).first()).toMatchObject({
      targetItemId: migratedIdeas[0]?.id,
      type: 'derived_from_review',
    })

    storage.database.close()
    await storage.database.open()
    expect(await storage.database.items.where('status').equals('idea_to_try').count()).toBe(1)
    expect(await storage.database.itemLinks.where('sourceReviewId').equals(historicalReview.id).count()).toBe(1)
  })

  it('拒绝提前或重复完成复盘且不留下半成品', async () => {
    const { itemApplication, reviewApplication, storage } = createServices()
    const item = await itemApplication.createIdea({ title: '不能提前复盘' })

    await expect(reviewApplication.completeReview({ itemId: item.id, ...reviewInput })).rejects.toThrow('只有待复盘事项')
    expect(await storage.reviewRepository.getByItemId(item.id)).toBeUndefined()

    await itemApplication.changeStatus(item.id, 'doing')
    await itemApplication.changeStatus(item.id, 'waiting_review')
    await reviewApplication.completeReview({ itemId: item.id, ...reviewInput })

    await expect(reviewApplication.completeReview({ itemId: item.id, ...reviewInput })).rejects.toThrow('只有待复盘事项')
    expect(await storage.database.reviews.where('itemId').equals(item.id).count()).toBe(1)
  })
})
