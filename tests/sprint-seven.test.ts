import { afterEach, describe, expect, it } from 'vitest'
import { ItemApplicationService, ReviewApplicationService, SearchApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

  const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-seven-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
    search: new SearchApplicationService(storage.searchRepository),
  }
}

  const reviewFields = {
  actualAction: '晚饭后完成二十五分钟临摹',
  result: '完成一页瘦金体练习',
  effective: '固定在晚饭后容易启动',
  incompatible: '疲劳时二十五分钟偏长',
  reason: '固定触发点降低决策成本',
  adjustment: '疲劳时先完成五分钟',
  newIdeas: '',
}

async function createReviewedMethod(services: ReturnType<typeof createServices>) {
  const item = await services.items.createIdea({ title: '学习瘦金体', content: '建立稳定练字习惯' })
  await services.items.changeStatus(item.id, 'doing')
  const result = await services.reviews.completeReview({
    itemId: item.id,
    ...reviewFields,
    method: {
      title: '晚饭后启动法',
      applicable: '普通工作日晚饭后',
      unsuitable: '严重疲劳时',
      steps: '收拾桌面 → 临摹二十五分钟 → 拍照记录',
    },
  })
  return { item, result }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 7 全局搜索与快速定位', () => {
  it('按分类搜索事项、复盘和当前方法的全部关键文本', async () => {
    const services = createServices()
    const { item, result } = await createReviewedMethod(services)

    expect(await services.search.search('瘦金体')).toEqual([
      expect.objectContaining({ type: 'item', itemId: item.id, itemStatus: 'reviewed', title: '学习瘦金体' }),
      expect.objectContaining({ type: 'review', itemId: item.id, title: '学习瘦金体' }),
    ])
    expect(await services.search.search('决策成本')).toEqual([
      expect.objectContaining({ type: 'review', itemId: item.id }),
    ])
    expect(await services.search.search('拍照记录')).toEqual([
      expect.objectContaining({ type: 'method', methodId: result.method!.id, title: '晚饭后启动法' }),
    ])
  })

  it('当前方法修订后仍能通过旧版本内容找到历史版本', async () => {
    const services = createServices()
    const { result } = await createReviewedMethod(services)
    const revisionItem = await services.items.createIdea({ title: '修订练字方法' })
    await services.items.changeStatus(revisionItem.id, 'doing')
    await services.reviews.completeReview({
      itemId: revisionItem.id,
      ...reviewFields,
      existingMethod: {
        methodId: result.method!.id,
        revision: {
          title: '低阻力练字法', applicable: '工作日或低能量时', unsuitable: '生病时',
          steps: '先临摹五分钟 → 有余力再继续 → 拍照记录',
        },
      },
    })

    expect(await services.search.search('二十五分钟')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'method', methodId: result.method!.id, methodVersion: 1, title: '晚饭后启动法 v1',
      }),
    ]))
    expect(await services.search.search('低阻力')).toEqual([
      expect.objectContaining({ type: 'method', methodId: result.method!.id, title: '低阻力练字法' }),
    ])
  })

  it('忽略首尾空白与英文大小写，空查询不访问数据', async () => {
    const services = createServices()
    await services.items.createIdea({ title: 'Review API Design' })

    expect(await services.search.search('  api  ')).toEqual([
      expect.objectContaining({ type: 'item', title: 'Review API Design' }),
    ])
    expect(await services.search.search('review api')).toHaveLength(1)
    expect(await services.search.search('   ')).toEqual([])
  })

  it('不返回回收站事项及其复盘，且搜索不会修改任何数据', async () => {
    const services = createServices()
    const { item } = await createReviewedMethod(services)

    await services.items.deleteItem(item.id)
    expect(await services.search.search('瘦金体')).toEqual([])
    await services.items.restoreItem(item.id)
    const beforeSearch = await services.storage.backupRepository.exportData()
    await services.search.search('晚饭后')

    expect(await services.storage.backupRepository.exportData()).toEqual(beforeSearch)
  })
})
