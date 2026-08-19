import crypto from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ApiError, errorResponse } from './errors'
import { adminPathPrefix, backupRestorePath } from './paths'
import type { ApiEnv } from './types'

const allowedApiOrigins = new Set([
  'http://127.0.0.1:10086',
  'http://localhost:10086',
  'http://[::1]:10086',
  'http://47.97.69.175:10086',
  'http://tauri.localhost',
  'tauri://localhost',
])
function isAllowedApiOrigin(origin: string): boolean {
  if (allowedApiOrigins.has(origin)) return true
  try {
    const url = new URL(origin)
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    return url.protocol === 'http:' && localHost && (url.port === '10086' || url.port === '32146')
  } catch {
    return false
  }
}
const normalBodyLimit = 64 * 1024
const backupBodyLimit = 16 * 1024 * 1024

const normalLimiter = bodyLimit({
  maxSize: normalBodyLimit,
  onError: () => {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
  },
})

const backupLimiter = bodyLimit({
  maxSize: backupBodyLimit,
  onError: () => {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
  },
})

export const requestContext: MiddlewareHandler<ApiEnv> = async (context, next) => {
  context.set('requestId', crypto.randomUUID())
  context.header('cache-control', 'no-store')
  context.header('x-request-id', context.get('requestId'))

  const origin = context.req.header('origin')
  if (origin) {
    if (!isAllowedApiOrigin(origin)) {
      return errorResponse(context, 403, 'VALIDATION_FAILED', '不允许的请求来源')
    }
    context.header('access-control-allow-origin', origin)
    context.header('access-control-allow-credentials', 'true')
    context.header('vary', 'origin')
    context.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    context.header('access-control-allow-headers', 'content-type, x-request-id, authorization')
    context.header('access-control-expose-headers', 'x-kb-session-token')
  }

  await next()
}

/**
 * 非管理路由提前做 body 上限；管理路由在鉴权后由 requirePlatformAdministrator 再拦 413。
 */
export const enforceBodyLimit: MiddlewareHandler<ApiEnv> = async (context, next) => {
  if (context.req.path.startsWith(adminPathPrefix)) {
    await next()
    return
  }
  const limit = context.req.path === backupRestorePath ? backupBodyLimit : normalBodyLimit
  const declaredLength = Number(context.req.header('content-length') ?? '0')
  if (!Number.isFinite(declaredLength) || declaredLength > limit) {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', '请求内容超过大小限制')
  }
  const limiter = context.req.path === backupRestorePath ? backupLimiter : normalLimiter
  return limiter(context, next)
}

export const requireJson: MiddlewareHandler<ApiEnv> = async (context, next) => {
  const contentType = context.req.header('content-type')
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '仅接受 application/json 请求')
  }
  await next()
}
