import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const idParamSchema = z.object({ id: z.string().min(1) })

export function createMethodRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .get('/', async (context) => context.json(await services.reviews.listMethods(), 200))
    .get(
      '/by-review/:id',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.reviews.listMethodsFromReview(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
    .get(
      '/:id/versions',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.reviews.listMethodVersions(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
    .get(
      '/:id/evidence',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.reviews.listMethodEvidenceDetails(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
    .post(
      '/:id/restore',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.methods.restore(decodeURIComponent(context.req.valid('param').id)),
        200,
      ),
    )
    .delete(
      '/:id',
      zValidator('param', idParamSchema),
      async (context) => {
        await services.methods.moveToTrash(decodeURIComponent(context.req.valid('param').id))
        return context.body(null, 204)
      },
    )
}
