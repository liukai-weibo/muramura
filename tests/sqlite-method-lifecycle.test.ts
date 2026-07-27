import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteS3Repository } from '../packages/storage-sqlite/src/index'

const bundles: Array<{ dir: string; close: () => void }> = []
const open = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s3-'))
  const bundle = createSqliteS3Repository(path.join(dir, 'candidate.db'))
  bundles.push({ dir, close: () => bundle.database.close() })
  return bundle
}
afterEach(() => bundles.splice(0).forEach(({ close, dir }) => { close(); fs.rmSync(dir, { recursive: true, force: true }) }))

type Raw = { prepare: (sql: string) => { run: (...values: unknown[]) => unknown } }
const raw = (database: unknown) => (database as { raw: Raw }).raw
const review = (itemId: string) => ({ itemId, actualAction: '执行', result: '结果', effective: '', incompatible: '', reason: '', adjustment: '' })

describe('SQLite S3 method lifecycle candidate repositories', () => {
  it('forms, validates, and revises a method with fixed evidence relation and version facts', async () => {
    const bundle = open()
    const item = await bundle.itemRepository.create({ title: 'item' })
    const firstReview = await bundle.reviewRepository.create(review(item.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, firstReview.id)
    const secondItem = await bundle.itemRepository.create({ title: 'item 2' })
    const secondReview = await bundle.reviewRepository.create(review(secondItem.id))
    await bundle.methodRepository.validateFromReview(method.id, secondReview.id)
    const thirdItem = await bundle.itemRepository.create({ title: 'item 3' })
    const thirdReview = await bundle.reviewRepository.create(review(thirdItem.id))
    const revised = await bundle.methodRepository.validateFromReview(method.id, thirdReview.id, { title: 'method v2', applicable: 'when', steps: 'new step' })

    expect(revised).toMatchObject({ version: 2, validationCount: 3, title: 'method v2' })
    expect(await bundle.methodRepository.listVersions(method.id)).toMatchObject([{ version: 1, sourceReviewId: firstReview.id }, { version: 2, sourceReviewId: thirdReview.id }])
    expect((await bundle.methodRepository.listEvidenceDetails(method.id)).map(({ relation, methodVersion }) => ({ relation, methodVersion }))).toEqual([{ relation: 'revision', methodVersion: 2 }, { relation: 'validation', methodVersion: 1 }, { relation: 'formation', methodVersion: 1 }])
  })

  it('keeps frozen application context across trash, restore, and permanent purge', async () => {
    const bundle = open()
    const source = await bundle.itemRepository.create({ title: 'source' })
    const sourceReview = await bundle.reviewRepository.create(review(source.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, sourceReview.id)
    const item = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'derived' })

    expect(await bundle.methodApplicationRepository.getContextResultByItemId(item.id)).toMatchObject({ status: 'available' })
    await bundle.methodRepository.moveToTrash(method.id)
    expect(await bundle.methodApplicationRepository.getContextResultByItemId(item.id)).toMatchObject({ status: 'method-in-trash' })
    await expect(bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'blocked' })).rejects.toThrow('选择的方法不存在')
    await bundle.methodRepository.restore(method.id)
    expect(await bundle.methodApplicationRepository.getContextResultByItemId(item.id)).toMatchObject({ status: 'available' })
    await bundle.methodRepository.moveToTrash(method.id)
    await bundle.methodRepository.purgeDeletedBefore('9999-12-31')
    expect(await bundle.methodRepository.listVersions(method.id)).toEqual([])
    expect(await bundle.methodApplicationRepository.getContextResultByItemId(item.id)).toMatchObject({ status: 'method-purged', tombstone: { methodId: method.id, versions: [{ version: 1 }] } })
  })

  it('rolls back permanent purge if a frozen application version cannot be proven', async () => {
    const bundle = open()
    const source = await bundle.itemRepository.create({ title: 'source' })
    const sourceReview = await bundle.reviewRepository.create(review(source.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, sourceReview.id)
    const applicationItem = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'derived' })
    await bundle.methodRepository.moveToTrash(method.id)
    raw(bundle.database).prepare('UPDATE method_applications SET method_version=99 WHERE item_id=?').run(applicationItem.id)

    await expect(bundle.methodRepository.purgeDeletedBefore('9999-12-31')).rejects.toThrow('方法应用引用了无法证明的历史版本')

    expect(await bundle.methodRepository.listDeleted()).toMatchObject([{ id: method.id }])
    expect(await bundle.methodRepository.listVersions(method.id)).toHaveLength(1)
    expect(await bundle.methodApplicationRepository.getContextResultByItemId(applicationItem.id)).toMatchObject({ status: 'unavailable' })
  })

  it('rejects nonexistent review evidence without writing a method, version, evidence, or mutation', async () => {
    const bundle = open()
    const before = await bundle.backupRepository.exportData()

    await expect(bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, 'missing-review')).rejects.toThrow('关联复盘不存在')

    expect(await bundle.backupRepository.exportData()).toEqual(before)
    const item = await bundle.itemRepository.create({ title: 'item' })
    const currentReview = await bundle.reviewRepository.create(review(item.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, currentReview.id)
    const established = await bundle.backupRepository.exportData()

    await expect(bundle.methodRepository.validateFromReview(method.id, 'missing-review')).rejects.toThrow('关联复盘不存在')
    await expect(bundle.methodRepository.validateFromReview(method.id, 'missing-review', { title: 'revision', applicable: 'when', steps: 'step' })).rejects.toThrow('关联复盘不存在')

    expect(await bundle.backupRepository.exportData()).toEqual(established)
    await bundle.reviewRepository.delete(currentReview.id)
    const afterReviewDeletion = await bundle.backupRepository.exportData()
    await expect(bundle.methodRepository.validateFromReview(method.id, currentReview.id)).rejects.toThrow('关联复盘不存在')
    expect(await bundle.backupRepository.exportData()).toEqual(afterReviewDeletion)
  })

  it('returns complete batch source displays with trusted titles for lifecycle and unavailable states', async () => {
    const bundle = open()
    const source = await bundle.itemRepository.create({ title: 'source' })
    const sourceReview = await bundle.reviewRepository.create(review(source.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, sourceReview.id)
    const available = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'available' })
    const inTrash = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'trash' })
    const versionMissing = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'version-missing' })
    const methodMissing = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'method-missing' })
    const bothMissing = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'both-missing' })
    const unrelated = await bundle.itemRepository.create({ title: 'unrelated' })
    const db = raw(bundle.database)

    db.prepare('DELETE FROM method_versions WHERE method_id=? AND version=1').run(method.id)
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([versionMissing.id])).toEqual([{ status: 'unavailable', itemId: versionMissing.id, title: 'method' }])
    db.prepare("INSERT INTO method_versions VALUES ('v',?,1,'frozen title','when','','step',NULL,'a')").run(method.id)
    db.prepare('DELETE FROM methods WHERE id=?').run(method.id)
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([methodMissing.id])).toEqual([{ status: 'unavailable', itemId: methodMissing.id, title: 'frozen title' }])
    db.prepare('DELETE FROM method_versions WHERE method_id=?').run(method.id)
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([bothMissing.id])).toEqual([{ status: 'unavailable', itemId: bothMissing.id }])

    db.prepare("INSERT INTO methods VALUES (?, 'method', 'when', '', 'step', 1, 1, 'a', 'a', NULL)").run(method.id)
    db.prepare("INSERT INTO method_versions VALUES ('v2',?,1,'method','when','','step',NULL,'a')").run(method.id)
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([available.id])).toEqual([{ status: 'available', itemId: available.id, title: 'method' }])
    await bundle.methodRepository.moveToTrash(method.id)
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([inTrash.id])).toEqual([{ status: 'method-in-trash', itemId: inTrash.id, title: 'method' }])
    await bundle.methodRepository.purgeDeletedBefore('9999-12-31')
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([available.id])).toEqual([{ status: 'method-purged', itemId: available.id, title: 'method' }])
    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([unrelated.id])).toEqual([{ status: 'no-association', itemId: unrelated.id }])
  })

  it('purges item method relations atomically and removes the final unreferenced tombstone', async () => {
    const bundle = open()
    const source = await bundle.itemRepository.create({ title: 'source' })
    const sourceReview = await bundle.reviewRepository.create(review(source.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, sourceReview.id)
    const applicationItem = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'derived' })
    await bundle.methodRepository.moveToTrash(method.id)
    await bundle.methodRepository.purgeDeletedBefore('9999-12-31')
    await bundle.itemRepository.delete(source.id)
    await bundle.itemRepository.delete(applicationItem.id)

    await bundle.itemRepository.purgeDeletedBefore('9999-12-31')

    const backup = await bundle.backupRepository.exportData()
    expect(backup.items).toEqual([])
    expect(backup.reviews).toEqual([])
    expect(backup.methodEvidence).toEqual([])
    expect(backup.methodApplications).toEqual([])
    expect(backup.methodTombstones).toEqual([])
  })

  it('returns a batch source display from only structural application, version, method, and tombstone facts', async () => {
    const bundle = open()
    const source = await bundle.itemRepository.create({ title: 'source' })
    const sourceReview = await bundle.reviewRepository.create(review(source.id))
    const method = await bundle.methodRepository.createFromReview({ title: 'method', applicable: 'when', steps: 'step' }, sourceReview.id)
    const derived = await bundle.methodApplicationRepository.createItem({ methodId: method.id, title: 'derived' })
    const unrelated = await bundle.itemRepository.create({ title: 'unrelated' })

    expect(await bundle.methodApplicationRepository.listSourceDisplaysForItems([derived.id, unrelated.id, derived.id])).toEqual([{ status: 'available', itemId: derived.id, title: 'method' }, { status: 'no-association', itemId: unrelated.id }])
  })
})
