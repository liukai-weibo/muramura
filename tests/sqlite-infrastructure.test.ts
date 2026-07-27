import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openKnowledgeDatabase, SqliteStorageOpenError } from '../packages/storage-sqlite/src/index'

const directories: string[] = []
function testPath() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-sqlite-tests-')); directories.push(directory); return path.join(directory, 'nested', 'knowledge-base.test.db') }
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

describe('SQLite S1 infrastructure', () => {
  it('uses the real native binding to create, write, close, reopen, and read a temporary database', () => {
    const databasePath = testPath()
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    const raw = new Database(databasePath)
    raw.exec('CREATE TABLE native_probe (value TEXT NOT NULL)')
    raw.prepare('INSERT INTO native_probe VALUES (?)').run('native-ok')
    expect(raw.prepare('SELECT value FROM native_probe').get()).toEqual({ value: 'native-ok' })
    raw.close()
    const reopened = new Database(databasePath, { readonly: true })
    expect(reopened.prepare('SELECT value FROM native_probe').get()).toEqual({ value: 'native-ok' })
    reopened.close()
  })

  it('creates nested directories, applies schema v1 once, preserves data after reopen, and applies PRAGMAs', () => {
    const databasePath = testPath()
    const first = openKnowledgeDatabase({ databasePath })
    expect(first.schemaVersion).toBe(1)
    expect(first.runInReadTransaction(() => first.databasePath)).toBe(databasePath)
    first.runInTransaction(() => { (first as unknown as { raw: Database.Database }).raw.prepare("INSERT INTO system_metadata VALUES ('probe', 'kept')").run() })
    first.close()
    const second = openKnowledgeDatabase({ databasePath })
    const raw = second as unknown as { raw: Database.Database }
    expect(raw.raw.prepare("SELECT value FROM system_metadata WHERE key='probe'").get()).toEqual({ value: 'kept' })
    expect(raw.raw.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }])
    expect(raw.raw.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('items','item_status_events','reviews','methods','method_versions','method_evidence','method_applications','method_tombstones','item_links','system_metadata')").get()).toEqual({ count: 10 })
    expect(raw.raw.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(raw.raw.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(raw.raw.pragma('synchronous', { simple: true })).toBe(2)
    expect(raw.raw.pragma('busy_timeout', { simple: true })).toBe(5000)
    second.close()
    expect(() => fs.rmSync(path.dirname(databasePath), { recursive: true })).not.toThrow()
  })

  it('rolls back a write transaction when its second statement fails and rejects async callbacks', () => {
    const opened = openKnowledgeDatabase({ databasePath: testPath() })
    const raw = opened as unknown as { raw: Database.Database }
    raw.raw.exec('CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    expect(() => opened.runInTransaction(() => { raw.raw.prepare('INSERT INTO transaction_probe VALUES (?, ?)').run(1, 'first'); raw.raw.prepare('INSERT INTO transaction_probe VALUES (?, ?)').run(1, 'second') })).toThrow()
    expect(raw.raw.prepare('SELECT * FROM transaction_probe').all()).toEqual([])
    expect(() => opened.runInTransaction((() => Promise.resolve()) as unknown as () => never)).toThrow('must be synchronous')
    opened.close()
  })

  it('maps controlled migration and quick_check failures without replacing the database file', () => {
    const databasePath = testPath(); fs.mkdirSync(path.dirname(databasePath), { recursive: true }); const openedForMigration = openKnowledgeDatabase({ databasePath }); openedForMigration.close()
    expect(() => openKnowledgeDatabase({ databasePath }, { applySchemaMigrations: () => { throw new Error('migration failure') } })).toThrow(SqliteStorageOpenError)
    try { openKnowledgeDatabase({ databasePath }, { applySchemaMigrations: () => { throw new Error('migration failure') } }) } catch (error) { expect((error as SqliteStorageOpenError).code).toBe('schema-migration-failed') }
    const valid = testPath(); const opened = openKnowledgeDatabase({ databasePath: valid }); opened.close(); const before = fs.readFileSync(valid)
    try { openKnowledgeDatabase({ databasePath: valid }, { quickCheck: () => { throw new Error('not ok') } }) } catch (error) { expect((error as SqliteStorageOpenError).code).toBe('integrity-check-failed') }
    expect(fs.readFileSync(valid)).toEqual(before)
  })

  it('enforces frozen DDL uniqueness, status and foreign-key boundaries while allowing historical method references', () => {
    const opened = openKnowledgeDatabase({ databasePath: testPath() }); const raw = opened as unknown as { raw: Database.Database }; const db = raw.raw
    expect(() => db.prepare("INSERT INTO items VALUES ('x','t','','invalid','a','a',NULL,NULL)").run()).toThrow()
    db.prepare("INSERT INTO items VALUES ('i','t','','idea_to_try','a','a',NULL,NULL)").run()
    db.prepare("INSERT INTO reviews VALUES ('r','i','a','r','','','','','','a','a')").run()
    expect(() => db.prepare("INSERT INTO reviews VALUES ('r2','i','a','r','','','','','','a','a')").run()).toThrow()
    db.prepare("INSERT INTO method_applications VALUES ('a','missing-method',1,'i','a')").run()
    expect(() => db.prepare("INSERT INTO method_applications VALUES ('a2','other',1,'i','a')").run()).toThrow()
    db.prepare("INSERT INTO method_versions VALUES ('v','missing-method',1,'t','','','','','a')").run()
    expect(() => db.prepare("INSERT INTO method_versions VALUES ('v2','missing-method',1,'t','','','','','a')").run()).toThrow()
    db.prepare("INSERT INTO method_tombstones VALUES ('missing-method','t','a','[]')").run()
    db.prepare("INSERT INTO method_evidence VALUES ('e','missing-method','missing-review','a','unknown',NULL)").run()
    expect(() => db.prepare("INSERT INTO item_status_events VALUES ('event','absent',NULL,'doing','a')").run()).toThrow()
    opened.close()
  })
})
