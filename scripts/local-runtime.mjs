import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { parseEnv } from 'node:util'

export const DAILY_API_HOST = '127.0.0.1'
export const DAILY_API_PORT = 32146
export const DAILY_H5_HOST = '127.0.0.1'
export const DAILY_H5_PORT = 10086
export const DAILY_DATABASE = 'knowledge_base'

const inheritedEnvironmentAllowlist = new Set([
  'APPDATA', 'CI', 'COLORTERM', 'COMSPEC', 'FORCE_COLOR', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'LOCALAPPDATA', 'NO_COLOR', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TERM', 'TMP', 'TMPDIR',
  'USERPROFILE', 'WINDIR',
])
const dailyApiEnvironmentNames = [
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_APP_USER', 'MYSQL_APP_PASSWORD',
  'MYSQL_POOL_CONNECTION_LIMIT', 'API_HOST', 'API_PORT',
]
const requiredDailyValues = [
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_DATABASE',
  'MYSQL_APP_USER',
  'MYSQL_APP_PASSWORD',
  'API_HOST',
  'API_PORT',
]

export class LocalLauncherError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LocalLauncherError'
    this.code = code
  }
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  if (!Number.isInteger(major) || major < 22) {
    throw new LocalLauncherError('NODE_VERSION_UNSUPPORTED', '需要 Node.js 22 或更高版本。')
  }
}

export function assertSupportedDevelopmentPlatform(platform = process.platform) {
  if (platform === 'win32') {
    throw new LocalLauncherError(
      'WINDOWS_FOREGROUND_NOT_READY',
      '原生 Windows 前台编排暂未支持；请在 WSL/Linux 中运行 pnpm dev。',
    )
  }
}

export function parseEnvironmentFile(source) {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  try {
    return parseEnv(normalized)
  } catch {
    throw new LocalLauncherError('ENV_INVALID', '.env 格式无效。')
  }
}

export async function readEnvironmentFile(filePath) {
  let source
  try {
    source = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new LocalLauncherError('ENV_MISSING', '缺少 .env；请先运行 pnpm setup。')
    }
    throw new LocalLauncherError('ENV_UNREADABLE', '无法读取 .env。')
  }
  return parseEnvironmentFile(source)
}

function createToolEnvironment(parentEnvironment) {
  const environment = {}
  for (const [name, value] of Object.entries(parentEnvironment)) {
    if (inheritedEnvironmentAllowlist.has(name.toUpperCase()) && value !== undefined) environment[name] = value
  }
  return environment
}

export function createDailyApiEnvironment(parentEnvironment, fileEnvironment) {
  const environment = createToolEnvironment(parentEnvironment)
  for (const name of dailyApiEnvironmentNames) {
    if (fileEnvironment[name] !== undefined) environment[name] = fileEnvironment[name]
  }
  return environment
}

export function createFrontendEnvironment(parentEnvironment, fileEnvironment = {}) {
  const environment = createToolEnvironment(parentEnvironment)
  for (const [name, value] of Object.entries(fileEnvironment)) {
    if ((name === 'NODE_ENV' || name.startsWith('TARO_APP_')) && value !== undefined) environment[name] = value
  }
  return environment
}

export function validateDailyEnvironment(environment) {
  for (const name of requiredDailyValues) {
    if (typeof environment[name] !== 'string' || environment[name].length === 0) {
      throw new LocalLauncherError('ENV_INVALID', `.env 缺少必需配置 ${name}。`)
    }
  }

  if (environment.MYSQL_HOST !== '127.0.0.1' || environment.MYSQL_DATABASE !== DAILY_DATABASE) {
    throw new LocalLauncherError(
      'ENV_NOT_DAILY',
      '.env 必须固定连接 127.0.0.1 上的 knowledge_base；UAT 请使用独立入口。',
    )
  }
  if (environment.API_HOST !== DAILY_API_HOST || Number(environment.API_PORT) !== DAILY_API_PORT) {
    throw new LocalLauncherError('ENV_NOT_DAILY', '日常 API 必须固定监听 127.0.0.1:32146。')
  }

  const placeholderPattern = /^(?:change[-_ ]?me.*|replace(?:[-_ ]?with)?.*|placeholder.*|your[-_ ]?(?:password|secret).*|<.+>)$/i
  for (const name of ['MYSQL_APP_PASSWORD']) {
    if (placeholderPattern.test(environment[name])) {
      throw new LocalLauncherError('ENV_PLACEHOLDER', `.env 中的 ${name} 仍是示例占位值。`)
    }
  }

  const mysqlPort = Number(environment.MYSQL_PORT)
  if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
    throw new LocalLauncherError('ENV_INVALID', 'MYSQL_PORT 必须是有效端口。')
  }

  return { mysqlHost: environment.MYSQL_HOST, mysqlPort }
}

export async function isTcpReachable(host, port, timeoutMs = 1_000) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (reachable) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      const message = error?.code === 'EADDRINUSE'
        ? `${host}:${port} 已被占用；拒绝替换或接管现有进程。`
        : `无法检查 ${host}:${port}。`
      reject(new LocalLauncherError('PORT_UNAVAILABLE', message))
    })
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(new LocalLauncherError('PORT_UNAVAILABLE', `无法释放端口检查 ${host}:${port}。`))
        else resolve()
      })
    })
  })
}

export function spawnNodeCli(cliPath, args, options = {}) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'inherit',
    detached: process.platform !== 'win32',
    windowsHide: false,
  })
  child.launcherError = null
  child.on('error', (error) => { child.launcherError = error })
  return child
}

function childHasExited(child) {
  return Boolean(child.launcherError) || child.exitCode !== null || child.signalCode !== null
}

function signalProcessGroup(pid, signal, killProcess) {
  try {
    killProcess(-pid, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

export async function terminateOwnedChild(child, {
  graceMs = 3_000,
  platform = process.platform,
  killProcess = process.kill,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!child?.pid) return
  if (platform === 'win32') {
    throw new LocalLauncherError('WINDOWS_CLEANUP_UNSUPPORTED', '原生 Windows 进程树清理尚未启用。')
  }

  if (!signalProcessGroup(child.pid, 'SIGINT', killProcess)) return
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    await sleep(Math.min(50, Math.max(1, deadline - Date.now())))
    if (!signalProcessGroup(child.pid, 0, killProcess)) return
  }
  signalProcessGroup(child.pid, 'SIGKILL', killProcess)
}

export function waitForChildExit(child) {
  if (childHasExited(child)) {
    return Promise.resolve({ exitCode: child.exitCode, signalCode: child.signalCode })
  }
  return new Promise((resolve) => {
    child.once('exit', (exitCode, signalCode) => resolve({ exitCode, signalCode }))
  })
}

export async function waitForApiHealth({
  child,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  intervalMs = 250,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs
  let lastFailure = 'API 尚未响应'

  while (now() < deadline) {
    if (childHasExited(child)) {
      throw new LocalLauncherError('API_EXITED', 'API 在通过健康检查前退出。')
    }
    try {
      const response = await fetchImpl(`http://${DAILY_API_HOST}:${DAILY_API_PORT}/health`, {
        signal: AbortSignal.timeout(Math.min(1_000, Math.max(1, deadline - now()))),
      })
      if (response.ok) {
        const health = await response.json()
        if (
          health?.status === 'ready' &&
          health.database === DAILY_DATABASE &&
          Number.isInteger(health.schemaVersion) &&
          health.schemaVersion > 0
        ) {
          await sleep(intervalMs)
          if (childHasExited(child)) {
            throw new LocalLauncherError('API_EXITED', 'API 健康响应有效，但启动子进程未能保持运行。')
          }
          return health
        }
        lastFailure = 'API health 未确认日常数据库或有效 Schema'
      } else {
        lastFailure = `API health 返回 HTTP ${response.status}`
      }
    } catch (error) {
      if (error instanceof LocalLauncherError) throw error
      lastFailure = 'API health 暂不可用'
    }
    await sleep(intervalMs)
  }

  throw new LocalLauncherError('API_HEALTH_TIMEOUT', `${lastFailure}；启动超时。`)
}

export async function waitForTcpListener({
  child,
  host,
  port,
  timeoutMs = 60_000,
  intervalMs = 250,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  probe = isTcpReachable,
}) {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (childHasExited(child)) {
      throw new LocalLauncherError('CHILD_EXITED', `${host}:${port} 对应的服务在监听前退出。`)
    }
    if (await probe(host, port, Math.min(1_000, Math.max(1, deadline - now())))) {
      await sleep(intervalMs)
      if (childHasExited(child)) {
        throw new LocalLauncherError('CHILD_EXITED', `${host}:${port} 已有监听，但启动子进程未能保持运行。`)
      }
      return
    }
    await sleep(intervalMs)
  }
  throw new LocalLauncherError('LISTENER_TIMEOUT', `等待 ${host}:${port} 监听超时。`)
}

export function formatLauncherFailure(error) {
  if (error instanceof LocalLauncherError) return `LOCAL_LAUNCHER_FAILED code=${error.code} message=${JSON.stringify(error.message)}`
  return 'LOCAL_LAUNCHER_FAILED code=INTERNAL_ERROR message="未分类启动错误。"'
}

export function repositoryPath(repositoryRoot, ...parts) {
  return path.join(repositoryRoot, ...parts)
}
