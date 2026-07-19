import { afterEach, describe, expect, it } from 'vitest'

import { ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []
const reviewFields = {
  actualAction: '完成真实行动', result: '得到结果', effective: '有效', incompatible: '', reason: '', adjustment: '', newIdeas: '',
}

function createServices() {
  const storage = createIndexedDbRepository(`method-evidence-details-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository),
  }
}

async function completeItem(services: ReturnType<typeof createServices>, title: string, offset: number) {
  const item = await services.items.createIdea({ title })
  await services.items.changeStatus(item.id, 'doing')
  await services.items.changeStatus(item.id, 'waiting_review')
  const review = await services.reviews.completeReview({
    itemId: item.id,
    ...reviewFields,
    actualAction: `${title}行动`,
    result: `${title}结果`,
  })
  await services.storage.database.reviews.update(review.review.id, { createdAt: `2026-07-18T12:00:0${offset}.000Z` })
  return { item, review: review.review }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('方法证据详情查询', () => {
  it('以真实版本来源区分形成、验证和修订，并按复盘时间倒序', async () => {
    const services = createServices()
    const formation = await completeItem(services, '形成事项', 1)
    const method = await services.storage.methodRepository.createFromReview({ title: '证据方法', applicable: '测试', steps: '执行' }, formation.review.id)
    const validation = await completeItem(services, '验证事项', 2)
    await services.storage.methodRepository.validateFromReview(method.id, validation.review.id)
    const revision = await completeItem(services, '修订事项', 3)
    await services.storage.methodRepository.validateFromReview(method.id, revision.review.id, { title: '证据方法', applicable: '测试', steps: '修订执行' })

    const details = await services.reviews.listMethodEvidenceDetails(method.id)

    expect(details.map(({ relation }) => relation)).toEqual(['revision', 'validation', 'formation'])
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewId: formation.review.id, itemId: formation.item.id, itemTitle: '形成事项', relation: 'formation', methodVersion: 1 }),
      expect.objectContaining({ reviewId: validation.review.id, itemId: validation.item.id, itemTitle: '验证事项', relation: 'validation' }),
      expect.objectContaining({ reviewId: revision.review.id, itemId: revision.item.id, itemTitle: '修订事项', relation: 'revision', methodVersion: 2 }),
    ]))
  })

  it('旧数据缺少可靠 v1 来源时降级为 unknown', async () => {
    const services = createServices()
    const entry = await completeItem(services, '旧验证事项', 1)
    const method = await services.storage.methodRepository.createFromReview({ title: '旧数据方法', applicable: '测试', steps: '执行' }, entry.review.id)
    const version = await services.storage.database.methodVersions.where('[methodId+version]').equals([method.id, 1]).first()
    await services.storage.database.methodVersions.put({ ...version!, sourceReviewId: undefined })

    const details = await services.reviews.listMethodEvidenceDetails(method.id)
    expect(details).toEqual([expect.objectContaining({ relation: 'unknown', itemTitle: '旧验证事项' })])
  })

  it('复盘或事项缺失时稳定降级为 unknown', async () => {
    const services = createServices()
    const entry = await completeItem(services, '待删除关联事项', 1)
    const method = await services.storage.methodRepository.createFromReview({ title: '缺失关联方法', applicable: '测试', steps: '执行' }, entry.review.id)
    await services.storage.database.items.delete(entry.item.id)

    const details = await services.reviews.listMethodEvidenceDetails(method.id)
    expect(details).toEqual([expect.objectContaining({
      reviewId: entry.review.id,
      itemId: entry.item.id,
      itemTitle: '关联事项已不存在',
      relation: 'unknown',
    })])

    await services.storage.database.reviews.delete(entry.review.id)
    const missingReview = await services.reviews.listMethodEvidenceDetails(method.id)
    expect(missingReview).toEqual([expect.objectContaining({
      reviewId: entry.review.id,
      itemId: '',
      itemTitle: '关联事项已不存在',
      reviewSummary: '关联复盘已不存在',
      relation: 'unknown',
    })])
  })
})
