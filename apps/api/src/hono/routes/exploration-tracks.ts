import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError, validationError } from '../errors'
import { requireJson } from '../http'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const idParamSchema = z.object({ id: z.string().min(1) })
const nameSchema = z.object({ name: z.string() })

export function createExplorationTrackRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .get('/', async (context) => context.json(
      await services.explorationTracks.listActiveExplorationTracks(),
      200,
    ))
    .get('/selectable', async (context) => context.json(
      await services.explorationTracks.listSelectableExplorationTracks(),
      200,
    ))
    .get('/deleted', async (context) => context.json(
      await services.explorationTracks.listDeletedExplorationTracks(),
      200,
    ))
    .post(
      '/',
      requireJson,
      zValidator('json', nameSchema, (result) => {
        if (!result.success) throw validationError('name必须是字符串')
      }),
      async (context) => context.json(
        await services.explorationTracks.createExplorationTrack(context.req.valid('json').name),
        201,
      ),
    )
    .get(
      '/:id/history',
      zValidator('param', idParamSchema),
      async (context) => {
        const history = await services.explorationTracks.getExplorationTrackHistory(
          decodeURIComponent(context.req.valid('param').id),
        )
        if (!history) throw new ApiError(404, 'NOT_FOUND', '探索主线不存在')
        return context.json(history, 200)
      },
    )
    .post(
      '/:id/restore',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.explorationTracks.restoreExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
    .patch(
      '/:id',
      zValidator('param', idParamSchema),
      requireJson,
      zValidator('json', nameSchema, (result) => {
        if (!result.success) throw validationError('name必须是字符串')
      }),
      async (context) => context.json(
        await services.explorationTracks.renameExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').name,
        ),
        200,
      ),
    )
    .delete(
      '/:id',
      zValidator('param', idParamSchema),
      async (context) => {
        await services.explorationTracks.deleteExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
        )
        return context.body(null, 204)
      },
    )
}
