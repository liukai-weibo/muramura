/**
 * Hono RPC 类型入口。
 *
 * 用法（客户端）：
 * ```ts
 * import { hc } from 'hono/client'
 * import type { AppType } from '@knowledge-base/api/rpc'
 *
 * const client = hc<AppType>('http://127.0.0.1:32146', {
 *   init: { credentials: 'include' },
 * })
 * ```
 *
 * 仅导出类型，不拉起运行时服务。Cookie 会话仍须 `credentials: 'include'`；
 * 本导出不替代现有 `@knowledge-base/contracts` + H5 `api-client`。
 */
export type { AppType } from './hono/app'
