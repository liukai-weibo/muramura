import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteS2Repository } from '../packages/storage-sqlite/src/index'

const bundles: Array<{ directory: string; close: () => void }> = []
const bundle = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s2-'))
  const value = createSqliteS2Repository(path.join(directory, 'db.sqlite'))
  bundles.push({ directory, close: () => value.database.close() })
  return value
}
afterEach(() => bundles.splice(0).forEach(({ directory, close }) => { close(); fs.rmSync(directory, { recursive: true, force: true }) }))

describe('SQLite S2 Item and Review repositories', () => {
  it('persists item state, start action, content and events atomically', async () => {
    const b = bundle()
    const created = await b.itemRepository.create({ title: ' item ', content: ' note ', status: 'idea_to_try' })
    expect(created.title).toBe('item')
    expect((await b.itemRepository.listStatusEvents(created.id)).map(x => x.toStatus)).toEqual(['idea_to_try'])
    const started = await b.itemRepository.startExecution(created.id, { startAction: ' begin ' })
    expect(started.startAction).toBe('begin')
    const updated = await b.itemRepository.updateContent(created.id, { content: ' changed ' })
    expect(updated.content).toBe('changed')
    expect((await b.itemRepository.listStatusEvents(created.id)).map(x => x.toStatus)).toEqual(['idea_to_try', 'doing'])
    await b.itemRepository.delete(created.id)
    await expect(b.itemRepository.updateContent(created.id, { content: 'x' })).rejects.toThrow('事项不存在')
    expect((await b.itemRepository.restore(created.id)).content).toBe('changed')
  })

  it('rejects invalid writes and supports base review contract', async () => {
    const b = bundle()
    await expect(b.itemRepository.create({ title: '  ' })).rejects.toThrow('标题不能为空')
    const created = await b.itemRepository.create({ title: 'item' })
    const review = await b.reviewRepository.create({ itemId: created.id, actualAction: ' act ', result: ' result ', effective: '', incompatible: '', reason: '', adjustment: '' })
    expect(review.actualAction).toBe('act')
    expect(await b.reviewRepository.getByItemId(created.id)).toEqual(review)
    await expect(b.reviewRepository.create({ itemId: created.id, actualAction: 'a', result: 'r', effective: '', incompatible: '', reason: '', adjustment: '' })).rejects.toThrow('已经完成复盘')
    await b.reviewRepository.delete(review.id)
    expect(await b.reviewRepository.getById(review.id)).toBeUndefined()
  })

  it('purges unassociated items and leaves S3 method relation cleanup to the S3 lifecycle suite', async () => {
    const b = bundle()
    const created = await b.itemRepository.create({ title: 'old' })
    await b.itemRepository.delete(created.id)

    await b.itemRepository.purgeDeletedBefore('9999-12-31')

    expect(await b.itemRepository.getById(created.id)).toBeUndefined()
  })
})
