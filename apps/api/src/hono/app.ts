import { Hono } from 'hono'
import { readMySqlConfig, type MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { reportUnexpectedFailure } from '../api-errors'
import { errorResponse, mapFailure } from './errors'
import { enforceBodyLimit, requestContext } from './http'
import { createBackupRoutes } from './routes/backup'
import { createExplorationTrackRoutes } from './routes/exploration-tracks'
import { createHealthRoutes } from './routes/health'
import { createItemRoutes } from './routes/items'
import {
  createMethodApplicationRoutes,
  createMethodSourceDisplayRoutes,
} from './routes/method-applications'
import { createMethodRoutes } from './routes/methods'
import { createDashboardRoutes, createSearchRoutes } from './routes/read-models'
import { createReviewRoutes } from './routes/reviews'
import { createTrashRoutes } from './routes/trash'
import { createHonoServices, type HonoServices } from './services'
import type { ApiEnv } from './types'

function isKnownApiPath(path: string): boolean {
  return [
    '/health',
    '/api/v1/search',
    '/api/v1/dashboard',
    '/api/v1/methods',
    '/api/v1/items',
    '/api/v1/items/trash',
    '/api/v1/reviews/complete',
    '/api/v1/method-applications',
    '/api/v1/backup',
    '/api/v1/backup/restore',
    '/api/v1/trash',
    '/api/v1/method-source-displays',
    '/api/v1/exploration-tracks',
    '/api/v1/exploration-tracks/selectable',
    '/api/v1/exploration-tracks/deleted',
    /^\/api\/v1\/exploration-tracks\/[^/]+(?:\/(?:history|restore))?$/,
    /^\/api\/v1\/reviews\/(?:by-item\/)?[^/]+$/,
    /^\/api\/v1\/items\/[^/]+(?:\/(?:status-events|content|start|status|restore|exploration-track))?$/,
    /^\/api\/v1\/methods\/(?:by-review\/[^/]+|[^/]+(?:\/(?:versions|evidence|restore))?)$/,
    /^\/api\/v1\/method-applications\/[^/]+\/context$/,
    /^\/api\/v1\/trash\/(?:item|method)\/[^/]+\/restore$/,
  ].some((pattern) => typeof pattern === 'string' ? pattern === path : pattern.test(path))
}

export const apiV1BasePath = '/api/v1'

function buildApiV1Routes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .route('/items', createItemRoutes(services))
    .route('/exploration-tracks', createExplorationTrackRoutes(services))
    .route('/reviews', createReviewRoutes(services))
    .route('/methods', createMethodRoutes(services))
    .route('/method-applications', createMethodApplicationRoutes(services))
    .route('/method-source-displays', createMethodSourceDisplayRoutes(services))
    .route('/backup', createBackupRoutes(services))
    .route('/trash', createTrashRoutes(services))
    .route('/search', createSearchRoutes(services))
    .route('/dashboard', createDashboardRoutes(services))
}

export function buildHonoApp(
  services: HonoServices,
  config: MySqlConnectionConfig,
) {
  const app = new Hono<ApiEnv>()
  app.use('*', requestContext)
  app.use('*', enforceBodyLimit)
  app.options('*', (context) => context.body(null, 204))

  const routes = app
    .route('/health', createHealthRoutes(services, config))
    .route(apiV1BasePath, buildApiV1Routes(services))

  routes.notFound((context) => isKnownApiPath(context.req.path)
    ? errorResponse(context, 405, 'METHOD_NOT_ALLOWED', '不允许的请求方法')
    : errorResponse(context, 404, 'NOT_FOUND_ROUTE', '路由不存在'))

  routes.onError((cause, context) => {
    reportUnexpectedFailure(context.get('requestId'), cause)
    const failure = mapFailure(cause)
    return errorResponse(context, failure.status, failure.code, failure.message, failure.businessCode)
  })

  return routes
}

export type AppType = ReturnType<typeof buildHonoApp>

export function createHonoApi(
  config = readMySqlConfig(process.env, 'app'),
) {
  const services = createHonoServices(config)
  const app = buildHonoApp(services, config)
  return {
    app,
    close: () => services.pool.end(),
  }
}
