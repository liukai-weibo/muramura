import { apiReference } from '@scalar/hono-api-reference'
import { readMySqlConfig, type MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { reportUnexpectedFailure } from '../api-errors'
import {
  requireAuthenticatedSession,
  requirePlatformAdministrator,
} from './auth-middleware'
import { errorResponse, mapFailure } from './errors'
import { enforceBodyLimit, requestContext } from './http'
import { createOpenApiApp, openApiInfo } from './openapi'
import { createAdminRoutes } from './routes/admin'
import { createAuthRoutes } from './routes/auth'
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
import { createRootHonoServices, type RootHonoServices } from './services'

function isKnownApiPath(path: string): boolean {
  return [
    '/health',
    '/openapi.json',
    '/docs',
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
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/auth/session',
    '/api/v1/admin/users',
    /^\/api\/v1\/admin\/users\/[^/]+\/(?:roles|revoke-sessions)$/,
    /^\/api\/v1\/exploration-tracks\/[^/]+(?:\/(?:history|restore))?$/,
    /^\/api\/v1\/reviews\/(?:by-item\/)?[^/]+$/,
    /^\/api\/v1\/items\/[^/]+(?:\/(?:status-events|content|start|status|restore|exploration-track))?$/,
    /^\/api\/v1\/methods\/(?:by-review\/[^/]+|[^/]+(?:\/(?:versions|evidence|restore))?)$/,
    /^\/api\/v1\/method-applications\/[^/]+\/context$/,
    /^\/api\/v1\/trash\/(?:item|method)\/[^/]+\/restore$/,
  ].some((pattern) => typeof pattern === 'string' ? pattern === path : pattern.test(path))
}

export const apiV1BasePath = '/api/v1'

function buildProtectedApiV1Routes(root: RootHonoServices) {
  return createOpenApiApp()
    .use('*', requireAuthenticatedSession(root))
    .use('/admin/*', requirePlatformAdministrator())
    .route('/admin', createAdminRoutes(root))
    .route('/items', createItemRoutes())
    .route('/exploration-tracks', createExplorationTrackRoutes())
    .route('/reviews', createReviewRoutes())
    .route('/methods', createMethodRoutes())
    .route('/method-applications', createMethodApplicationRoutes())
    .route('/method-source-displays', createMethodSourceDisplayRoutes())
    .route('/backup', createBackupRoutes())
    .route('/trash', createTrashRoutes())
    .route('/search', createSearchRoutes())
    .route('/dashboard', createDashboardRoutes())
}

export function buildHonoApp(
  root: RootHonoServices,
  config: MySqlConnectionConfig,
) {
  const app = createOpenApiApp()
  app.use('*', requestContext)
  app.use('*', enforceBodyLimit)
  app.options('*', (context) => context.body(null, 204))

  app.route('/health', createHealthRoutes(root, config))
  app.route(`${apiV1BasePath}/auth`, createAuthRoutes(root))
  app.route(apiV1BasePath, buildProtectedApiV1Routes(root))

  app.doc('/openapi.json', {
    openapi: openApiInfo.openapi,
    info: { ...openApiInfo.info },
    tags: [...openApiInfo.tags],
  })
  app.get(
    '/docs',
    apiReference({
      pageTitle: 'Knowledge Base API 文档',
      url: '/openapi.json',
    }),
  )

  app.notFound((context) => isKnownApiPath(context.req.path)
    ? errorResponse(context, 405, 'METHOD_NOT_ALLOWED', '不允许的请求方法')
    : errorResponse(context, 404, 'NOT_FOUND_ROUTE', '路由不存在'))

  app.onError((cause, context) => {
    reportUnexpectedFailure(context.get('requestId'), cause)
    const failure = mapFailure(cause)
    return errorResponse(context, failure.status, failure.code, failure.message, failure.businessCode)
  })

  return app
}

export type AppType = ReturnType<typeof buildHonoApp>

export function createHonoApi(
  config = readMySqlConfig(process.env, 'app'),
) {
  const root = createRootHonoServices(config)
  const app = buildHonoApp(root, config)
  return {
    app,
    close: () => root.pool.end(),
  }
}
