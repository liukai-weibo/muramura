import crypto from 'node:crypto'
import http, { type Server } from 'node:http'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startApiMain } from '../apps/api/src/main'
import { createApiServer } from '../apps/api/src/index'
import { createMySqlPool, runMySqlMigrations } from '../packages/storage-mysql/src/index'

const enabled = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_ROOT_PASSWORD'].every(name => Boolean(process.env[name]))
let database = ''
let appUser = ''
let migratorUser = ''
let appPassword = ''
let root: Pool
let app: Pool

describe.runIf(enabled)('API Schema 8 startup gate', () => {
  beforeAll(async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    database = `kb_platform_start_${suffix}`
    appUser = `kb_platform_app_${suffix.slice(0, 15)}`
    migratorUser = `kb_platform_mig_${suffix.slice(0, 15)}`
    appPassword = crypto.randomUUID(); const migratorPassword = crypto.randomUUID()
    expect(database).not.toBe('knowledge_base'); expect(database).not.toBe('knowledge_base_uat')
    root = createMySqlPool({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD!, connectionLimit: 1 })
    await root.query(`CREATE DATABASE \`${database}\``)
    await root.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY ?`, [appPassword])
    await root.query(`CREATE USER '${migratorUser}'@'%' IDENTIFIED BY ?`, [migratorPassword])
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${appUser}'@'%'`)
    await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database}\`.* TO '${migratorUser}'@'%'`)
    const config = (user: string, password: string) => ({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user, password, connectionLimit: 1 })
    const migrator = createMySqlPool(config(migratorUser, migratorPassword)); await runMySqlMigrations(migrator, `${process.cwd()}/migrations`); await migrator.end()
    app = createMySqlPool(config(appUser, appPassword))
  })
  afterAll(async () => { await app?.end(); await root?.query(`DROP DATABASE IF EXISTS \`${database}\``); await root?.query(`DROP USER IF EXISTS '${appUser}'@'%'`); await root?.query(`DROP USER IF EXISTS '${migratorUser}'@'%'`); await root?.end() })

  const environment = () => ({
    MYSQL_HOST: process.env.MYSQL_HOST!, MYSQL_PORT: process.env.MYSQL_PORT!, MYSQL_DATABASE: database,
    MYSQL_APP_USER: appUser, MYSQL_APP_PASSWORD: appPassword, MYSQL_POOL_CONNECTION_LIMIT: '1', API_HOST: '127.0.0.1', API_PORT: '32146',
  })

  it('does not create or listen on Schema 7 and allows the listen step only on Schema 8', async () => {
    const [rows] = await app.query<Array<RowDataPacket & { version: number; name: string; checksum: string; applied_at: Date }>>('SELECT version,name,checksum,applied_at FROM schema_migrations WHERE version=8')
    await app.query('DELETE FROM schema_migrations WHERE version=8')
    const createServer = vi.fn(() => ({} as Server)); const listen = vi.fn(async () => undefined); const log = vi.fn()
    await expect(startApiMain(environment(), { createServer, listen, log })).rejects.toMatchObject({
      details: {
        reason: 'schema-version-behind', database, actualSchemaVersion: 7, requiredSchemaVersion: 8,
      },
    })
    expect(createServer).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled()
    const schema7Server = createApiServer({ host: process.env.MYSQL_HOST!, port: Number(process.env.MYSQL_PORT!), database, user: appUser, password: appPassword, connectionLimit: 1 })
    await new Promise<void>(resolve => schema7Server.listen(0, '127.0.0.1', resolve))
    const health = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: (schema7Server.address() as { port: number }).port, path: '/health' }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      }); request.on('error', reject)
    })
    expect(health.status).toBe(503); expect(health.body).not.toContain(appPassword)
    await new Promise<void>(resolve => schema7Server.close(() => resolve()))
    const row = rows[0]!
    await app.query('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)', [row.version, row.name, row.checksum, row.applied_at])
    await expect(startApiMain(environment(), { createServer, listen, log })).resolves.toBeDefined()
    expect(createServer).toHaveBeenCalledTimes(1); expect(listen).toHaveBeenCalledWith(expect.anything(), 32146, '127.0.0.1'); expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain(appPassword)
  })
})
