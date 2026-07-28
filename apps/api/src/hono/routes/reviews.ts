import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from '../errors'
import { requireJson } from '../http'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const idParamSchema = z.object({ id: z.string().min(1) })
const methodSchema = z.object({
  title: z.string(),
  applicable: z.string(),
  unsuitable: z.string().optional(),
  steps: z.string(),
})
const completeReviewSchema = z.object({
  itemId: z.string(),
  actualAction: z.string(),
  result: z.string(),
  effective: z.string(),
  incompatible: z.string(),
  reason: z.string(),
  adjustment: z.string(),
  newIdeas: z.string().optional(),
  method: methodSchema.optional(),
  existingMethod: z.object({
    methodId: z.string(),
    revision: methodSchema.optional(),
  }).optional(),
})

export function createReviewRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .post(
      '/complete',
      requireJson,
      zValidator('json', completeReviewSchema, (result) => {
        if (!result.success) {
          throw new ApiError(400, 'VALIDATION_FAILED', '复盘参数无效')
        }
      }),
      async (context) => context.json(
        await services.reviews.completeReview(context.req.valid('json')),
        201,
      ),
    )
    .get(
      '/by-item/:id',
      zValidator('param', idParamSchema),
      async (context) => {
        const review = await services.reviews.getReviewForItem(
          decodeURIComponent(context.req.valid('param').id),
        )
        if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在')
        return context.json(review, 200)
      },
    )
    .get(
      '/:id',
      zValidator('param', idParamSchema),
      async (context) => {
        const review = await services.reviews.getReview(
          decodeURIComponent(context.req.valid('param').id),
        )
        if (!review) throw new ApiError(404, 'NOT_FOUND', '复盘不存在')
        return context.json(review, 200)
      },
    )
}
