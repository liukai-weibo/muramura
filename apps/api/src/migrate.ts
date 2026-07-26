import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMySqlPool, readMySqlConfig, runMySqlMigrations } from '@knowledge-base/storage-mysql'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const pool = createMySqlPool(readMySqlConfig(process.env, 'migrator'))
try {
  await runMySqlMigrations(pool, path.join(repositoryRoot, 'migrations'))
} finally {
  await pool.end()
}
