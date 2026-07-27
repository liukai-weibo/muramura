import { afterEach, describe, expect, it } from 'vitest'
import { canTransition } from '@knowledge-base/domain'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('事项状态机', () => {
  it('允许想法进入执行，不允许直接变成已复盘', () => {
    expect(canTransition('idea_to_try', 'doing')).toBe(true)
    expect(canTransition('idea_to_try', 'reviewed')).toBe(false)
  })

  it('公共状态流转不再创建待复盘，历史状态仅由复盘工作流兼容', () => {
    expect(canTransition('doing', 'waiting_review')).toBe(false)
    expect(canTransition('idea_later', 'waiting_review')).toBe(false)
  })
})

describe('IndexedDB Repository', () => {
  it('可以新增、读取、流转和软删除事项', async () => {
    const storage = createIndexedDbRepository(`test-${crypto.randomUUID()}`)
    databases.push(storage.database)

    const item = await storage.repository.create({ title: '学习瘦金体' })
    expect((await storage.repository.list()).map((entry) => entry.title)).toEqual(['学习瘦金体'])

    const doing = await storage.repository.changeStatus(item.id, 'doing')
    expect(doing.status).toBe('doing')

    await storage.repository.delete(item.id)
    expect(await storage.repository.list()).toEqual([])
    expect((await storage.repository.getById(item.id))?.deletedAt).toBeTruthy()
  })

  it('拒绝非法状态变化', async () => {
    const storage = createIndexedDbRepository(`test-${crypto.randomUUID()}`)
    databases.push(storage.database)
    const item = await storage.repository.create({ title: '不能跳步' })

    await expect(storage.repository.changeStatus(item.id, 'reviewed')).rejects.toThrow('不允许从')
  })
})
