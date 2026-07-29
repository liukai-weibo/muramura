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
    .route('/api/v1/items', createItemRoutes(services))
    .route('/api/v1/exploration-tracks', createExplorationTrackRoutes(services))
    .route('/api/v1/reviews', createReviewRoutes(services))
    .route('/api/v1/methods', createMethodRoutes(services))
    .route('/api/v1/method-applications', createMethodApplicationRoutes(services))
    .route('/api/v1/method-source-displays', createMethodSourceDisplayRoutes(services))
    .route('/api/v1/backup', createBackupRoutes(services))
    .route('/api/v1/trash', createTrashRoutes(services))
    .route('/api/v1/search', createSearchRoutes(services))
    .route('/api/v1/dashboard', createDashboardRoutes(services))

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
