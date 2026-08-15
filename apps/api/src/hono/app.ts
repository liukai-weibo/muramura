import { apiReference } from '@scalar/hono-api-reference'
import { readMySqlConfig, type MySqlConnectionConfig } from '@knowledge-base/storage-mysql'
import { reportUnexpectedFailure } from '../api-errors'
import {
  requireAuthenticatedSession,
  requireAdministrator,
} from './auth-middleware'
import { errorResponse, mapFailure } from './errors'
import { enforceBodyLimit, requestContext } from './http'
import { createOpenApiApp, openApiInfo } from './openapi'
import { apiV1BasePath } from './paths'
import { createAccountRoutes } from './routes/account'
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
import { createAiRoutes } from './routes/ai'
import { createDailyNoteRoutes } from './routes/daily-notes'
import { createRootHonoServices, type RootHonoServices } from './services'

/**
 * 业务路由的唯一组合入口。
 *
 * 这里故意不挂认证中间件：同一份路由树既供运行时安全外壳挂载，也用于导出
 * Hono RPC 契约。这样不会复制路由清单，也避免 `.use()` 让后续端点从类型图中丢失。
 */
function buildBusinessApiV1Routes(root: RootHonoServices) {
  return createOpenApiApp()
    .route('/account', createAccountRoutes(root))
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
    .route('/daily-notes', createDailyNoteRoutes())
    .route('/', createAiRoutes())
}

/** 运行时安全外壳：先认证，再对 `/admin/*` 追加平台管理员校验。 */
function buildProtectedApiV1Routes(root: RootHonoServices) {
  return createOpenApiApp()
    .use('*', requireAuthenticatedSession(root))
    .use('/admin/*', requireAdministrator())
    .route('/', buildBusinessApiV1Routes(root))
}

/**
 * Hono RPC 的纯路由契约。
 *
 * Hono 的全局中间件和 `onError` 不参与客户端端点推导，因此这里仅组合有明确
 * `createRoute` 输入/输出的路由。它不是第二套运行时实现，handler 仍来自同一批路由模块。
 */
export function buildRpcContractRoutes(
  root: RootHonoServices,
  config: MySqlConnectionConfig,
) {
  return createOpenApiApp()
    .route('/health', createHealthRoutes(root, config))
    .route(`${apiV1BasePath}/auth`, createAuthRoutes(root))
    .route(apiV1BasePath, buildBusinessApiV1Routes(root))
    .route(apiV1BasePath, createAiRoutes())
}

/** 供 Hono RPC Client（`hc<AppType>()`）使用的服务端路由类型。 */
export type AppType = ReturnType<typeof buildRpcContractRoutes>

/** 把 Hono 路由 path（含 `:id`）编成精确匹配正则。 */
function createKnownPathMatcher(routes: ReadonlyArray<{ path: string }>) {
  const patterns = [...new Set(
    routes
      // 排除中间件前缀，否则 `/*` 会把任意地址都误判为已知路由。
      .map((route) => route.path)
      .filter((path) => path !== '/*' && !path.endsWith('/*')),
  )].map((path) => {
    const source = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) return '[^/]+'
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('/')
    return new RegExp(`^${source}$`)
  })
  return (pathname: string) => patterns.some((pattern) => pattern.test(pathname))
}

/**
 * 组装真正运行的 API。
 *
 * 认证、管理员授权、body limit、404/405 与异常映射都只属于服务端运行时；
 * RPC 客户端类型由上面的纯路由契约推导，二者不要混成同一条 Hono 类型链。
 */
export function buildHonoApp(
  root: RootHonoServices,
  config: MySqlConnectionConfig,
) {
  const routes = createOpenApiApp()
    .route('/health', createHealthRoutes(root, config))
    .route(`${apiV1BasePath}/auth`, createAuthRoutes(root))
    .route(apiV1BasePath, buildProtectedApiV1Routes(root))
    .doc('/openapi.json', {
      openapi: openApiInfo.openapi,
      info: { ...openApiInfo.info },
      tags: [...openApiInfo.tags],
    })
    .get(
      '/docs',
      apiReference({
        pageTitle: 'Knowledge Base API 文档',
        url: '/openapi.json',
      }),
    )

  const app = createOpenApiApp()
    .use('*', requestContext)
    .use('*', enforceBodyLimit)
    .options('*', (context) => context.body(null, 204))
    .route('/', routes)

  const isKnownApiPath = createKnownPathMatcher(app.routes)
  return app
    .notFound((context) => isKnownApiPath(context.req.path)
      ? errorResponse(context, 405, 'METHOD_NOT_ALLOWED', '不允许的请求方法')
      : errorResponse(context, 404, 'NOT_FOUND_ROUTE', '路由不存在'))
    .onError((cause, context) => {
      reportUnexpectedFailure(context.get('requestId'), cause)
      const failure = mapFailure(cause)
      return errorResponse(context, failure.status, failure.code, failure.message, failure.businessCode)
    })
}

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
