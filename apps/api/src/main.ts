import { createApiServer, readApiListenConfig } from './index'
import { pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import { assertMySqlPlatformSchemaReady, createMySqlPool, readMySqlConfig } from '@knowledge-base/storage-mysql'

export interface ApiMainDependencies {
  createServer?: (config: ReturnType<typeof readMySqlConfig>) => Server
  listen?: (server: Server, port: number, host: string) => Promise<void>
  log?: (message: string) => void
}

export async function startApiMain(environment: NodeJS.ProcessEnv = process.env, dependencies: ApiMainDependencies = {}) {
  const config = readMySqlConfig(environment, 'app')
  const probe = createMySqlPool({ ...config, connectionLimit: 1 })
  try { await assertMySqlPlatformSchemaReady(probe, config.database) } finally { await probe.end() }
  const server = (dependencies.createServer ?? createApiServer)(config)
  const { host, port } = readApiListenConfig(environment)
  await (dependencies.listen ?? listen)(server, port, host)
  ;(dependencies.log ?? console.log)(`Knowledge_Base MySQL API listening at http://${host}:${port}`)
  return server
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startApiMain().catch(() => {
    console.error('API_STARTUP_FAILED')
    process.exitCode = 1
  })
}
