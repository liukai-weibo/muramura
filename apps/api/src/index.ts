import type http from 'node:http'
import { createAdaptorServer } from '@hono/node-server'
import { readMySqlConfig } from '@knowledge-base/storage-mysql'
import { createHonoApi } from './hono/app'

export { apiV1BasePath } from './hono/paths'
export { buildHonoApp, buildRpcContractRoutes, createHonoApi } from './hono/app'
export type { AppType } from './hono/app'

/**
 * 兼容既有集成测试与 main 入口：返回由 Hono fetch 适配的 Node http.Server。
 * 业务路由实现在 `hono/routes/`，此处负责组装与 Node 适配。
 */
export function createApiServer(config = readMySqlConfig(process.env, 'app')): http.Server {
  const { app, close } = createHonoApi(config)
  const server = createAdaptorServer({ fetch: app.fetch }) as http.Server
  server.once('close', () => {
    void close()
  })
  return server
}

export function readApiListenConfig(environment: NodeJS.ProcessEnv): { host: '127.0.0.1'; port: 32146 } {
  const host = environment.API_HOST ?? '127.0.0.1'
  const port = Number(environment.API_PORT ?? '32146')
  if (host !== '127.0.0.1' || port !== 32146) throw new Error('API 仅允许监听 127.0.0.1:32146')
  return { host, port }
}
