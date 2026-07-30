import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const entrypoint = readFileSync(new URL('../docker/app-entrypoint.sh', import.meta.url), 'utf8')

describe('Docker migrate startup wait', () => {
  it('waits for an authenticated MySQL TCP query before reconciling users or running migrations', () => {
    expect(entrypoint).toContain('wait_for_mysql_tcp()')
    expect(entrypoint).toContain('max_attempts=30')
    expect(entrypoint).toContain('--protocol=tcp --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}"')
    expect(entrypoint).toContain("-e 'SELECT 1' >/dev/null 2>&1")
    expect(entrypoint).toContain('wait_for_mysql_tcp\n  sed')
    expect(entrypoint).toContain('sleep 1')
    expect(entrypoint).toContain('MySQL TCP connection was not ready after ${max_attempts} seconds.')
  })

  it('keeps the existing reconcile and migration commands after the wait', () => {
    expect(entrypoint).toContain("sed 's@mysql --protocol=socket")
    expect(entrypoint).toContain('exec node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/migrate.ts')
  })
})
