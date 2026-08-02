import { createRoute, z } from '@hono/zod-openapi'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { methodEvidenceDetailSchema, methodSchema, methodVersionSchema } from '../schemas'

const idParamSchema = z.object({ id: z.string().min(1) })

const listMethodsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Methods'],
  summary: '列出方法',
  description: '返回方法库中所有可用方法的摘要列表。',
  responses: {
    200: jsonSuccess(z.array(methodSchema), '方法列表'),
    401: commonErrorResponses[401],
  },
})

const listMethodsByReviewRoute = createRoute({
  method: 'get',
  path: '/by-review/{id}',
  tags: ['Methods'],
  summary: '按复盘列出方法',
  description: '返回指定复盘关联的方法列表。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(z.array(methodSchema), '方法列表'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const listMethodVersionsRoute = createRoute({
  method: 'get',
  path: '/{id}/versions',
  tags: ['Methods'],
  summary: '列出方法版本',
  description: '返回指定方法的历史版本列表。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(z.array(methodVersionSchema), '方法版本列表'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const listMethodEvidenceRoute = createRoute({
  method: 'get',
  path: '/{id}/evidence',
  tags: ['Methods'],
  summary: '列出方法证据',
  description: '返回指定方法的证据详情列表。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(z.array(methodEvidenceDetailSchema), '方法证据列表'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const restoreMethodRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Methods'],
  summary: '恢复方法',
  description: '从回收站恢复指定方法。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(methodSchema, '恢复后的方法'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const deleteMethodRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Methods'],
  summary: '移入回收站',
  description: '将指定方法软删除并移入回收站。',
  request: {
    params: idParamSchema,
  },
  responses: {
    204: { description: '已移入回收站' },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

export function createMethodRoutes() {
  return createOpenApiApp()
    .openapi(listMethodsRoute, async (context) => {
      const services = requireServices(context)
      return context.json(await services.reviews.listMethods(), 200)
    })

    .openapi(listMethodsByReviewRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.reviews.listMethodsFromReview(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      )
    })

    .openapi(listMethodVersionsRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.reviews.listMethodVersions(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      )
    })

    .openapi(listMethodEvidenceRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.reviews.listMethodEvidenceDetails(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      )
    })

    .openapi(restoreMethodRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.methods.restore(decodeURIComponent(context.req.valid('param').id)),
        200,
      )
    })

    .openapi(deleteMethodRoute, async (context) => {
      const services = requireServices(context)
      await services.methods.moveToTrash(decodeURIComponent(context.req.valid('param').id))
      return context.body(null, 204)
    })
}
