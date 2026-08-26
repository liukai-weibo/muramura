import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors'
import { parseSessionSecretFromHeaders } from './session'
import { createScopedHonoServices, type RootHonoServices } from './services'
import type { ApiEnv } from './types'

const normalBodyLimit = 64 * 1024

export function requireAuthenticatedSession(root: RootHonoServices): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const session = await root.auth.current(parseSessionSecretFromHeaders({ cookie: context.req.header('cookie'), authorization: context.req.header('authorization') }))
    if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
    context.set('actor', session.user)
    context.set('services', createScopedHonoServices(root.pool, session.user.id, root.aiConfig, session.user.username))
    await next()
  }
}

export function requireAdministrator(): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const actor = context.get('actor')
    if (!actor?.roles.includes('platform_admin') && !actor?.roles.includes('ordinary_admin')) {
      throw new ApiError(403, 'FORBIDDEN', '无权执行平台管理操作')
    }
    const declaredLength = Number(context.req.header('content-length') ?? '0')
    if (!Number.isFinite(declaredLength) || declaredLength > normalBodyLimit) {
      throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
    }
    await next()
  }
}

export function requirePlatformAdministrator(): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const actor = context.get('actor')
    if (!actor?.roles.includes('platform_admin')) {
      throw new ApiError(403, 'FORBIDDEN', '无权访问审计中心')
    }
    await next()
  }
}

export function requireServices(context: { get: (key: 'services') => ApiEnv['Variables']['services'] }) {
  const services = context.get('services')
  if (!services) throw new ApiError(500, 'INTERNAL_ERROR', '本地服务当前发生未分类错误')
  return services
}
