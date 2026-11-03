import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dailyNoteClock } from '@knowledge-base/contracts'
import {
  createMySqlPool,
  readMySqlConfig,
  runMySqlMigrations,
  MySqlDailyNoteRepository,
  type MySqlConnectionConfig,
} from '../packages/storage-mysql/src/index'
import type { CurrentUserScope } from '@knowledge-base/contracts'

const requiredEnvironment = [
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_MIGRATOR_USER',
  'MYSQL_MIGRATOR_PASSWORD',
  'MYSQL_APP_USER',
  'MYSQL_APP_PASSWORD',
  'MYSQL_ROOT_PASSWORD',
]
const mysqlIntegrationEnabled = requiredEnvironment.every(name => Boolean(process.env[name]))
const baseConfig = mysqlIntegrationEnabled ? readMySqlConfig(process.env, 'app') : undefined
const migrationsDirectory = path.resolve(__dirname, '..', 'migrations')

/** 只拷贝到指定版本为止的迁移，用于构造「迁移 034 之前」的历史库。 */
function createMigrationDirectory(upToVersion = 999): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-base-daily-note-'))
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    if (Number(file.slice(0, 3)) > upToVersion) continue
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(directory, file))
  }
  return directory
}

async function withTemporaryDatabase(work: (pools: { app: ReturnType<typeof createMySqlPool>; migrator: ReturnType<typeof createMySqlPool> }) => Promise<void>): Promise<void> {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const database = `kb_dne_${suffix}`
  const appUser = `kbndea_${suffix.slice(0, 20)}`
  const migratorUser = `kbndem_${suffix.slice(0, 20)}`
  const appPassword = crypto.randomUUID()
  const migratorPassword = crypto.randomUUID()
  const rootConfig: MySqlConnectionConfig = { host: baseConfig!.host, port: baseConfig!.port, database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 }
  const root = createMySqlPool(rootConfig)
  let app: ReturnType<typeof createMySqlPool> | undefined
  let migrator: ReturnType<typeof createMySqlPool> | undefined
  try {
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    await root.query('FLUSH PRIVILEGES')
    app = createMySqlPool({ ...baseConfig!, database, user: appUser, password: appPassword, connectionLimit: 1 })
    migrator = createMySqlPool({ ...baseConfig!, database, user: migratorUser, password: migratorPassword, connectionLimit: 1 })
    await work({ app, migrator })
  } finally {
    await app?.end()
    await migrator?.end()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.query(`DROP USER IF EXISTS '${appUser}'@'%'`)
    await root.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`)
    await root.end()
  }
}

function scope(userId: string): CurrentUserScope { return { userId } }

async function seedUser(migrator: ReturnType<typeof createMySqlPool>, id: string): Promise<void> {
  await migrator.query("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, 'scrypt$redacted', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [id, id])
}

async function seedNote(migrator: ReturnType<typeof createMySqlPool>, owner: string, entryDate: string, content: string): Promise<string> {
  const id = crypto.randomUUID()
  await migrator.query("INSERT INTO daily_notes(id, owner_user_id, entry_date, content, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [id, owner, entryDate, content])
  return id
}

/** 条目的东八区时钟标签，用来断言「时间真的落在这一刻」而不依赖时段编号。 */
function clockLabel(recordedAt: string): string {
  return dailyNoteClock(recordedAt)!.label
}

describe.runIf(mysqlIntegrationEnabled)('daily note entries MySQL repository', () => {
  it('converts legacy content into one day-precision entry without rewriting the text', async () => {
    await withTemporaryDatabase(async ({ migrator }) => {
      // 先只跑到 033，写入一篇历史手记，再应用 034，验证旧数据搬运结果。
      await runMySqlMigrations(migrator, createMigrationDirectory(33))
      await seedUser(migrator, 'legacy-owner')
      const legacyText = '14:23\n开了周会\n\n22:05\n读完一章'
      const noteId = await seedNote(migrator, 'legacy-owner', '2026-09-01', legacyText)
      await runMySqlMigrations(migrator, createMigrationDirectory(34))
      const [rows] = await migrator.query<any[]>("SELECT content, time_precision, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date FROM daily_note_entries WHERE daily_note_id=?", [noteId])
      expect(rows).toHaveLength(1)
      expect(rows[0].content).toBe(legacyText)
      expect(rows[0].time_precision).toBe('day')
      expect(rows[0].entry_date).toBe('2026-09-01')
    })
  })

  it('skips empty legacy notes and stays idempotent', async () => {
    await withTemporaryDatabase(async ({ migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory(33))
      await seedUser(migrator, 'legacy-owner')
      const emptyNote = await seedNote(migrator, 'legacy-owner', '2026-09-02', '   ')
      const filledNote = await seedNote(migrator, 'legacy-owner', '2026-09-03', '有正文')
      await runMySqlMigrations(migrator, createMigrationDirectory(34))
      await runMySqlMigrations(migrator, createMigrationDirectory(34))
      const [empty] = await migrator.query<any[]>('SELECT id FROM daily_note_entries WHERE daily_note_id=?', [emptyNote])
      const [filled] = await migrator.query<any[]>('SELECT id FROM daily_note_entries WHERE daily_note_id=?', [filledNote])
      expect(empty).toHaveLength(0)
      expect(filled).toHaveLength(1)
    })
  })

  it('drops the obsolete slot column and keeps the entries it carried', async () => {
    await withTemporaryDatabase(async ({ migrator }) => {
      // 在 034 上留几条带 slot_index 的记录，再应用 035，确认删列不丢数据。
      // （034 的旧数据搬运只在它自己执行时跑，所以这里直接写入带 slot_index 的行。）
      await runMySqlMigrations(migrator, createMigrationDirectory(34))
      await seedUser(migrator, 'legacy-owner')
      const noteId = await seedNote(migrator, 'legacy-owner', '2026-09-04', '有正文')
      await migrator.query(`INSERT INTO daily_note_entries(id, owner_user_id, daily_note_id, entry_date, slot_index, recorded_at, time_precision, content, created_at, updated_at)
        VALUES (?, 'legacy-owner', ?, '2026-09-04', 1, '2026-09-03 18:00:00.000', 'day', '有正文', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [crypto.randomUUID(), noteId])
      const [before] = await migrator.query<any[]>('SHOW COLUMNS FROM daily_note_entries LIKE ?', ['slot_index'])
      expect(before).toHaveLength(1)

      await runMySqlMigrations(migrator, createMigrationDirectory())
      await runMySqlMigrations(migrator, createMigrationDirectory())
      const [after] = await migrator.query<any[]>('SHOW COLUMNS FROM daily_note_entries LIKE ?', ['slot_index'])
      expect(after).toHaveLength(0)
      const [rows] = await migrator.query<any[]>('SELECT content, time_precision FROM daily_note_entries WHERE daily_note_id=?', [noteId])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ content: '有正文', time_precision: 'day' })
      // 外键仍在：删手记会级联删掉条目
      await migrator.query('DELETE FROM daily_notes WHERE id=?', [noteId])
      const [left] = await migrator.query<any[]>('SELECT id FROM daily_note_entries WHERE daily_note_id=?', [noteId])
      expect(left).toHaveLength(0)
    })
  })

  it('creates entries with minute precision at the requested Shanghai minute', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const noteId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      const created = await repository.createEntry(noteId, { content: '开了周会', recordedAt: '14:23' })
      expect(created).toMatchObject({ timePrecision: 'minute', content: '开了周会', entryDate: '2026-10-17' })
      expect(clockLabel(created!.recordedAt)).toBe('14:23')

      // 同一篇里补记更早的时刻，仍落在当天
      await repository.createEntry(noteId, { content: '早上跑步', recordedAt: '06:05' })
      const withEntries = await repository.getMineWithEntries(noteId)
      expect(withEntries!.entries.map(entry => entry.content)).toEqual(['早上跑步', '开了周会'])
      expect(withEntries!.entries.map(entry => clockLabel(entry.recordedAt))).toEqual(['06:05', '14:23'])
      // 合成文本与旧格式一致
      expect(withEntries!.content).toBe('06:05\n早上跑步\n\n14:23\n开了周会')
    })
  })

  it('appends to a past day and keeps ownership isolation', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      await seedUser(migrator, 'owner-b')
      const pastNote = await seedNote(migrator, 'owner-a', '2026-10-10', '')
      const mine = new MySqlDailyNoteRepository(app, scope('owner-a'))
      const other = new MySqlDailyNoteRepository(app, scope('owner-b'))

      await mine.createEntry(pastNote, { content: '补记前天', recordedAt: '21:40' })
      expect(await other.getMine(pastNote)).toBeUndefined()
      expect(await other.listEntries(pastNote)).toEqual([])
      expect(await other.createEntry(pastNote, { content: '越权写入' })).toBeUndefined()

      const listed = await mine.listEntries(pastNote)
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ entryDate: '2026-10-10', content: '补记前天' })
      expect(clockLabel(listed[0]!.recordedAt)).toBe('21:40')
    })
  })

  it('updates, deletes and clears entries', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const noteId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      const first = await repository.createEntry(noteId, { content: '待改', recordedAt: '09:00' })
      const updated = await repository.updateEntry(noteId, first!.id, { content: '已改', recordedAt: '23:30' })
      expect(updated).toMatchObject({ content: '已改' })
      expect(clockLabel(updated!.recordedAt)).toBe('23:30')

      const second = await repository.createEntry(noteId, { content: '待删', recordedAt: '10:00' })
      expect(await repository.deleteEntry(noteId, second!.id)).toBe(true)
      expect(await repository.deleteEntry(noteId, second!.id)).toBe(false)
      expect(await repository.listEntries(noteId)).toHaveLength(1)

      expect(await repository.clearEntries(noteId)).toBe(true)
      expect(await repository.listEntries(noteId)).toEqual([])
    })
  })

  it('keeps the legacy full-text save path and synthesizes the same text back', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const noteId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      const posted = '08:10\n早读\n\n20:30\n跑步五公里'
      const updated = await repository.updateMine(noteId, posted)
      expect(updated!.content).toBe(posted)
      const entries = await repository.listEntries(noteId)
      expect(entries.map(entry => entry.content)).toEqual(['早读', '跑步五公里'])
      expect(entries.map(entry => clockLabel(entry.recordedAt))).toEqual(['08:10', '20:30'])
    })
  })

  it('appends today as a minute-precision entry with an HH:MM prefix', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))
      const note = await repository.appendToday('随手记一条')
      expect(note.content).toMatch(/^\d{2}:\d{2}\n随手记一条$/)
      const entries = await repository.listEntries(note.id)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ timePrecision: 'minute', content: '随手记一条' })
    })
  })

  it('gets or creates the note of an arbitrary day idempotently', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      const first = await repository.getOrCreateByDate('2026-09-30')
      const second = await repository.getOrCreateByDate('2026-09-30')
      expect(second.id).toBe(first.id)
      expect(second.entryDate).toBe('2026-09-30')
      expect(second.content).toBe('')

      // 已有手记的日子直接复用，不再新建
      const existing = await seedNote(migrator, 'owner-a', '2026-09-29', '旧正文')
      expect((await repository.getOrCreateByDate('2026-09-29')).id).toBe(existing)

      const [rows] = await migrator.query<any[]>("SELECT COUNT(*) AS total FROM daily_notes WHERE owner_user_id='owner-a'")
      expect(Number(rows[0].total)).toBe(2)
    })
  })

  it('moves an entry to another day, creating that day and re-synthesizing both notes', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const sourceId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      const stays = await repository.createEntry(sourceId, { content: '留在今天', recordedAt: '09:00' })
      const moves = await repository.createEntry(sourceId, { content: '搬到明天', recordedAt: '10:00' })
      // 东八区 2026-10-18 01:00
      const moved = await repository.updateEntry(sourceId, moves!.id, { content: '搬到明天', recordedAt: '2026-10-17T17:00:00.000Z' })
      expect(moved!.id).toBe(moves!.id)
      expect(moved!.entryDate).toBe('2026-10-18')
      expect(moved!.dailyNoteId).not.toBe(sourceId)
      expect(clockLabel(moved!.recordedAt)).toBe('01:00')

      // 源篇只剩原位那条，合成文本跟着变
      const source = await repository.getMineWithEntries(sourceId)
      expect(source!.entries.map(entry => entry.id)).toEqual([stays!.id])
      expect(source!.content).toBe('09:00\n留在今天')
      // 目标日原本没有手记，被自动建篇并带上这条
      const target = await repository.getMineWithEntries(moved!.dailyNoteId)
      expect(target!.entryDate).toBe('2026-10-18')
      expect(target!.entries.map(entry => entry.id)).toEqual([moves!.id])
      expect(target!.content).toBe('01:00\n搬到明天')
    })
  })

  it('moves into a day that already has a note instead of duplicating it', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const sourceId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const targetId = await seedNote(migrator, 'owner-a', '2026-10-19', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))
      await repository.createEntry(targetId, { content: '原本就在这天', recordedAt: '07:00' })

      const entry = await repository.createEntry(sourceId, { content: '搬过去', recordedAt: '12:00' })
      const moved = await repository.updateEntry(sourceId, entry!.id, { content: '搬过去', recordedAt: '2026-10-19T04:30:00.000Z' })
      expect(moved!.dailyNoteId).toBe(targetId)
      expect(clockLabel(moved!.recordedAt)).toBe('12:30')

      const target = await repository.getMineWithEntries(targetId)
      expect(target!.entries.map(item => item.content)).toEqual(['原本就在这天', '搬过去'])
      expect(target!.content).toBe('07:00\n原本就在这天\n\n12:30\n搬过去')
      expect((await repository.getMineWithEntries(sourceId))!.content).toBe('')
    })
  })

  it('keeps day precision when only the content changes, and upgrades it when a time is given', async () => {
    await withTemporaryDatabase(async ({ app, migrator }) => {
      await runMySqlMigrations(migrator, createMigrationDirectory())
      await seedUser(migrator, 'owner-a')
      const noteId = await seedNote(migrator, 'owner-a', '2026-10-17', '')
      const repository = new MySqlDailyNoteRepository(app, scope('owner-a'))

      // 旧备份式整篇文本（无 HH:MM）→ 一条 day 精度条目
      await repository.updateMine(noteId, '只有正文没有时间')
      const [legacy] = await repository.listEntries(noteId)
      expect(legacy!.timePrecision).toBe('day')

      const edited = await repository.updateEntry(noteId, legacy!.id, { content: '改了正文' })
      expect(edited!.timePrecision).toBe('day')
      expect(edited!.recordedAt).toBe(legacy!.recordedAt)

      // 显式给时间才升级精度，时间标签才会出现
      const retimed = await repository.updateEntry(noteId, legacy!.id, { content: '改了正文', recordedAt: '16:45' })
      expect(retimed!.timePrecision).toBe('minute')
      expect(clockLabel(retimed!.recordedAt)).toBe('16:45')
      expect((await repository.getMineWithEntries(noteId))!.content).toBe('16:45\n改了正文')
    })
  })
})
