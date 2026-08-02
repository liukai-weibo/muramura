import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { createRequire } from 'node:module'
import type { BackupDataV3, BackupDocument, InitialOwnerClaimResult } from '@knowledge-base/contracts'
import { BackupApplicationService } from '../packages/application/src/index'
import { parseInitialOwnerClaimTarget } from '../apps/api/src/claim-initial-owner'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, MySqlBackupRepository, MySqlInitialOwnerClaimRepository, runMySqlMigrations, type MySqlConnectionConfig } from '../packages/storage-mysql/src/index'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
const require = createRequire(import.meta.url)
const tables = ['item_links', 'item_status_events', 'method_applications', 'method_evidence', 'method_versions', 'method_tombstones', 'reviews', 'methods', 'items', 'exploration_tracks'] as const
let database = ''; let appUser = ''; let migratorUser = ''; let appPassword = ''; let migratorPassword = ''
let root: ReturnType<typeof createMySqlPool>; let app: ReturnType<typeof createMySqlPool>; let server: http.Server
let userA = ''; let userB = ''; let cookieA = ''; let cookieB = ''
const config = (user: string, password: string): MySqlConnectionConfig => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 3 })
type Response = { status: number; headers: http.IncomingHttpHeaders; body: any }
const request = (path: string, options: http.RequestOptions = {}, body?: string) => new Promise<Response>((resolve, reject) => {
  const address = server.address() as { port: number }
  const probe = http.request({ host: '127.0.0.1', port: address.port, path, ...options }, response => {
    const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) : undefined }) })
  }); probe.on('error', reject); if (body) probe.write(body); probe.end()
})
const json = (path: string, value: unknown, cookie?: string) => request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, JSON.stringify(value))
const cookieOf = (response: Response) => String(response.headers['set-cookie']).split(';')[0]!
const emptyData = (): BackupDataV3 => ({ items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [], itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [] })
const data = (prefix: string): BackupDataV3 => {
  const at = '2026-07-30T00:00:00.000Z'; const trackId = `${prefix}-track`; const item1 = `${prefix}-i1`; const item2 = `${prefix}-i2`; const item3 = `${prefix}-i3`; const review = `${prefix}-r1`; const method = `${prefix}-m1`; const tombstone = `${prefix}-tm1`
  return {
    explorationTracks: [{ id: trackId, name: `track-${prefix}`, normalizedName: `track-${prefix}`, createdAt: at, updatedAt: at }],
    items: [
      { id: item1, title: `${prefix}-one`, content: '', status: 'reviewed', explorationTrackId: trackId, createdAt: at, updatedAt: at },
      { id: item2, title: `${prefix}-two`, content: '', status: 'idea_to_try', createdAt: at, updatedAt: at },
      { id: item3, title: `${prefix}-three`, content: '', status: 'idea_to_try', createdAt: at, updatedAt: at },
    ],
    reviews: [{ id: review, itemId: item1, actualAction: 'act', result: 'result', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '', createdAt: at, updatedAt: at }],
    methods: [{ id: method, title: `${prefix}-method`, applicable: 'case', unsuitable: '', steps: 'step', validationCount: 1, version: 1, createdAt: at, updatedAt: at }],
    methodEvidence: [{ id: `${prefix}-e1`, methodId: method, reviewId: review, relation: 'formation', methodVersion: 1, createdAt: at }],
    methodVersions: [{ id: `${prefix}-v1`, methodId: method, version: 1, title: `${prefix}-method`, applicable: 'case', unsuitable: '', steps: 'step', sourceReviewId: review, createdAt: at }],
    methodApplications: [{ id: `${prefix}-a1`, methodId: method, methodVersion: 1, itemId: item2, createdAt: at }, { id: `${prefix}-a2`, methodId: tombstone, methodVersion: 1, itemId: item3, createdAt: at }],
    itemStatusEvents: [{ id: `${prefix}-s1`, itemId: item1, toStatus: 'reviewed', createdAt: at }, { id: `${prefix}-s2`, itemId: item2, toStatus: 'idea_to_try', createdAt: at }, { id: `${prefix}-s3`, itemId: item3, toStatus: 'idea_to_try', createdAt: at }],
    itemLinks: [{ id: `${prefix}-l1`, sourceReviewId: review, targetItemId: item2, type: 'derived_from_review', createdAt: at }],
    methodTombstones: [{ methodId: tombstone, title: `${prefix}-removed`, permanentlyDeletedAt: at, versions: [{ version: 1 }] }],
  }
}
const snapshot = async () => Promise.all(tables.map(async table => [table, (await app.query(`SELECT * FROM ${table} ORDER BY 1`))[0]] as const))
const ownerSummary = async (owner: string) => Promise.all(tables.map(async table => {
  const [rows] = await app.query<Array<{ owner_user_id: string | null } & import('mysql2/promise').RowDataPacket>>(`SELECT owner_user_id FROM ${table}`)
  return [table, { total: rows.length, target: rows.filter(row => row.owner_user_id === owner).length, unowned: rows.filter(row => row.owner_user_id === null).length }] as const
}))

describe.runIf(enabled)('initial owner claim and user-scoped Backup', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', ''); database = `kb_claim_${suffix}`; appUser = `kb_claim_app_${suffix.slice(0, 16)}`; migratorUser = `kb_claim_mig_${suffix.slice(0, 16)}`; appPassword = crypto.randomUUID(); migratorPassword = crypto.randomUUID()
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``); await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword]); await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`); await root.query(`GRANT SELECT,INSERT,CREATE,ALTER,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    app = createMySqlPool(config(appUser, appPassword)); server = createApiServer(config(appUser, appPassword)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const a = await json('/api/v1/auth/register', { username: `claim_a_${suffix}`, password: crypto.randomUUID() }); userA = a.body.user.id; cookieA = cookieOf(a)
    const b = await json('/api/v1/auth/register', { username: `claim_b_${suffix}`, password: crypto.randomUUID() }); userB = b.body.user.id; cookieB = cookieOf(b)
  })
  beforeEach(async () => { await new MySqlBackupRepository(app).replaceData(emptyData()); await app.query('DELETE FROM initial_owner_claims'); await app.query("DELETE FROM system_metadata WHERE `key`='slice3-test'") })
  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve())); await app?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end()
  })

  it('requires one explicit target and claims all ten collections once with before/after summaries', async () => {
    expect(() => parseInitialOwnerClaimTarget([])).toThrow('usage: claim-initial-owner')
    expect(() => parseInitialOwnerClaimTarget(['--user-id', userA, '--user-id', userB])).toThrow('usage: claim-initial-owner')
    await new MySqlBackupRepository(app).replaceData(data('legacy'))
    const command = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'apps/api/src/claim-initial-owner.ts', `--user-id=${userA}`], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, MYSQL_DATABASE: database, MYSQL_APP_USER: appUser, MYSQL_APP_PASSWORD: appPassword },
    })
    expect(command.status).toBe(0); expect(command.stderr).toBe(''); expect(command.stdout).not.toContain(appPassword)
    const claimed = JSON.parse(command.stdout) as InitialOwnerClaimResult
    expect(claimed.status).toBe('claimed')
    expect(Object.values(claimed.before).every(value => value.total > 0 && value.unowned === value.total)).toBe(true)
    expect(Object.values(claimed.after).every(value => value.total > 0 && value.targetOwned === value.total && value.unowned === 0)).toBe(true)
    const repository = new MySqlInitialOwnerClaimRepository(app)
    const beforeRepeat = await snapshot(); const repeated = await repository.claimInitialOwner(userA)
    expect(repeated.status).toBe('already-claimed'); expect(await snapshot()).toEqual(beforeRepeat)
    expect((await app.query('SELECT user_id FROM initial_owner_claims'))[0]).toEqual([{ user_id: userA }])
  })

  it('rejects mixed ownership and rolls every owner write back on a late failure', async () => {
    await new MySqlBackupRepository(app).replaceData(data('mixed'))
    await app.query('UPDATE items SET owner_user_id=? WHERE id=?', [userB, 'mixed-i1'])
    const mixedBefore = await snapshot()
    await expect(new MySqlInitialOwnerClaimRepository(app).claimInitialOwner(userA)).rejects.toMatchObject({ code: 'INITIAL_OWNER_MIXED_OWNERSHIP', details: { userId: userA } })
    expect(await snapshot()).toEqual(mixedBefore); expect((await app.query('SELECT * FROM initial_owner_claims'))[0]).toEqual([])

    await new MySqlBackupRepository(app).replaceData(emptyData()); await new MySqlBackupRepository(app).replaceData(data('failed'))
    const failedBefore = await snapshot()
    await expect(new MySqlInitialOwnerClaimRepository(app, { beforeCommit: () => { throw new Error('late claim failure') } }).claimInitialOwner(userA)).rejects.toThrow('late claim failure')
    expect(await snapshot()).toEqual(failedBefore); expect((await app.query('SELECT * FROM initial_owner_claims'))[0]).toEqual([])
  })

  it('does not retry an unknown claim outcome and permits an explicit idempotent confirmation', async () => {
    await new MySqlBackupRepository(app).replaceData(data('unknown'))
    let afterCommitCalls = 0
    await expect(new MySqlInitialOwnerClaimRepository(app, { afterCommit: () => { afterCommitCalls += 1; throw new Error('claim outcome unknown') } }).claimInitialOwner(userA)).rejects.toThrow('claim outcome unknown')
    expect(afterCommitCalls).toBe(1); expect((await ownerSummary(userA)).every(([, value]) => value.target === value.total)).toBe(true)
    expect((await new MySqlInitialOwnerClaimRepository(app).claimInitialOwner(userA)).status).toBe('already-claimed')
  })

  it('exports and previews V1/V2/V3 without userId and restores only the current user', async () => {
    const aData = data('alpha'); const bData = data('bravo')
    const aRepository = new MySqlBackupRepository(app, undefined, { userId: userA }); const bRepository = new MySqlBackupRepository(app, undefined, { userId: userB })
    const aService = new BackupApplicationService(aRepository); const bService = new BackupApplicationService(bRepository)
    await aRepository.replaceData(aData); await bRepository.replaceData(bData); await app.query("INSERT INTO system_metadata(`key`,value,updated_at) VALUES('slice3-test','kept',UTC_TIMESTAMP(3))")
    const bBefore = await bRepository.exportData(); const allBeforePreview = await snapshot(); const v3 = await aService.createBackup()
    const withoutTracks = { ...v3.data, items: v3.data.items.map(({ explorationTrackId: _track, ...item }) => item) }; delete (withoutTracks as Partial<BackupDataV3>).explorationTracks
    const v2 = { ...v3, version: 2, data: withoutTracks } as BackupDocument
    const v1 = { ...v3, version: 1, data: withoutTracks } as BackupDocument
    for (const document of [v1, v2, v3]) expect(aService.parseAndValidate(JSON.stringify(document))).toMatchObject({ format: 'knowledge-base-backup' })
    expect(await snapshot()).toEqual(allBeforePreview)
    expect(JSON.stringify(v3)).not.toContain('userId'); expect(JSON.stringify(v3)).not.toContain('owner_user_id'); expect(JSON.stringify(v3)).not.toContain('bravo-')
    await aService.restoreBackup(aService.parseAndValidate(JSON.stringify(v2))); expect(await bRepository.exportData()).toEqual(bBefore)
    await aService.restoreBackup(aService.parseAndValidate(JSON.stringify(v1))); expect(await bRepository.exportData()).toEqual(bBefore)
    await aService.restoreBackup(aService.parseAndValidate(JSON.stringify(v3))); expect(await bRepository.exportData()).toEqual(bBefore)
    expect(await aRepository.exportData()).toEqual(v3.data); expect((await app.query("SELECT value FROM system_metadata WHERE `key`='slice3-test'"))[0]).toEqual([{ value: 'kept' }])
    expect((await bService.createBackup()).data).toEqual(bBefore)
  })

  it('returns 409 before writes when a restore ID belongs to another user', async () => {
    await new MySqlBackupRepository(app, undefined, { userId: userA }).replaceData(data('ownera'))
    await new MySqlBackupRepository(app, undefined, { userId: userB }).replaceData(data('ownerb'))
    const bBackup = await request('/api/v1/backup', { headers: { cookie: cookieB } }); expect(bBackup.status).toBe(200)
    const before = await snapshot(); const response = await json('/api/v1/backup/restore', bBackup.body, cookieA)
    expect(response.status).toBe(409); expect(response.body).toEqual({ error: { code: 'CONFLICT', message: '备份包含属于其他用户的数据 ID', requestId: expect.any(String) } }); expect(response.headers['cache-control']).toBe('no-store')
    expect(await snapshot()).toEqual(before)
  })

  it('rolls a late restore failure back and never retries an unknown committed outcome', async () => {
    const baseline = data('base'); const replacement = data('next')
    const scoped = { userId: userA }; const stable = new MySqlBackupRepository(app, undefined, scoped); await stable.replaceData(baseline)
    const beforeFailure = await snapshot()
    await expect(new MySqlBackupRepository(app, { beforeItemStatusEventInsert: () => { throw new Error('late restore failure') } }, scoped).replaceData(replacement)).rejects.toThrow('late restore failure')
    expect(await snapshot()).toEqual(beforeFailure)
    let afterCommitCalls = 0
    await expect(new MySqlBackupRepository(app, { afterCommit: () => { afterCommitCalls += 1; throw new Error('restore outcome unknown') } }, scoped).replaceData(replacement)).rejects.toThrow('restore outcome unknown')
    expect(afterCommitCalls).toBe(1); expect(await stable.exportData()).toEqual(replacement)
  })
})
