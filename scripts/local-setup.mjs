import { constants } from 'node:fs'
import { access, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LocalLauncherError,
  assertSupportedNodeVersion,
  formatLauncherFailure,
  isTcpReachable,
  readEnvironmentFile,
  repositoryPath,
  validateDailyEnvironment,
} from './local-runtime.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function runLocalSetup({
  root = repositoryRoot,
  stdout = console.log,
  probe = isTcpReachable,
} = {}) {
  assertSupportedNodeVersion()
  const envPath = repositoryPath(root, '.env')
  const examplePath = repositoryPath(root, '.env.example')

  if (!await exists(envPath)) {
    if (!await exists(examplePath)) {
      throw new LocalLauncherError('ENV_EXAMPLE_MISSING', '缺少 .env.example，无法创建本机配置。')
    }
    await copyFile(examplePath, envPath, constants.COPYFILE_EXCL)
    stdout('已从 .env.example 创建 .env。请填写本机私有配置，然后再次运行 pnpm setup。')
    return { createdEnvironment: true, mysqlReachable: false }
  }

  const fileEnvironment = await readEnvironmentFile(envPath)
  const { mysqlHost, mysqlPort } = validateDailyEnvironment(fileEnvironment)
  const mysqlReachable = await probe(mysqlHost, mysqlPort, 1_500)
  if (!mysqlReachable) {
    throw new LocalLauncherError(
      'MYSQL_UNAVAILABLE',
      '本机配置有效，但日常 MySQL 当前不可达。请根据当前运行事实启动已确认的数据源；启动器不会自动创建或迁移数据库。',
    )
  }

  stdout('✓ Daily environment configured')
  stdout(`✓ MySQL reachable: ${mysqlHost}:${mysqlPort}`)
  stdout('下一步运行 pnpm dev；若 API 报告 Schema 落后，请先确认真实目标库，再使用既有受控 Migration 流程。')
  return { createdEnvironment: false, mysqlReachable: true }
}

async function main() {
  try {
    await runLocalSetup()
  } catch (error) {
    console.error(formatLauncherFailure(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
