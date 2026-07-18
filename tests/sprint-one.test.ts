import { afterEach, describe, expect, it } from 'vitest'
import { ItemApplicationService } from '@knowledge-base/application'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createApplication() {
  const storage = createIndexedDbRepository(`sprint-one-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return { application: new ItemApplicationService(storage.repository), repository: storage.repository }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 1 事项应用服务', () => {
  it('可以捕获想法并区分想试试与以后再说', async () => {
    const { application } = createApplication()

    const activeIdea = await application.createIdea({ title: '学习摄影', content: '先完成一组街拍' })
    const laterIdea = await application.createIdea({ title: '学习木工', saveForLater: true })

    expect(activeIdea.status).toBe('idea_to_try')
    expect(activeIdea.content).toBe('先完成一组街拍')
    expect(laterIdea.status).toBe('idea_later')
    expect((await application.listItems()).map((item) => item.id)).toEqual([laterIdea.id, activeIdea.id])
  })

  it('只填写补充说明时自动取第一行作为标题', async () => {
    const { application } = createApplication()

    const item = await application.createIdea({ content: '我想学写字\n从每天十分钟开始' })

    expect(item.title).toBe('我想学写字')
    expect(item.content).toBe('')
  })

  it('完成想法到待复盘的执行链路', async () => {
    const { application } = createApplication()
    const idea = await application.createIdea({ title: '完成 Sprint 1' })

    expect(application.actionsFor(idea).map((action) => action.status)).toEqual([
      'doing',
      'idea_later',
      'abandoned',
    ])

    const doing = await application.changeStatus(idea.id, 'doing')
    const paused = await application.changeStatus(doing.id, 'paused')
    const resumed = await application.changeStatus(paused.id, 'doing')
    const waitingReview = await application.changeStatus(resumed.id, 'waiting_review')

    expect(waitingReview.status).toBe('waiting_review')
    expect(application.actionsFor(waitingReview).map((action) => action.status)).toEqual(['doing'])
  })

  it('软删除后无法从应用层读取或继续流转', async () => {
    const { application } = createApplication()
    const item = await application.createIdea({ title: '一次性事项' })

    await application.deleteItem(item.id)

    await expect(application.getItem(item.id)).rejects.toThrow('事项不存在')
    await expect(application.changeStatus(item.id, 'doing')).rejects.toThrow('事项不存在')
    expect(await application.listItems()).toEqual([])
  })
})
