import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from '../errors'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const searchQuerySchema = z.object({ query: z.string().optional() })
const dashboardQuerySchema = z.object({ window: z.enum(['7d', '30d', 'all']) })

export function createSearchRoutes(services: HonoServices) {
  return new Hono<ApiEnv>().get(
    '/',
    zValidator('query', searchQuerySchema),
    async (context) => context.json(
      await services.search.search(context.req.valid('query').query ?? ''),
      200,
    ),
  )
}

export function createDashboardRoutes(services: HonoServices) {
  return new Hono<ApiEnv>().get(
    '/',
    zValidator('query', dashboardQuerySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, 'VALIDATION_FAILED', '无效的仪表盘时间范围')
      }
    }),
    async (context) => context.json(
      await services.dashboard.getReport(context.req.valid('query').window),
      200,
    ),
  )
}
