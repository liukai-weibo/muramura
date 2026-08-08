import { createRoute, z } from '@hono/zod-openapi'
import { ApiError } from '../errors'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { itemSchema, methodSchema, trashEntrySchema } from '../schemas'

const trashFilterSchema = z.enum(['all', 'item', 'method', 'exploration-track'])

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
    200: jsonSuccess(z.union([itemSchema, methodSchema]).openapi('RestoredEntity'), '恢复后的实体'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const purgeEntrySchema = z.object({ type: trashFilterSchema.exclude(['all']), id: z.string().min(1) })
const purgeTrashRoute = createRoute({
  middleware: [requireJson],
  method: 'post', path: '/purge', tags: ['Trash'], summary: '永久删除回收站记录',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ entries: z.array(purgeEntrySchema).min(1) }) } } } },
  responses: { 204: { description: '永久删除完成' }, 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404], 409: commonErrorResponses[409] },
})

const purgeSingleTrashRoute = createRoute({
  method: 'delete', path: '/{type}/{id}', tags: ['Trash'], summary: '永久删除单条回收站记录',
  request: { params: z.object({ type: z.string(), id: z.string().min(1) }) },
  responses: { 204: { description: '永久删除完成' }, 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404], 409: commonErrorResponses[409] },
})

export function createTrashRoutes() {
  return createOpenApiApp()
    .openapi(listTrashRoute, async (context) => {
      const services = requireServices(context)
      const query = context.req.valid('query')
      return context.json(
        await services.trash.listTrashEntries(query.filter),
        200,
      )
    })

    .openapi(restoreTrashRoute, async (context) => {
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
    .openapi(purgeTrashRoute, async (context) => {
      const services = requireServices(context)
      const body = context.req.valid('json')
      await services.trash.purge(body.entries)
      return context.body(null, 204)
    })
    .openapi(purgeSingleTrashRoute, async (context) => {
      const services = requireServices(context)
      const parameters = context.req.valid('param')
      const type = z.enum(['item', 'method', 'exploration-track']).safeParse(parameters.type)
      if (!type.success) throw new ApiError(404, 'NOT_FOUND_ROUTE', '路由不存在')
      await services.trash.purge([{ type: type.data, id: decodeURIComponent(parameters.id) }])
      return context.body(null, 204)
    })
}
