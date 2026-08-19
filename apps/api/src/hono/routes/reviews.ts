import { createRoute, z } from '@hono/zod-openapi'
import { ApiError } from '../errors'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { completeReviewResultSchema, reviewSchema } from '../schemas'

const idParamSchema = z.object({ id: z.string().min(1) })

const methodSchema = z.object({
  title: z.string(),
  applicable: z.string(),
  unsuitable: z.string().optional(),
  steps: z.string(),
}).openapi('ReviewMethodInput')

const completeReviewSchema = z.object({
  itemId: z.string(),
  actualAction: z.string(),
  result: z.string(),
  effective: z.string().optional(),
  incompatible: z.string().optional(),
  reason: z.string().optional(),
  adjustment: z.string().optional(),
  newIdeas: z.string().optional(),
  method: methodSchema.optional(),
  existingMethod: z.object({
    methodId: z.string(),
    revision: methodSchema.optional(),
  }).optional(),
}).openapi('CompleteReviewInput')

const completeReviewRoute = createRoute({
  middleware: [requireJson],
  method: 'post',
  path: '/complete',
  tags: ['Reviews'],
  summary: '完成复盘',
  description: '提交复盘表单并可选创建或修订方法；成功返回 201。',
  request: {
    body: { required: true, content: { 'application/json': { schema: completeReviewSchema } } },
  },
  responses: {
    201: jsonSuccess(completeReviewResultSchema, '复盘结果'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const getReviewByItemRoute = createRoute({
  method: 'get',
  path: '/by-item/{id}',
  tags: ['Reviews'],
  summary: '按事项查复盘',
  description: '返回指定事项关联的复盘；不存在时 404。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(reviewSchema, '复盘详情'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const getReviewRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Reviews'],
  summary: '按 ID 查复盘',
  description: '返回指定复盘详情；不存在时 404。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(reviewSchema, '复盘详情'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

export function createReviewRoutes() {
  return createOpenApiApp()
    .openapi(completeReviewRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.reviews.completeReview({ ...context.req.valid('json'), effective: context.req.valid('json').effective ?? '', incompatible: context.req.valid('json').incompatible ?? '', reason: context.req.valid('json').reason ?? '', adjustment: context.req.valid('json').adjustment ?? '' }),
        201,
      )
    })

    .openapi(getReviewByItemRoute, async (context) => {
      const services = requireServices(context)
      const review = await services.reviews.getReviewForItem(
        decodeURIComponent(context.req.valid('param').id),
      )
      if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在')
      return context.json(review, 200)
    })

    .openapi(getReviewRoute, async (context) => {
      const services = requireServices(context)
      const review = await services.reviews.getReview(
        decodeURIComponent(context.req.valid('param').id),
      )
      if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在')
      return context.json(review, 200)
    })
}
