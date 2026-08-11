import { createRequire } from 'node:module'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  DAILY_API_HOST,
  DAILY_API_PORT,
  createDailyApiEnvironment,
  isTcpReachable,
  readEnvironmentFile,
  repositoryPath,
  spawnNodeCli,
  terminateOwnedChild,
  validateDailyEnvironment,
  waitForApiHealth,
} from './local-runtime.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const fileEnvironment = await readEnvironmentFile(repositoryPath(root, '.env'))
  const { mysqlHost, mysqlPort } = validateDailyEnvironment(fileEnvironment)

  if (!await isTcpReachable(mysqlHost, mysqlPort, 1_000)) {
    console.log('MySQL 未运行，正在启动 Docker MySQL…')
    await execFileAsync('docker', ['compose', '--env-file', '.env', 'up', '-d', 'mysql'], { cwd: root })
  }

  const requireFromApi = createRequire(repositoryPath(root, 'apps/api/package.json'))
  const apiCli = requireFromApi.resolve('tsx/cli')
  const apiEnvironment = createDailyApiEnvironment(process.env, fileEnvironment)
  const api = spawnNodeCli(apiCli, [repositoryPath(root, 'apps/api/src/main.ts')], {
    cwd: root,
    env: apiEnvironment,
  })

  const stop = async () => {
    await terminateOwnedChild(api)
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  const health = await waitForApiHealth({ child: api })
  console.log(`API 已就绪：http://${DAILY_API_HOST}:${DAILY_API_PORT}（${health.database}，Schema ${health.schemaVersion}）`)
  console.log('请保持此窗口运行，再启动 MaruMaru 桌面客户端。按 Ctrl+C 停止 API。')

  await new Promise((resolve) => api.once('exit', resolve))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
