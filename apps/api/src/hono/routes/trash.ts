import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from '../errors'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const trashFilterSchema = z.enum(['all', 'item', 'method', 'exploration-track'])
const trashQuerySchema = z.object({ filter: trashFilterSchema })
const restoreParamSchema = z.object({
  type: z.enum(['item', 'method']),
  id: z.string().min(1),
})

export function createTrashRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .get(
      '/',
      zValidator('query', trashQuerySchema, (result) => {
        if (!result.success) {
          throw new ApiError(400, 'VALIDATION_FAILED', '无效的回收站筛选条件')
        }
      }),
      async (context) => context.json(
        await services.trash.listTrashEntries(context.req.valid('query').filter),
        200,
      ),
    )
    .post(
      '/:type/:id/restore',
      zValidator('param', restoreParamSchema, (result) => {
        if (!result.success) {
          throw new ApiError(404, 'NOT_FOUND_ROUTE', '路由不存在')
        }
      }),
      async (context) => {
        const parameters = context.req.valid('param')
        const id = decodeURIComponent(parameters.id)
        return context.json(
          parameters.type === 'item'
            ? await services.items.restoreItem(id)
            : await services.methods.restore(id),
          200,
        )
      },
    )
}
