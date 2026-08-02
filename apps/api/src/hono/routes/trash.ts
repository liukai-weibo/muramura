import { createRoute, z } from '@hono/zod-openapi'
import { ApiError } from '../errors'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const trashFilterSchema = z.enum(['all', 'item', 'method', 'exploration-track'])

const trashEntrySchema = z.object({
  type: z.string(),
  id: z.string(),
}).passthrough().openapi('TrashEntry')

const listTrashRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Trash'],
  summary: '列出回收站',
  description: '按 filter 筛选统一回收站条目：all、item、method、exploration-track。',
  request: {
    query: z.object({
      filter: trashFilterSchema,
    }),
  },
  responses: {
    200: jsonSuccess(z.array(trashEntrySchema), '回收站条目列表'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
})

const restoreTrashRoute = createRoute({
  method: 'post',
  path: '/{type}/{id}/restore',
  tags: ['Trash'],
  summary: '恢复回收站条目',
  description: '按 type（item 或 method）与 id 恢复对应实体。',
  request: {
    params: z.object({
      type: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: jsonSuccess(z.object({ id: z.string() }).passthrough().openapi('RestoredEntity'), '恢复后的实体'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

export function createTrashRoutes() {
  const app = createOpenApiApp()

  app.openapi(listTrashRoute, async (context) => {
    const services = requireServices(context)
    const query = context.req.valid('query')
    return context.json(
      await services.trash.listTrashEntries(query.filter),
      200,
    )
  })

  app.openapi(restoreTrashRoute, async (context) => {
    const services = requireServices(context)
    const parameters = context.req.valid('param')
    const parsed = z.object({
      type: z.enum(['item', 'method']),
      id: z.string().min(1),
    }).safeParse(parameters)
    if (!parsed.success) {
      throw new ApiError(404, 'NOT_FOUND_ROUTE', '路由不存在')
    }
    const id = decodeURIComponent(parsed.data.id)
    return context.json(
      parsed.data.type === 'item'
        ? await services.items.restoreItem(id)
        : await services.methods.restore(id),
      200,
    )
  })

  return app
}
