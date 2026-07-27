import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BackupData, BackupDocument } from '@knowledge-base/contracts'
import { BackupApplicationService } from '@knowledge-base/application'
import { createSqliteS4Repository } from '../packages/storage-sqlite/src/index'

const resources: Array<{ directory: string; close: () => void }> = []
const open = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s5-'))
  const bundle = createSqliteS4Repository(path.join(directory, 'candidate.db'))
  resources.push({ directory, close: () => bundle.database.close() })
  return bundle
}
afterEach(() => resources.splice(0).forEach(({ directory, close }) => { close(); fs.rmSync(directory, { recursive: true, force: true }) }))

const normalize = (data: BackupData) => Object.fromEntries(Object.entries(data).map(([key, records]) => [key, [...records].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))]))
const fullData = (): BackupData => ({
  items: [
    { id: 'item-active', title: 'active', content: 'content', status: 'reviewed', createdAt: 'a', updatedAt: 'b', startAction: 'start' },
    { id: 'item-deleted', title: 'deleted', content: 'deleted content', status: 'abandoned', createdAt: 'a', updatedAt: 'c', deletedAt: 'c' },
    { id: 'item-purged-method', title: 'purged application', content: '', status: 'idea_to_try', createdAt: 'a', updatedAt: 'a' },
  ],
  reviews: [{ id: 'review', itemId: 'item-active', actualAction: 'action', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: 'a', updatedAt: 'b' }],
  methods: [
    { id: 'method-active', title: 'method', applicable: 'when', unsuitable: '', steps: 'step', validationCount: 2, version: 2, createdAt: 'a', updatedAt: 'b', deletedAt: 'b' },
  ],
  methodVersions: [
    { id: 'version-1', methodId: 'method-active', version: 1, title: 'method', applicable: 'when', unsuitable: '', steps: 'old', sourceReviewId: 'review', createdAt: 'a' },
    { id: 'version-2', methodId: 'method-active', version: 2, title: 'method 2', applicable: 'when', unsuitable: '', steps: 'new', createdAt: 'b' },
  ],
  methodEvidence: [{ id: 'evidence', methodId: 'method-active', reviewId: 'review', createdAt: 'a', relation: 'formation', methodVersion: 1 }],
  methodApplications: [
    { id: 'application-active', methodId: 'method-active', methodVersion: 2, itemId: 'item-active', createdAt: 'b' },
    { id: 'application-purged', methodId: 'method-purged', methodVersion: 3, itemId: 'item-purged-method', createdAt: 'a' },
  ],
  itemStatusEvents: [
    { id: 'event-active', itemId: 'item-active', toStatus: 'reviewed', createdAt: 'b' },
    { id: 'event-deleted', itemId: 'item-deleted', fromStatus: 'doing', toStatus: 'abandoned', createdAt: 'c' },
    { id: 'event-purged', itemId: 'item-purged-method', toStatus: 'idea_to_try', createdAt: 'a' },
  ],
  itemLinks: [{ id: 'link', sourceReviewId: 'review', targetItemId: 'item-purged-method', type: 'derived_from_review', createdAt: 'a' }],
  methodTombstones: [{ methodId: 'method-purged', title: 'purged', permanentlyDeletedAt: 'c', versions: [{ version: 1 }, { version: 3 }] }],
})
const document = (data: BackupData, version: 1 | 2 = 2): BackupDocument => ({ format: 'knowledge-base-backup', version, exportedAt: 'now', appVersion: 'test', data })

describe('SQLite S5 backup restore equivalence candidate tests', () => {
  it('round trips all nine v2 collections through parse, SQLite restore, and export with normalized field equivalence', async () => {
    const source = open()
    const target = open()
    const sourceService = new BackupApplicationService(source.backupRepository)
    await source.backupRepository.replaceData(fullData())
    const created = await sourceService.createBackup()
    const parsed = new BackupApplicationService(target.backupRepository).parseAndValidate(JSON.stringify(created))

    await new BackupApplicationService(target.backupRepository).restoreBackup(parsed)

    expect(created.version).toBe(2)
    expect(normalize(await target.backupRepository.exportData())).toEqual(normalize(fullData()))
  })

  it('normalizes v1 missing tombstones, historical optional collections, startAction, and broken optional source review', async () => {
    const bundle = open()
    const legacy = fullData()
    legacy.items = legacy.items.map(({ startAction: _startAction, ...item }) => item)
    legacy.methodTombstones = []
    legacy.methodVersions = []
    legacy.methodApplications = []
    legacy.itemStatusEvents = []
    const raw = document(legacy, 1) as unknown as { data: Record<string, unknown> }
    delete raw.data.methodTombstones
    delete raw.data.methodVersions
    delete raw.data.methodApplications
    delete raw.data.itemStatusEvents
    const parsed = new BackupApplicationService(bundle.backupRepository).parseAndValidate(JSON.stringify(raw))

    await new BackupApplicationService(bundle.backupRepository).restoreBackup(parsed)
    const restored = await bundle.backupRepository.exportData()

    expect(parsed.version).toBe(2)
    expect(restored.methodTombstones).toEqual([])
    expect(restored.items.every(item => item.startAction === undefined)).toBe(true)
    expect(restored.methodVersions).toHaveLength(1)
    expect(restored.methodVersions[0]?.sourceReviewId).toBe('review')
    expect(restored.itemStatusEvents).toHaveLength(restored.items.length)
  })

  it('normalizes a broken optional version source through SQLite restore without creating a Review', async () => {
    const bundle = open()
    const data = fullData()
    data.methodVersions = data.methodVersions.map(version => (
      version.id === 'version-1' ? { ...version, sourceReviewId: 'missing-review' } : version
    ))
    const service = new BackupApplicationService(bundle.backupRepository)

    const parsed = service.parseAndValidate(JSON.stringify(document(data)))
    const parsedVersion = parsed.data.methodVersions.find(version => version.id === 'version-1')
    expect(parsedVersion).toBeDefined()
    expect('sourceReviewId' in parsedVersion!).toBe(false)

    await service.restoreBackup(parsed)
    const restored = await bundle.backupRepository.exportData()
    const restoredVersion = restored.methodVersions.find(version => version.id === 'version-1')
    expect(restoredVersion).toBeDefined()
    expect('sourceReviewId' in restoredVersion!).toBe(false)
    expect(restored.reviews).toEqual(fullData().reviews)
    expect(restored.methods).toEqual(fullData().methods)
    expect(restored.methodEvidence).toEqual(fullData().methodEvidence)
    expect(restored.methodApplications).toEqual(fullData().methodApplications)
  })

  it('rejects invalid documents before restore and preserves existing SQLite data', async () => {
    const bundle = open()
    const service = new BackupApplicationService(bundle.backupRepository)
    await bundle.backupRepository.replaceData(fullData())
    const baseline = await bundle.backupRepository.exportData()
    const invalids: BackupData[] = [
      { ...fullData(), items: [{ ...fullData().items[0]!, id: '' }] },
      { ...fullData(), items: [{ ...fullData().items[0]!, status: 'not-a-status' as never }] },
      { ...fullData(), reviews: [{ ...fullData().reviews[0]!, itemId: 'missing' }] },
      { ...fullData(), methodEvidence: [{ ...fullData().methodEvidence[0]!, methodId: 'missing' }] },
      { ...fullData(), methodEvidence: [{ ...fullData().methodEvidence[0]!, reviewId: 'missing' }] },
      { ...fullData(), methodApplications: [{ ...fullData().methodApplications[0]!, itemId: 'missing' }] },
      { ...fullData(), methodApplications: [{ ...fullData().methodApplications[0]!, methodId: 'missing', methodVersion: 2 }] },
      { ...fullData(), methodApplications: [{ ...fullData().methodApplications[0]!, methodVersion: 99 }] },
      { ...fullData(), itemLinks: [{ ...fullData().itemLinks[0]!, sourceReviewId: 'missing' }] },
      { ...fullData(), itemLinks: [{ ...fullData().itemLinks[0]!, targetItemId: 'missing' }] },
      { ...fullData(), methods: [...fullData().methods, { ...fullData().methods[0]!, id: 'method-purged' }] },
      { ...fullData(), methodTombstones: [{ ...fullData().methodTombstones[0]!, versions: [{ version: 1.5 }] }] },
      { ...fullData(), items: [{ ...fullData().items[0]!, startAction: 1 as unknown as string }] },
      { ...fullData(), items: [{ ...fullData().items[0]! }, { ...fullData().items[0]! }] },
    ]

    for (const data of invalids) {
      expect(() => service.parseAndValidate(JSON.stringify(document(data)))).toThrow()
      expect(await bundle.backupRepository.exportData()).toEqual(baseline)
    }
  })

  it('rolls back final collection failure and preserves system metadata during replacement', async () => {
    const bundle = open()
    const raw = (bundle.database as unknown as { raw: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown; get: () => unknown } } }).raw
    raw.prepare('INSERT INTO system_metadata VALUES(?,?)').run('migration-marker', 'yes')
    await bundle.backupRepository.replaceData(fullData())
    const baseline = await bundle.backupRepository.exportData()
    raw.prepare("CREATE TRIGGER fail_last_link BEFORE INSERT ON item_links BEGIN SELECT RAISE(FAIL, 'last collection failed'); END").run()

    await expect(bundle.backupRepository.replaceData(fullData())).rejects.toThrow('last collection failed')

    expect(await bundle.backupRepository.exportData()).toEqual(baseline)
    expect(raw.prepare("SELECT value FROM system_metadata WHERE key = 'migration-marker'").get()).toEqual({ value: 'yes' })
  })
})
