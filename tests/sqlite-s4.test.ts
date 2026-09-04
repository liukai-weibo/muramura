import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteS4Repository } from '../packages/storage-sqlite/src/index'

const resources: Array<{ directory: string; close: () => void }> = []
const open = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s4-'))
  const bundle = createSqliteS4Repository(path.join(directory, 'candidate.db'))
  resources.push({ directory, close: () => bundle.database.close() })
  return bundle
}
afterEach(() => resources.splice(0).forEach(({ directory, close }) => { close(); fs.rmSync(directory, { recursive: true, force: true }) }))

const toWaitingReview = async (bundle: ReturnType<typeof open>, title = '待复盘事项') => {
  const item = await bundle.itemRepository.create({ title, content: '事项说明', status: 'doing' })
  return item
}
const input = (itemId: string) => ({ itemId, actualAction: '实际行动', result: '结果', effective: '有效', incompatible: '', reason: '', adjustment: '', newIdeas: '派生想法\n补充说明' })

describe('SQLite S4 review workflow, search, and dashboard candidate repositories', () => {
  it('completes review with formation, derived item, link, reviewed event, and one transaction', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle)

    const result = await bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '方法', applicable: '场景', steps: '步骤' } })

    expect(result.item).toMatchObject({ id: item.id, status: 'reviewed' })
    expect(result.review).toMatchObject({ itemId: item.id, actualAction: '实际行动' })
    expect(result.method).toMatchObject({ title: '方法', version: 1, validationCount: 1 })
    expect(result.createdIdea).toMatchObject({ title: '派生想法', content: '派生想法\n补充说明', status: 'doing' })
    expect(await bundle.itemRepository.listStatusEvents(item.id)).toMatchObject([{ toStatus: 'doing' }, { fromStatus: 'doing', toStatus: 'reviewed' }])
    const backup = await bundle.backupRepository.exportData()
    expect(backup.methodEvidence).toMatchObject([{ methodId: result.method?.id, reviewId: result.review.id, relation: 'formation', methodVersion: 1 }])
    expect(backup.itemLinks).toMatchObject([{ sourceReviewId: result.review.id, targetItemId: result.createdIdea?.id, type: 'derived_from_review' }])
  })

  it('completes review by validating and revising an existing method', async () => {
    const bundle = open()
    const source = await toWaitingReview(bundle, '来源')
    const formation = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '方法', applicable: '场景', steps: '步骤' } })
    const validationItem = await toWaitingReview(bundle, '验证')
    const validation = await bundle.reviewWorkflowRepository.complete({ ...input(validationItem.id), newIdeas: '', existingMethod: { methodId: formation.method!.id } })
    const revisionItem = await toWaitingReview(bundle, '修订')
    const revision = await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId: formation.method!.id, revision: { title: '方法 v2', applicable: '新场景', steps: '新步骤' } } })

    expect(validation.method).toMatchObject({ version: 1, validationCount: 2 })
    expect(revision.method).toMatchObject({ version: 2, validationCount: 3, title: '方法 v2' })
    expect((await bundle.methodRepository.listEvidenceDetails(formation.method!.id)).map(entry => [entry.relation, entry.methodVersion])).toEqual([['revision', 2], ['validation', 1], ['formation', 1]])
  })

  it('rolls back every review workflow write when the final reviewed event fails', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle)
    const before = await bundle.backupRepository.exportData()
    const raw = (bundle.database as unknown as { raw: { prepare: (sql: string) => { run: () => unknown } } }).raw
    raw.prepare("CREATE TRIGGER fail_reviewed_event BEFORE INSERT ON item_status_events WHEN NEW.to_status = 'reviewed' BEGIN SELECT RAISE(FAIL, 'final event failed'); END").run()

    await expect(bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '方法', applicable: '场景', steps: '步骤' } })).rejects.toThrow('final event failed')

    expect(await bundle.backupRepository.exportData()).toEqual(before)
  })

  it('rejects non-waiting, deleted, duplicate review, invalid method selection, and conflicting method choices without writes', async () => {
    const bundle = open()
    const nonWaiting = await bundle.itemRepository.create({ title: '未待复盘', status: 'idea_to_try' })
    const before = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(nonWaiting.id))).rejects.toThrow('只有进行中事项可以完成复盘')
    expect(await bundle.backupRepository.exportData()).toEqual(before)

    const deleted = await toWaitingReview(bundle, '已删除')
    await bundle.itemRepository.delete(deleted.id)
    const deletedBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(deleted.id))).rejects.toThrow('事项不存在')
    expect(await bundle.backupRepository.exportData()).toEqual(deletedBefore)

    const complete = await toWaitingReview(bundle, '完成')
    await bundle.reviewWorkflowRepository.complete({ ...input(complete.id), newIdeas: '' })
    const duplicateBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(complete.id))).rejects.toThrow('该事项已经完成复盘')
    expect(await bundle.backupRepository.exportData()).toEqual(duplicateBefore)

    const conflict = await toWaitingReview(bundle, '冲突')
    const conflictBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(conflict.id), method: { title: '新', applicable: '场景', steps: '步骤' }, existingMethod: { methodId: 'missing' } })).rejects.toThrow('不能同时形成新方法和验证已有方法')
    expect(await bundle.backupRepository.exportData()).toEqual(conflictBefore)
  })

  it('rolls back existing-method paths when the method is missing, in trash, or evidence write fails', async () => {
    const bundle = open()
    const missingItem = await toWaitingReview(bundle, '缺失方法')
    const missingBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(missingItem.id), existingMethod: { methodId: 'missing' } })).rejects.toThrow('选择的方法不存在')
    expect(await bundle.backupRepository.exportData()).toEqual(missingBefore)

    const source = await toWaitingReview(bundle, '方法来源')
    const formed = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '可回收方法', applicable: '场景', steps: '步骤' } })
    await bundle.methodRepository.moveToTrash(formed.method!.id)
    const trashItem = await toWaitingReview(bundle, '回收站方法')
    const trashBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(trashItem.id), existingMethod: { methodId: formed.method!.id } })).rejects.toThrow('选择的方法不存在')
    expect(await bundle.backupRepository.exportData()).toEqual(trashBefore)

    await bundle.methodRepository.restore(formed.method!.id)
    const failureItem = await toWaitingReview(bundle, '证据失败')
    const failureBefore = await bundle.backupRepository.exportData()
    const raw = (bundle.database as unknown as { raw: { prepare: (sql: string) => { run: () => unknown } } }).raw
    raw.prepare("CREATE TRIGGER fail_method_evidence BEFORE INSERT ON method_evidence BEGIN SELECT RAISE(FAIL, 'evidence failed'); END").run()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(failureItem.id), existingMethod: { methodId: formed.method!.id } })).rejects.toThrow('evidence failed')
    expect(await bundle.backupRepository.exportData()).toEqual(failureBefore)
  })

  it('excludes trash items and current trash methods while retaining historical version search', async () => {
    const bundle = open()
    const trashItem = await bundle.itemRepository.create({ title: '回收事项唯一词', content: '回收事项内容唯一词' })
    await bundle.itemRepository.delete(trashItem.id)
    expect(await bundle.searchRepository.search('回收事项唯一词')).toEqual([])
    expect((await bundle.dashboardRepository.getSnapshot()).items.some(item => item.id === trashItem.id)).toBe(false)

    const source = await toWaitingReview(bundle, '方法来源')
    const formed = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '活跃方法唯一词', applicable: '场景', steps: '历史版本唯一词' } })
    expect(await bundle.searchRepository.search('活跃方法唯一词')).toMatchObject([{ type: 'method', methodId: formed.method!.id }])
    const revisionItem = await toWaitingReview(bundle, '方法修订')
    await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId: formed.method!.id, revision: { title: '当前方法唯一词', applicable: '当前场景', steps: '当前步骤唯一词' } } })
    await bundle.methodRepository.moveToTrash(formed.method!.id)

    expect((await bundle.searchRepository.search('当前步骤唯一词')).filter(result => result.id === `method:${formed.method!.id}`)).toEqual([])
    expect(await bundle.searchRepository.search('历史版本唯一词')).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId: formed.method!.id, methodVersion: 1 }])
    const dashboard = await bundle.dashboardRepository.getSnapshot()
    expect(dashboard.methods.some(method => method.id === formed.method!.id)).toBe(false)
  })

  it('searches active item content, review facts, active methods, and historical versions while dashboard excludes trash', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle, '检索事项')
    const complete = await bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '检索方法', applicable: '适用词', steps: '历史步骤' } })
    const methodId = complete.method!.id
    const revisionItem = await toWaitingReview(bundle, '修订事项')
    await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId, revision: { title: '当前方法', applicable: '当前场景', steps: '当前步骤' } } })
    await bundle.methodRepository.moveToTrash(methodId)

    expect((await bundle.searchRepository.search('检索事项')).map(result => result.type)).toContain('item')
    expect((await bundle.searchRepository.search('实际行动')).map(result => result.type)).toContain('review')
    expect(await bundle.searchRepository.search('历史步骤')).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId, methodVersion: 1 }])
    expect(await bundle.searchRepository.search('当前步骤')).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId, methodVersion: 2 }])
    const snapshot = await bundle.dashboardRepository.getSnapshot()
    expect(snapshot.items.some(value => value.id === item.id)).toBe(true)
    expect(snapshot.methods).toEqual([])
    expect(snapshot.reviews).toHaveLength(2)
  })
})
