import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 桌面端开发固定连本机 API；生产包由 apps/client/.env.production 指向云端。
const root = fileURLToPath(new URL('..', import.meta.url))
const env = {
  ...process.env,
  TARO_APP_API_BASE_URL: process.env.TARO_APP_API_BASE_URL || 'http://127.0.0.1:32146',
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('corepack', ['pnpm', '--filter', '@knowledge-base/client', 'build:h5'])
run(process.execPath, [
  'apps/client/node_modules/@tauri-apps/cli/tauri.js',
  'dev',
  '--config',
  'src-tauri/tauri.dev.conf.json',
  '--no-dev-server',
])
