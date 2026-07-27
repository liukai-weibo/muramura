import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BackupData, Item } from '@knowledge-base/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteS2Repository } from '../packages/storage-sqlite/src/index'

const resources: Array<{ dir: string; close: () => void }> = []
const open = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s2-p0-'))
  const bundle = createSqliteS2Repository(path.join(dir, 'candidate.db'))
  resources.push({ dir, close: () => bundle.database.close() })
  return bundle
}
afterEach(() => resources.splice(0).forEach(({ dir, close }) => {
  close()
  fs.rmSync(dir, { recursive: true, force: true })
}))

type RawDatabase = {
  prepare: (sql: string) => {
    run: (...values: unknown[]) => unknown
  }
}
const raw = (database: unknown) => (database as { raw: RawDatabase }).raw
const emptyData = (): BackupData => ({ items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [] })

const addReviewAndLink = (db: RawDatabase, item: Item) => {
  db.prepare("INSERT INTO reviews VALUES ('r',?,'a','r','','','','','','a','a')").run(item.id)
  db.prepare("INSERT INTO item_links VALUES ('link','r',?,'derived_from_review','a')").run(item.id)
}

const createDeletedItemWithReview = async () => {
  const bundle = open()
  const item = await bundle.itemRepository.create({ title: 'target' })
  await bundle.itemRepository.delete(item.id)
  addReviewAndLink(raw(bundle.database), item)
  return { bundle, item }
}

describe('SQLite S2 P0 transaction evidence', () => {
  it('preserves independently committed content and status mutations without stale-object overwrite', async () => {
    const bundle = open()
    const item = await bundle.itemRepository.create({ title: 'x' })
    await bundle.itemRepository.updateContent(item.id, { content: 'new content' })
    await bundle.itemRepository.changeStatus(item.id, 'idea_later')
    expect(await bundle.itemRepository.getById(item.id)).toMatchObject({ content: 'new content', status: 'idea_later' })
    const events = await bundle.itemRepository.listStatusEvents(item.id)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ fromStatus: 'idea_to_try', toStatus: 'idea_later' })
  })

  it('does not revive a deleted item or lose its last content when delete follows content update', async () => {
    const bundle = open()
    const item = await bundle.itemRepository.create({ title: 'x' })
    await bundle.itemRepository.updateContent(item.id, { content: 'keep' })
    await bundle.itemRepository.delete(item.id)
    await expect(bundle.itemRepository.updateContent(item.id, { content: 'lost' })).rejects.toThrow('事项不存在')
    expect(await bundle.itemRepository.getById(item.id)).toMatchObject({ content: 'keep', deletedAt: expect.any(String) })
  })

  it('rolls back start execution completely on event insertion failure', async () => {
    const bundle = open()
    const item = await bundle.itemRepository.create({ title: 'x' })
    const db = raw(bundle.database)
    db.prepare("CREATE TRIGGER fail_start_event BEFORE INSERT ON item_status_events WHEN NEW.to_status = 'doing' BEGIN SELECT RAISE(FAIL, 'fail event'); END").run()
    await expect(bundle.itemRepository.startExecution(item.id, { startAction: 'snapshot' })).rejects.toThrow('fail event')
    const after = await bundle.itemRepository.getById(item.id)
    expect(after?.status).toBe('idea_to_try')
    expect(after?.startAction).toBeUndefined()
    expect(await bundle.itemRepository.listStatusEvents(item.id)).toHaveLength(1)
  })

  it('does not let an isolated tombstone block an unrelated item purge', async () => {
    const bundle = open()
    const item = await bundle.itemRepository.create({ title: 'unrelated' })
    await bundle.itemRepository.delete(item.id)
    const db = raw(bundle.database)
    addReviewAndLink(db, item)
    db.prepare("INSERT INTO method_tombstones VALUES ('method','method','a','[]')").run()

    await bundle.itemRepository.purgeDeletedBefore('9999-12-31')

    expect(await bundle.itemRepository.getById(item.id)).toBeUndefined()
    expect(await bundle.itemRepository.listStatusEvents(item.id)).toEqual([])
    expect(await bundle.backupRepository.exportData()).toEqual(expect.objectContaining({
      items: [],
      reviews: [],
      itemStatusEvents: [],
      itemLinks: [],
      methodTombstones: [{ methodId: 'method', title: 'method', permanentlyDeletedAt: 'a', versions: [] }],
    }))
  })

  it('cleans a method application with its deleted target item after S3 takes over item purge', async () => {
    const { bundle, item } = await createDeletedItemWithReview()
    raw(bundle.database).prepare("INSERT INTO method_applications VALUES ('application','method',1,?,'a')").run(item.id)

    await bundle.itemRepository.purgeDeletedBefore('9999-12-31')

    expect(await bundle.backupRepository.exportData()).toEqual(expect.objectContaining({ items: [], reviews: [], itemStatusEvents: [], itemLinks: [], methodApplications: [] }))
  })

  it('cleans method evidence with its deleted source review after S3 takes over item purge', async () => {
    const { bundle } = await createDeletedItemWithReview()
    raw(bundle.database).prepare("INSERT INTO method_evidence VALUES ('evidence','method','r','a','unknown',NULL)").run()

    await bundle.itemRepository.purgeDeletedBefore('9999-12-31')

    expect(await bundle.backupRepository.exportData()).toEqual(expect.objectContaining({ items: [], reviews: [], itemStatusEvents: [], itemLinks: [], methodEvidence: [] }))
  })

  it('clears a method version source review when its deleted source item is purged', async () => {
    const { bundle } = await createDeletedItemWithReview()
    raw(bundle.database).prepare("INSERT INTO method_versions VALUES ('version','method',1,'','','','','r','a')").run()

    await bundle.itemRepository.purgeDeletedBefore('9999-12-31')

    const backup = await bundle.backupRepository.exportData()
    expect(backup).toMatchObject({ items: [], reviews: [], itemStatusEvents: [], itemLinks: [] })
    expect(backup.methodVersions[0]?.sourceReviewId).toBeUndefined()
  })

  it('replaces all nine backup collections atomically and retains the complete prior backup on a late collection failure', async () => {
    const bundle = open()
    const full = emptyData()
    full.items = [{ id: 'i', title: 'i', content: 'c', status: 'idea_to_try', createdAt: 'a', updatedAt: 'a' }]
    full.reviews = [{ id: 'r', itemId: 'i', actualAction: 'a', result: 'r', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: 'a', updatedAt: 'a' }]
    full.methods = [{ id: 'm', title: 'm', applicable: 'a', unsuitable: '', steps: 's', validationCount: 1, version: 1, createdAt: 'a', updatedAt: 'a' }]
    full.methodVersions = [{ id: 'v', methodId: 'm', version: 1, title: 'm', applicable: 'a', unsuitable: '', steps: 's', createdAt: 'a' }]
    full.methodEvidence = [{ id: 'e', methodId: 'm', reviewId: 'r', createdAt: 'a', relation: 'formation', methodVersion: 1 }]
    full.methodApplications = [{ id: 'ma', methodId: 'm', methodVersion: 1, itemId: 'i', createdAt: 'a' }]
    full.itemStatusEvents = [{ id: 'event', itemId: 'i', toStatus: 'idea_to_try', createdAt: 'a' }]
    full.itemLinks = [{ id: 'link', sourceReviewId: 'r', targetItemId: 'i', type: 'derived_from_review', createdAt: 'a' }]

    await bundle.backupRepository.replaceData(full)
    expect(await bundle.backupRepository.exportData()).toEqual(full)
    const before = await bundle.backupRepository.exportData()
    const invalid = { ...full, itemLinks: [{ ...full.itemLinks[0]!, targetItemId: 'missing' }] }

    await expect(bundle.backupRepository.replaceData(invalid)).rejects.toThrow()

    expect(await bundle.backupRepository.exportData()).toEqual(before)
  })
})
