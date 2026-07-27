import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BackupData } from '@knowledge-base/contracts'
import { createSqliteS2Repository } from '../packages/storage-sqlite/src/index'

const dirs: string[] = []
const bundle = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-s2-backup-'))
  dirs.push(dir)
  return createSqliteS2Repository(path.join(dir, 'db.sqlite'))
}
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

const data: BackupData = {
  items: [{ id: 'item', title: 'title', content: 'content', status: 'idea_to_try', createdAt: 'a', updatedAt: 'b', deletedAt: 'c', startAction: 'start' }],
  reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [],
  methodTombstones: [{ methodId: 'gone', title: 'gone', permanentlyDeletedAt: 'd', versions: [{ version: 1 }] }],
}

describe('SQLite S2 Backup repository', () => {
  it('round trips all BackupData fields while preserving the system metadata value', async () => {
    const b = bundle()
    const raw = (b.database as unknown as { raw: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown; get: () => unknown } } }).raw
    raw.prepare('INSERT INTO system_metadata VALUES(?,?)').run('migration-marker', 'yes')

    await b.backupRepository.replaceData(data)

    expect(await b.backupRepository.exportData()).toEqual(data)
    expect(raw.prepare("SELECT value FROM system_metadata WHERE key = 'migration-marker'").get()).toEqual({ value: 'yes' })
    b.database.close()
  })

  it('rolls back replace on invalid references', async () => {
    const b = bundle()
    await b.backupRepository.replaceData(data)
    const broken = { ...data, itemStatusEvents: [{ id: 'event', itemId: 'missing', toStatus: 'doing' as const, createdAt: 'a' }] }

    await expect(b.backupRepository.replaceData(broken)).rejects.toThrow()

    expect(await b.backupRepository.exportData()).toEqual(data)
    b.database.close()
  })
})
