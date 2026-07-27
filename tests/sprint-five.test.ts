import { afterEach, describe, expect, it } from 'vitest'
import { ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`sprint-five-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(
      storage.reviewRepository,
      storage.methodRepository,
      storage.reviewWorkflowRepository,
    ),
  }
}

async function createWaitingItem(services: ReturnType<typeof createServices>, title: string) {
  const item = await services.items.createIdea({ title })
  await services.items.changeStatus(item.id, 'doing')
  return services.items.getItem(item.id)
}

const reviewFields = {
  actualAction: '完成一次真实执行',
  result: '获得一条真实结果',
  effective: '',
  incompatible: '',
  reason: '',
  adjustment: '',
  newIdeas: '',
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 5 方法历史与证据查看', () => {
  it('按版本顺序读取历史，并通过来源 ID 取回每版真实复盘', async () => {
    const services = createServices()
    const firstItem = await createWaitingItem(services, '形成方法')
    const first = await services.reviews.completeReview({
      itemId: firstItem.id,
      ...reviewFields,
      actualAction: '先执行旧步骤',
      result: '旧步骤可以启动',
      method: { title: '启动方法', applicable: '工作日', steps: '执行旧步骤' },
    })
    const secondItem = await createWaitingItem(services, '修订方法')
    const second = await services.reviews.completeReview({
      itemId: secondItem.id,
      ...reviewFields,
      actualAction: '根据反馈执行新步骤',
      result: '新步骤更稳定',
      existingMethod: {
        methodId: first.method!.id,
        revision: { title: '启动方法', applicable: '工作日', steps: '执行新步骤' },
      },
    })

    const versions = await services.reviews.listMethodVersions(first.method!.id)
    expect(versions.map((version) => version.version)).toEqual([1, 2])
    expect(await services.reviews.getReview(versions[0]!.sourceReviewId!)).toMatchObject({
      id: first.review.id,
      actualAction: '先执行旧步骤',
      result: '旧步骤可以启动',
    })
    expect(await services.reviews.getReview(versions[1]!.sourceReviewId!)).toMatchObject({
      id: second.review.id,
      actualAction: '根据反馈执行新步骤',
      result: '新步骤更稳定',
    })
  })

  it('来源复盘不存在时返回空值而不伪造证据', async () => {
    const services = createServices()
    await expect(services.reviews.getReview('missing-review')).resolves.toBeUndefined()
  })
})
