import { createRoute, z } from '@hono/zod-openapi'
import { validationError } from '../errors'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const idParamSchema = z.object({ id: z.string().min(1) })

const createMethodApplicationSchema = z.object({
  methodId: z.string(),
  title: z.string(),
  content: z.string().optional(),
}).openapi('CreateMethodApplicationInput')

const methodApplicationSchema = z.unknown().openapi('MethodApplication')

const methodApplicationContextSchema = z.unknown().openapi('MethodApplicationContext')

const sourceDisplayListSchema = z.array(z.unknown()).openapi('MethodSourceDisplayList')

const methodSourceDisplaysUrlLimit = 8 * 1024

const createMethodApplicationRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['MethodApplications'],
  summary: '创建方法应用',
  description: '基于方法库条目创建新的方法应用事项。',
  request: {
    body: { required: true, content: { 'application/json': { schema: createMethodApplicationSchema } } },
  },
  responses: {
    201: jsonSuccess(methodApplicationSchema, '新建方法应用'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    415: commonErrorResponses[415],
  },
})

const getMethodApplicationContextRoute = createRoute({
  method: 'get',
  path: '/{id}/context',
  tags: ['MethodApplications'],
  summary: '方法应用上下文',
  description: '返回指定事项的方法应用上下文与来源展示信息。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(methodApplicationContextSchema, '方法应用上下文'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const listSourceDisplaysRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['MethodApplications'],
  summary: '批量来源展示',
  description: '按逗号分隔的 itemIds 查询方法来源展示；URL 总长不超过 8KB，最多 100 个 id。',
  request: {
    query: z.object({
      itemIds: z.string().optional(),
    }),
  },
  responses: {
    200: jsonSuccess(sourceDisplayListSchema, '来源展示列表'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
})

export function createMethodApplicationRoutes() {
  const app = createOpenApiApp()
  app.on('POST', '/', requireJson)

  app.openapi(createMethodApplicationRoute, async (context) => {
    const services = requireServices(context)
    const input = context.req.valid('json')
    return context.json(
      await services.methodApplications.createItem(
        input.methodId,
        input.title,
        input.content,
      ),
      201,
    )
  })

  app.openapi(getMethodApplicationContextRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.methodApplications.getContextResultForItem(
        decodeURIComponent(context.req.valid('param').id),
      ),
      200,
    )
  })

  return app
}

export function createMethodSourceDisplayRoutes() {
  const app = createOpenApiApp()

  app.openapi(listSourceDisplaysRoute, async (context) => {
    const services = requireServices(context)
    const raw = context.req.valid('query').itemIds ?? ''
    const itemIds = raw ? raw.split(',') : []
    const requestUrl = new URL(context.req.url)
    if (
      requestUrl.pathname.length + requestUrl.search.length > methodSourceDisplaysUrlLimit
      || itemIds.length > 100
      || itemIds.some((value) => !value)
    ) {
      throw validationError('itemIds 参数无效')
    }
    return context.json(
      await services.methodApplications.listSourceDisplaysForItems(itemIds),
      200,
    )
  })

  return app
}
