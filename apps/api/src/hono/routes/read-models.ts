import { createRoute, z } from '@hono/zod-openapi'
import { validationError } from '../errors'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { dashboardReportSchema, searchResultSchema } from '../schemas'

const searchRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Search'],
  summary: '全文搜索',
  description: '按 query 关键词搜索事项与方法等内容；空 query 返回空结果集。',
  request: {
    query: z.object({
      query: z.string().optional(),
    }),
  },
  responses: {
    200: jsonSuccess(z.array(searchResultSchema), '搜索结果'),
    401: commonErrorResponses[401],
  },
})

const dashboardRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Dashboard'],
  summary: '仪表盘报表',
  description: '按时间窗口 window（7d、30d、all）返回仪表盘统计数据。',
  request: {
    query: z.object({
      window: z.enum(['7d', '30d', 'all']),
    }),
  },
  responses: {
    200: jsonSuccess(dashboardReportSchema, '仪表盘报表'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
})

export function createSearchRoutes() {
  return createOpenApiApp()
    .openapi(searchRoute, async (context) => {
      const services = requireServices(context)
      const query = context.req.valid('query')
      return context.json(
        await services.search.search(query.query ?? ''),
        200,
      )
    })
}

export function createDashboardRoutes() {
  return createOpenApiApp()
    .openapi(dashboardRoute, async (context) => {
      const services = requireServices(context)
      const query = context.req.valid('query')
      if (!['7d', '30d', 'all'].includes(query.window)) {
        throw validationError('无效的仪表盘时间范围')
      }
      return context.json(
        await services.dashboard.getReport(query.window),
        200,
      )
    })
}
