import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { itemStatuses } from '@knowledge-base/contracts'
import { z } from 'zod'
import { ApiError } from '../errors'
import { requireJson } from '../http'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const currentAssociatedStatuses = ['doing', 'idea_to_try', 'idea_later', 'paused'] as const
const statusSchema = z.enum(itemStatuses)
const currentAssociatedStatusSchema = z.enum(currentAssociatedStatuses)
const idParamSchema = z.object({ id: z.string().min(1) })

const explorationTrackSelectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing'), trackId: z.string() }),
  z.object({ type: z.literal('new'), name: z.string() }),
])

const createItemSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  saveForLater: z.boolean().optional(),
  explorationTrack: explorationTrackSelectionSchema.optional(),
})

const itemLocatorQuerySchema = z.object({
  status: currentAssociatedStatusSchema.optional(),
  explorationTrackId: z.string().min(1).optional(),
}).refine(
  (value) => (value.status === undefined) === (value.explorationTrackId === undefined),
  { message: '事项定位参数无效' },
)

const updateContentSchema = z.object({ content: z.string() })
const startItemSchema = z.object({
  startAction: z.string().optional(),
  overwriteExistingStartAction: z.boolean().optional(),
})
const changeStatusSchema = z.object({ status: statusSchema })
const assignExplorationTrackSchema = z.object({ trackId: z.string() })

const invalidJson = (message: string) => new ApiError(400, 'VALIDATION_FAILED', message)

export function createItemRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .get(
      '/',
      zValidator('query', itemLocatorQuerySchema, (result) => {
        if (!result.success) throw invalidJson('事项定位参数无效')
      }),
      async (context) => {
        const statuses = context.req.queries('status') ?? []
        const trackIds = context.req.queries('explorationTrackId') ?? []
        if (statuses.length === 0 && trackIds.length === 0) {
          return context.json(await services.items.listItems(), 200)
        }
        const query = context.req.valid('query')
        if (
          statuses.length !== 1
          || trackIds.length !== 1
          || query.status === undefined
          || query.explorationTrackId === undefined
        ) {
          throw invalidJson('事项定位参数无效')
        }
        return context.json(
          await services.explorationTracks.listItemsByExplorationTrackAndStatus(
            query.explorationTrackId,
            query.status,
          ),
          200,
        )
      },
    )
    .post(
      '/',
      requireJson,
      zValidator('json', createItemSchema, (result) => {
        if (!result.success) throw invalidJson('事项参数无效')
      }),
      async (context) => context.json(
        await services.items.createIdea(context.req.valid('json')),
        201,
      ),
    )
    .get('/trash', async (context) => context.json(await services.items.listTrash(), 200))
    .get(
      '/:id/exploration-track',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.explorationTracks.getItemExplorationTrackContext(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
    .put(
      '/:id/exploration-track',
      zValidator('param', idParamSchema),
      requireJson,
      zValidator('json', assignExplorationTrackSchema, (result) => {
        if (!result.success) throw invalidJson('trackId必须是字符串')
      }),
      async (context) => context.json(
        await services.explorationTracks.assignItemToExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').trackId,
        ),
        200,
      ),
    )
    .delete(
      '/:id/exploration-track',
      zValidator('param', idParamSchema),
      async (context) => {
        await services.explorationTracks.removeItemFromExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
        )
        return context.body(null, 204)
      },
    )
    .get(
      '/:id/status-events',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.items.listStatusEvents(decodeURIComponent(context.req.valid('param').id)),
        200,
      ),
    )
    .patch(
      '/:id/content',
      zValidator('param', idParamSchema),
      requireJson,
      zValidator('json', updateContentSchema, (result) => {
        if (!result.success) throw invalidJson('content必须是字符串')
      }),
      async (context) => context.json(
        await services.items.updateItemContent(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').content,
        ),
        200,
      ),
    )
    .post(
      '/:id/start',
      zValidator('param', idParamSchema),
      requireJson,
      zValidator('json', startItemSchema, (result) => {
        if (!result.success) throw invalidJson('开始执行参数无效')
      }),
      async (context) => {
        const input = context.req.valid('json')
        return context.json(
          await services.items.startExecution(
            decodeURIComponent(context.req.valid('param').id),
            input.startAction,
            input.overwriteExistingStartAction,
          ),
          200,
        )
      },
    )
    .post(
      '/:id/status',
      zValidator('param', idParamSchema),
      requireJson,
      zValidator('json', changeStatusSchema, (result) => {
        if (!result.success) throw invalidJson('事项状态无效')
      }),
      async (context) => context.json(
        await services.items.changeStatus(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').status,
        ),
        200,
      ),
    )
    .post(
      '/:id/restore',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.items.restoreItem(decodeURIComponent(context.req.valid('param').id)),
        200,
      ),
    )
    .get(
      '/:id',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.items.getItem(decodeURIComponent(context.req.valid('param').id)),
        200,
      ),
    )
    .delete(
      '/:id',
      zValidator('param', idParamSchema),
      async (context) => {
        await services.items.deleteItem(decodeURIComponent(context.req.valid('param').id))
        return context.body(null, 204)
      },
    )
}
