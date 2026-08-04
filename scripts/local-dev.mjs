import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DAILY_API_HOST,
  DAILY_API_PORT,
  DAILY_H5_HOST,
  DAILY_H5_PORT,
  LocalLauncherError,
  assertPortAvailable,
  assertSupportedDevelopmentPlatform,
  assertSupportedNodeVersion,
  createDailyApiEnvironment,
  createFrontendEnvironment,
  formatLauncherFailure,
  isTcpReachable,
  readEnvironmentFile,
  repositoryPath,
  spawnNodeCli,
  terminateOwnedChild,
  validateDailyEnvironment,
  waitForApiHealth,
  waitForChildExit,
  waitForTcpListener,
} from './local-runtime.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

class StopRequested extends Error {
  constructor(signal) {
    super(signal)
    this.signal = signal
  }
}

function resolveDevelopmentCommands(root) {
  try {
    const apiRequire = createRequire(repositoryPath(root, 'apps/api/package.json'))
    const clientRequire = createRequire(repositoryPath(root, 'apps/client/package.json'))
    return {
      apiCli: apiRequire.resolve('tsx/cli'),
      apiArgs: [repositoryPath(root, 'apps/api/src/main.ts')],
      apiCwd: root,
      h5Cli: clientRequire.resolve('@tarojs/cli/bin/taro'),
      h5Args: ['build', '--type', 'h5', '--watch'],
      h5Cwd: repositoryPath(root, 'apps/client'),
    }
  } catch {
    throw new LocalLauncherError('DEPENDENCIES_MISSING', '缺少开发依赖；请先运行 pnpm install。')
  }
}

function waitForSpawn(child, serviceName) {
  if (child.pid) return Promise.resolve()
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', () => reject(new LocalLauncherError('CHILD_START_FAILED', `${serviceName} 子进程无法启动。`)))
  })
}

function createStopSignal() {
  let resolve
  let requestedSignal = null
  const promise = new Promise((promiseResolve) => { resolve = promiseResolve })
  const handlers = new Map()

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      if (requestedSignal === null) {
        requestedSignal = signal
        resolve(signal)
      }
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }

  return {
    promise,
    get requestedSignal() { return requestedSignal },
    dispose() {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    },
  }
}

async function raceWithStop(operation, stopSignal) {
  return await Promise.race([
    operation,
    stopSignal.promise.then((signal) => { throw new StopRequested(signal) }),
  ])
}

export async function runLocalDevelopment({
  root = repositoryRoot,
  parentEnvironment = process.env,
  stdout = console.log,
} = {}) {
  assertSupportedNodeVersion()
  assertSupportedDevelopmentPlatform()
  const fileEnvironment = await readEnvironmentFile(repositoryPath(root, '.env'))
  const { mysqlHost, mysqlPort } = validateDailyEnvironment(fileEnvironment)
  const apiEnvironment = createDailyApiEnvironment(parentEnvironment, fileEnvironment)
  const h5Environment = createFrontendEnvironment(parentEnvironment, fileEnvironment)
  const commands = resolveDevelopmentCommands(root)

  await Promise.all([
    assertPortAvailable(DAILY_API_HOST, DAILY_API_PORT),
    assertPortAvailable(DAILY_H5_HOST, DAILY_H5_PORT),
  ])

  if (!await isTcpReachable(mysqlHost, mysqlPort, 1_500)) {
    throw new LocalLauncherError(
      'MYSQL_UNAVAILABLE',
      '日常 MySQL 当前不可达。为避免启动错误的数据容器，启动器没有自动创建数据库；请根据当前运行事实启动已确认的数据源。',
    )
  }
  stdout('✓ MySQL reachable')

  const stopSignal = createStopSignal()
  let apiChild
  let h5Child
  let cleanupPromise
  const cleanup = () => {
    cleanupPromise ??= Promise.all([
      terminateOwnedChild(h5Child),
      terminateOwnedChild(apiChild),
    ])
    return cleanupPromise
  }

  try {
    apiChild = spawnNodeCli(commands.apiCli, commands.apiArgs, {
      cwd: commands.apiCwd,
      env: apiEnvironment,
    })
    await raceWithStop(waitForSpawn(apiChild, 'API'), stopSignal)
    const health = await raceWithStop(waitForApiHealth({ child: apiChild }), stopSignal)
    stdout(`✓ API ready: http://${DAILY_API_HOST}:${DAILY_API_PORT} (${health.database}, schema ${health.schemaVersion})`)

    h5Child = spawnNodeCli(commands.h5Cli, commands.h5Args, {
      cwd: commands.h5Cwd,
      env: h5Environment,
    })
    await raceWithStop(waitForSpawn(h5Child, 'H5'), stopSignal)
    await raceWithStop(waitForTcpListener({
      child: h5Child,
      host: DAILY_H5_HOST,
      port: DAILY_H5_PORT,
    }), stopSignal)
    stdout(`✓ H5 ready: http://${DAILY_H5_HOST}:${DAILY_H5_PORT}`)
    stdout('Press Ctrl+C to stop API and H5')

    const result = await Promise.race([
      waitForChildExit(apiChild).then((exit) => ({ service: 'API', exit })),
      waitForChildExit(h5Child).then((exit) => ({ service: 'H5', exit })),
      stopSignal.promise.then((signal) => ({ signal })),
    ])
    if (result.signal) throw new StopRequested(result.signal)
    throw new LocalLauncherError(
      'CHILD_EXITED',
      `${result.service} 意外退出（code=${result.exit.exitCode ?? 'null'}, signal=${result.exit.signalCode ?? 'none'}）。`,
    )
  } catch (error) {
    if (error instanceof StopRequested) {
      return error.signal === 'SIGINT' ? 130 : error.signal === 'SIGHUP' ? 129 : 143
    }
    throw error
  } finally {
    try {
      await cleanup()
    } finally {
      stopSignal.dispose()
    }
  }
}

async function main() {
  try {
    process.exitCode = await runLocalDevelopment()
  } catch (error) {
    console.error(formatLauncherFailure(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
