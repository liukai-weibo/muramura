
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The launcher is intentionally dependency-free JavaScript executed directly by Node.
import * as localRuntime from '../scripts/local-runtime.mjs'
// @ts-expect-error The setup entry is intentionally dependency-free JavaScript executed directly by Node.
import * as localSetup from '../scripts/local-setup.mjs'

const {
  LocalLauncherError,
  assertPortAvailable,
  assertSupportedDevelopmentPlatform,
  createDailyApiEnvironment,
  createFrontendEnvironment,
  parseEnvironmentFile,
  terminateOwnedChild,
  validateDailyEnvironment,
  waitForApiHealth,
} = localRuntime
const { runLocalSetup } = localSetup

const temporaryDirectories: string[] = []

const validEnvironment = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_DATABASE: 'knowledge_base',
  MYSQL_APP_USER: 'daily_app',
  MYSQL_APP_PASSWORD: 'private-value',
  API_HOST: '127.0.0.1',
  API_PORT: '32146',
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('cross-platform local runtime', () => {
  it('parses the env syntax used by local configuration', () => {
    const environment = parseEnvironmentFile('\uFEFF# comment\r\nA="value # kept"\r\nB=left=right\r\nEMPTY=\r\n')

    expect(environment).toEqual({ A: 'value # kept', B: 'left=right', EMPTY: '' })
  })

  it('passes only approved daily values to API and no database secrets to H5', () => {
    const parentEnvironment = {
      PATH: '/usr/bin',
      NODE_OPTIONS: '--require=/tmp/hostile.cjs',
      MYSQL_DATABASE: 'knowledge_base_uat',
      UAT_MYSQL_APP_PASSWORD: 'uat-secret',
      COMPOSE_FILE: '/tmp/hostile.yml',
    }
    const fileEnvironment = {
      ...validEnvironment,
      MYSQL_ROOT_PASSWORD: 'root-secret',
      MYSQL_MIGRATOR_PASSWORD: 'migrator-secret',
      UAT_MYSQL_APP_PASSWORD: 'uat-file-secret',
      TARO_APP_PUBLIC_LABEL: 'local',
    }

    const apiEnvironment = createDailyApiEnvironment(parentEnvironment, fileEnvironment)
    const h5Environment = createFrontendEnvironment(parentEnvironment, fileEnvironment)

    expect(apiEnvironment).toMatchObject({ PATH: '/usr/bin', MYSQL_DATABASE: 'knowledge_base' })
    expect(apiEnvironment.NODE_OPTIONS).toBeUndefined()
    expect(apiEnvironment.MYSQL_ROOT_PASSWORD).toBeUndefined()
    expect(apiEnvironment.MYSQL_MIGRATOR_PASSWORD).toBeUndefined()
    expect(apiEnvironment.UAT_MYSQL_APP_PASSWORD).toBeUndefined()
    expect(h5Environment).toEqual({ PATH: '/usr/bin', TARO_APP_PUBLIC_LABEL: 'local' })
  })

  it('rejects UAT and non-loopback configuration', () => {
    expect(() => validateDailyEnvironment({
      ...validEnvironment,
      MYSQL_DATABASE: 'knowledge_base_uat',
    })).toThrowError(LocalLauncherError)

    expect(() => validateDailyEnvironment({
      ...validEnvironment,
      API_HOST: '0.0.0.0',
    })).toThrowError(/127\.0\.0\.1:32146/)
  })

  it('supports native Windows and POSIX development platforms', () => {
    expect(() => assertSupportedDevelopmentPlatform('win32')).not.toThrow()
    expect(() => assertSupportedDevelopmentPlatform('linux')).not.toThrow()
  })

  it('rejects unchanged credential placeholders', () => {
    expect(() => validateDailyEnvironment({
      ...validEnvironment,
      MYSQL_APP_PASSWORD: 'replace-with-a-private-password',
    })).toThrowError(/占位值/)
  })

  it('rejects an occupied port without changing its listener', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('expected TCP address')

    await expect(assertPortAvailable('127.0.0.1', address.port)).rejects.toMatchObject({ code: 'PORT_UNAVAILABLE' })
    expect(server.listening).toBe(true)
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('cleans the owned POSIX process group even after its leader exits', async () => {
    const signals: Array<[number, string | number]> = []

    await terminateOwnedChild(
      { pid: 2468, exitCode: 0, signalCode: null },
      {
        platform: 'linux',
        graceMs: 0,
        killProcess: (pid: number, signal: string | number) => { signals.push([pid, signal]); return true },
      },
    )

    expect(signals).toEqual([[-2468, 'SIGINT'], [-2468, 'SIGKILL']])
  })

  it('cleans the owned Windows process tree with taskkill', async () => {
    const kill = vi.fn()
    const execFileImpl = vi.fn(async () => undefined)

    await terminateOwnedChild(
      { pid: 2468, exitCode: null, signalCode: null, kill },
      { platform: 'win32', graceMs: 0, execFileImpl },
    )

    expect(kill).toHaveBeenCalledWith('SIGINT')
    expect(execFileImpl).toHaveBeenCalledWith('taskkill.exe', ['/PID', '2468', '/T', '/F'])
  })



  it('fails closed when the spawned API reports an asynchronous process error', async () => {
    await expect(waitForApiHealth({
      child: { exitCode: null, signalCode: null, launcherError: new Error('spawn failed') },
      fetchImpl: vi.fn(),
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: 'API_EXITED' })
  })

  it('accepts health only for the daily database and a positive integer schema', async () => {
    const responses = [
      new Response(JSON.stringify({ status: 'ready', database: 'knowledge_base_uat', schemaVersion: 9 }), { status: 200 }),
      new Response(JSON.stringify({ status: 'ready', database: 'knowledge_base', schemaVersion: 9 }), { status: 200 }),
    ]
    let clock = 0
    const health = await waitForApiHealth({
      child: { exitCode: null, signalCode: null },
      fetchImpl: vi.fn(async () => responses.shift()),
      timeoutMs: 100,
      intervalMs: 1,
      now: () => clock,
      sleep: async () => { clock += 1 },
    })

    expect(health).toEqual({ status: 'ready', database: 'knowledge_base', schemaVersion: 9 })
  })
})

describe('local development entry', () => {
  it('uses Node CLIs, validates API health before H5, and never migrates', async () => {
    const source = await readFile(new URL('../scripts/local-dev.mjs', import.meta.url), 'utf8')

    expect(source).toContain("apiRequire.resolve('tsx/cli')")
    expect(source).toContain("clientRequire.resolve('@tarojs/cli/bin/taro')")
    expect(source.indexOf('waitForApiHealth({ child: apiChild })')).toBeLessThan(source.indexOf('h5Child = spawnNodeCli'))
    expect(source).toContain('createFrontendEnvironment(parentEnvironment, fileEnvironment)')
    expect(source).not.toMatch(/powershell|node\.exe|npm\.cmd|shell:\s*true/i)
    expect(source).not.toMatch(/\bmigrate\b/i)
  })
})



describe('local setup', () => {
  it('creates .env once and performs no connectivity probe on the first run', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kb-local-setup-'))
    temporaryDirectories.push(root)
    await writeFile(path.join(root, '.env.example'), 'MYSQL_DATABASE=knowledge_base\n', 'utf8')
    const probe = vi.fn(async () => true)

    const result = await runLocalSetup({ root, probe, stdout: vi.fn() })

    expect(result).toEqual({ createdEnvironment: true, mysqlReachable: false })
    expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('MYSQL_DATABASE=knowledge_base\n')
    expect(probe).not.toHaveBeenCalled()
  })

  it('validates the daily environment without starting Docker or migrating', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kb-local-setup-'))
    temporaryDirectories.push(root)
    await writeFile(
      path.join(root, '.env'),
      Object.entries(validEnvironment).map(([name, value]) => `${name}=${value}`).join('\n'),
      'utf8',
    )
    const probe = vi.fn(async () => true)

    const result = await runLocalSetup({
      root,
      probe,
      stdout: vi.fn(),
    })

    expect(result).toEqual({ createdEnvironment: false, mysqlReachable: true })
    expect(probe).toHaveBeenCalledWith('127.0.0.1', 3306, 1_500)
  })
})
