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

const toWaitingReview = async (bundle: ReturnType<typeof open>, title = '寰呭鐩樹簨椤?) => {
  const item = await bundle.itemRepository.create({ title, content: '浜嬮」璇存槑' })
  await bundle.itemRepository.changeStatus(item.id, 'idea_later')
  await bundle.itemRepository.changeStatus(item.id, 'idea_to_try')
  await bundle.itemRepository.startExecution(item.id)
  return item
}
const input = (itemId: string) => ({ itemId, actualAction: '瀹為檯琛屽姩', result: '缁撴灉', effective: '鏈夋晥', incompatible: '', reason: '', adjustment: '', newIdeas: '娲剧敓鎯虫硶\n琛ュ厖璇存槑' })

describe('SQLite S4 review workflow, search, and dashboard candidate repositories', () => {
  it('completes review with formation, derived item, link, reviewed event, and one transaction', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle)

    const result = await bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '鏂规硶', applicable: '鍦烘櫙', steps: '姝ラ' } })

    expect(result.item).toMatchObject({ id: item.id, status: 'reviewed' })
    expect(result.review).toMatchObject({ itemId: item.id, actualAction: '瀹為檯琛屽姩' })
    expect(result.method).toMatchObject({ title: '鏂规硶', version: 1, validationCount: 1 })
    expect(result.createdIdea).toMatchObject({ title: '娲剧敓鎯虫硶', content: '娲剧敓鎯虫硶\n琛ュ厖璇存槑', status: 'idea_to_try' })
    expect(await bundle.itemRepository.listStatusEvents(item.id)).toMatchObject([{ toStatus: 'idea_to_try' }, { toStatus: 'idea_later' }, { toStatus: 'idea_to_try' }, { toStatus: 'doing' }, { fromStatus: 'doing', toStatus: 'reviewed' }])
    const backup = await bundle.backupRepository.exportData()
    expect(backup.methodEvidence).toMatchObject([{ methodId: result.method?.id, reviewId: result.review.id, relation: 'formation', methodVersion: 1 }])
    expect(backup.itemLinks).toMatchObject([{ sourceReviewId: result.review.id, targetItemId: result.createdIdea?.id, type: 'derived_from_review' }])
  })

  it('completes review by validating and revising an existing method', async () => {
    const bundle = open()
    const source = await toWaitingReview(bundle, '鏉ユ簮')
    const formation = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '鏂规硶', applicable: '鍦烘櫙', steps: '姝ラ' } })
    const validationItem = await toWaitingReview(bundle, '楠岃瘉')
    const validation = await bundle.reviewWorkflowRepository.complete({ ...input(validationItem.id), newIdeas: '', existingMethod: { methodId: formation.method!.id } })
    const revisionItem = await toWaitingReview(bundle, '淇')
    const revision = await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId: formation.method!.id, revision: { title: '鏂规硶 v2', applicable: '鏂板満鏅?, steps: '鏂版楠? } } })

    expect(validation.method).toMatchObject({ version: 1, validationCount: 2 })
    expect(revision.method).toMatchObject({ version: 2, validationCount: 3, title: '鏂规硶 v2' })
    expect((await bundle.methodRepository.listEvidenceDetails(formation.method!.id)).map(entry => [entry.relation, entry.methodVersion])).toEqual([['revision', 2], ['validation', 1], ['formation', 1]])
  })

  it('rolls back every review workflow write when the final reviewed event fails', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle)
    const before = await bundle.backupRepository.exportData()
    const raw = (bundle.database as unknown as { raw: { prepare: (sql: string) => { run: () => unknown } } }).raw
    raw.prepare("CREATE TRIGGER fail_reviewed_event BEFORE INSERT ON item_status_events WHEN NEW.to_status = 'reviewed' BEGIN SELECT RAISE(FAIL, 'final event failed'); END").run()

    await expect(bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '鏂规硶', applicable: '鍦烘櫙', steps: '姝ラ' } })).rejects.toThrow('final event failed')

    expect(await bundle.backupRepository.exportData()).toEqual(before)
  })

  it('rejects non-waiting, deleted, duplicate review, invalid method selection, and conflicting method choices without writes', async () => {
    const bundle = open()
    const nonWaiting = await bundle.itemRepository.create({ title: '鏈緟澶嶇洏' })
    const before = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(nonWaiting.id))).rejects.toThrow('鍙湁宸插紑濮嬫垨寰呭鐩樹簨椤瑰彲浠ュ畬鎴愬鐩?)
    expect(await bundle.backupRepository.exportData()).toEqual(before)

    const deleted = await toWaitingReview(bundle, '宸插垹闄?)
    await bundle.itemRepository.delete(deleted.id)
    const deletedBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(deleted.id))).rejects.toThrow('浜嬮」涓嶅瓨鍦?)
    expect(await bundle.backupRepository.exportData()).toEqual(deletedBefore)

    const complete = await toWaitingReview(bundle, '瀹屾垚')
    await bundle.reviewWorkflowRepository.complete({ ...input(complete.id), newIdeas: '' })
    const duplicateBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete(input(complete.id))).rejects.toThrow('鍙湁宸插紑濮嬫垨寰呭鐩樹簨椤瑰彲浠ュ畬鎴愬鐩?)
    expect(await bundle.backupRepository.exportData()).toEqual(duplicateBefore)

    const conflict = await toWaitingReview(bundle, '鍐茬獊')
    const conflictBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(conflict.id), method: { title: '鏂?, applicable: '鍦烘櫙', steps: '姝ラ' }, existingMethod: { methodId: 'missing' } })).rejects.toThrow('涓嶈兘鍚屾椂褰㈡垚鏂版柟娉曞拰楠岃瘉宸叉湁鏂规硶')
    expect(await bundle.backupRepository.exportData()).toEqual(conflictBefore)
  })

  it('rolls back existing-method paths when the method is missing, in trash, or evidence write fails', async () => {
    const bundle = open()
    const missingItem = await toWaitingReview(bundle, '缂哄け鏂规硶')
    const missingBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(missingItem.id), existingMethod: { methodId: 'missing' } })).rejects.toThrow('閫夋嫨鐨勬柟娉曚笉瀛樺湪')
    expect(await bundle.backupRepository.exportData()).toEqual(missingBefore)

    const source = await toWaitingReview(bundle, '鏂规硶鏉ユ簮')
    const formed = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '鍙洖鏀舵柟娉?, applicable: '鍦烘櫙', steps: '姝ラ' } })
    await bundle.methodRepository.moveToTrash(formed.method!.id)
    const trashItem = await toWaitingReview(bundle, '鍥炴敹绔欐柟娉?)
    const trashBefore = await bundle.backupRepository.exportData()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(trashItem.id), existingMethod: { methodId: formed.method!.id } })).rejects.toThrow('閫夋嫨鐨勬柟娉曚笉瀛樺湪')
    expect(await bundle.backupRepository.exportData()).toEqual(trashBefore)

    await bundle.methodRepository.restore(formed.method!.id)
    const failureItem = await toWaitingReview(bundle, '璇佹嵁澶辫触')
    const failureBefore = await bundle.backupRepository.exportData()
    const raw = (bundle.database as unknown as { raw: { prepare: (sql: string) => { run: () => unknown } } }).raw
    raw.prepare("CREATE TRIGGER fail_method_evidence BEFORE INSERT ON method_evidence BEGIN SELECT RAISE(FAIL, 'evidence failed'); END").run()
    await expect(bundle.reviewWorkflowRepository.complete({ ...input(failureItem.id), existingMethod: { methodId: formed.method!.id } })).rejects.toThrow('evidence failed')
    expect(await bundle.backupRepository.exportData()).toEqual(failureBefore)
  })

  it('excludes trash items and current trash methods while retaining historical version search', async () => {
    const bundle = open()
    const trashItem = await bundle.itemRepository.create({ title: '鍥炴敹浜嬮」鍞竴璇?, content: '鍥炴敹浜嬮」鍐呭鍞竴璇? })
    await bundle.itemRepository.delete(trashItem.id)
    expect(await bundle.searchRepository.search('鍥炴敹浜嬮」鍞竴璇?)).toEqual([])
    expect((await bundle.dashboardRepository.getSnapshot()).items.some(item => item.id === trashItem.id)).toBe(false)

    const source = await toWaitingReview(bundle, '鏂规硶鏉ユ簮')
    const formed = await bundle.reviewWorkflowRepository.complete({ ...input(source.id), newIdeas: '', method: { title: '娲昏穬鏂规硶鍞竴璇?, applicable: '鍦烘櫙', steps: '鍘嗗彶鐗堟湰鍞竴璇? } })
    expect(await bundle.searchRepository.search('娲昏穬鏂规硶鍞竴璇?)).toMatchObject([{ type: 'method', methodId: formed.method!.id }])
    const revisionItem = await toWaitingReview(bundle, '鏂规硶淇')
    await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId: formed.method!.id, revision: { title: '褰撳墠鏂规硶鍞竴璇?, applicable: '褰撳墠鍦烘櫙', steps: '褰撳墠姝ラ鍞竴璇? } } })
    await bundle.methodRepository.moveToTrash(formed.method!.id)

    expect((await bundle.searchRepository.search('褰撳墠姝ラ鍞竴璇?)).filter(result => result.id === `method:${formed.method!.id}`)).toEqual([])
    expect(await bundle.searchRepository.search('鍘嗗彶鐗堟湰鍞竴璇?)).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId: formed.method!.id, methodVersion: 1 }])
    const dashboard = await bundle.dashboardRepository.getSnapshot()
    expect(dashboard.methods.some(method => method.id === formed.method!.id)).toBe(false)
  })

  it('searches active item content, review facts, active methods, and historical versions while dashboard excludes trash', async () => {
    const bundle = open()
    const item = await toWaitingReview(bundle, '妫€绱簨椤?)
    const complete = await bundle.reviewWorkflowRepository.complete({ ...input(item.id), method: { title: '妫€绱㈡柟娉?, applicable: '閫傜敤璇?, steps: '鍘嗗彶姝ラ' } })
    const methodId = complete.method!.id
    const revisionItem = await toWaitingReview(bundle, '淇浜嬮」')
    await bundle.reviewWorkflowRepository.complete({ ...input(revisionItem.id), newIdeas: '', existingMethod: { methodId, revision: { title: '褰撳墠鏂规硶', applicable: '褰撳墠鍦烘櫙', steps: '褰撳墠姝ラ' } } })
    await bundle.methodRepository.moveToTrash(methodId)

    expect((await bundle.searchRepository.search('妫€绱簨椤?)).map(result => result.type)).toContain('item')
    expect((await bundle.searchRepository.search('瀹為檯琛屽姩')).map(result => result.type)).toContain('review')
    expect(await bundle.searchRepository.search('鍘嗗彶姝ラ')).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId, methodVersion: 1 }])
    expect(await bundle.searchRepository.search('褰撳墠姝ラ')).toMatchObject([{ id: expect.stringMatching(/^method-version:/), methodId, methodVersion: 2 }])
    const snapshot = await bundle.dashboardRepository.getSnapshot()
    expect(snapshot.items.some(value => value.id === item.id)).toBe(true)
    expect(snapshot.methods).toEqual([])
    expect(snapshot.reviews).toHaveLength(2)
  })
})
