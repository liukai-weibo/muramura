import { createRoute, z } from '@hono/zod-openapi'
import { ApiError, validationError } from '../errors'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import {
  deletedExplorationTrackListEntrySchema,
  explorationTrackHistorySchema,
  explorationTrackDescriptionInputSchema,
  explorationTrackListEntrySchema,
  explorationTrackSchema,
} from '../schemas'

const idParamSchema = z.object({ id: z.string().min(1) })
const nameSchema = z.object({ name: z.string() }).openapi('ExplorationTrackNameInput')

const listActiveRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['ExplorationTracks'],
  summary: '列出活跃探索主线',
  description: '返回未软删的探索主线列表。',
  responses: {
    200: jsonSuccess(z.array(explorationTrackListEntrySchema), '活跃探索主线'),
    401: commonErrorResponses[401],
  },
})

const listSelectableRoute = createRoute({
  method: 'get',
  path: '/selectable',
  tags: ['ExplorationTracks'],
  summary: '列出可选探索主线',
  description: '返回可用于关联事项的可选探索主线。',
  responses: {
    200: jsonSuccess(z.array(explorationTrackSchema), '可选探索主线'),
    401: commonErrorResponses[401],
  },
})

const listDeletedRoute = createRoute({
  method: 'get',
  path: '/deleted',
  tags: ['ExplorationTracks'],
  summary: '列出已删探索主线',
  description: '返回已软删、可恢复的探索主线列表。',
  responses: {
    200: jsonSuccess(z.array(deletedExplorationTrackListEntrySchema), '已删探索主线'),
    401: commonErrorResponses[401],
  },
})

const createTrackRoute = createRoute({
  middleware: [requireJson],
  method: 'post',
  path: '/',
  tags: ['ExplorationTracks'],
  summary: '创建探索主线',
  description: '按名称创建新的探索主线。',
  request: {
    body: { required: true, content: { 'application/json': { schema: nameSchema } } },
  },
  responses: {
    201: jsonSuccess(explorationTrackSchema, '新建探索主线'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    415: commonErrorResponses[415],
  },
})

const getHistoryRoute = createRoute({
  method: 'get',
  path: '/{id}/history',
  tags: ['ExplorationTracks'],
  summary: '探索主线历史',
  description: '返回指定探索主线的变更历史；不存在时 404。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(explorationTrackHistorySchema, '探索主线历史'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const restoreTrackRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['ExplorationTracks'],
  summary: '恢复探索主线',
  description: '从软删状态恢复指定探索主线。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(explorationTrackSchema, '恢复后的探索主线'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const renameTrackRoute = createRoute({
  middleware: [requireJson],
  method: 'patch',
  path: '/{id}',
  tags: ['ExplorationTracks'],
  summary: '重命名探索主线',
  description: '更新指定探索主线的名称。',
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: nameSchema } } },
  },
  responses: {
    200: jsonSuccess(explorationTrackSchema, '更新后的探索主线'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    415: commonErrorResponses[415],
  },
})

const updateDescriptionRoute = createRoute({
  middleware: [requireJson],
  method: 'patch',
  path: '/{id}/description',
  tags: ['ExplorationTracks'],
  summary: '更新长期探索描述',
  request: { params: idParamSchema, body: { required: true, content: { 'application/json': { schema: explorationTrackDescriptionInputSchema } } } },
  responses: { 200: jsonSuccess(explorationTrackSchema, '更新后的长期探索'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404], 415: commonErrorResponses[415] },
})

const archiveTrackRoute = createRoute({
  method: 'post',
  path: '/{id}/archive',
  tags: ['ExplorationTracks'],
  summary: '归档探索主线',
  description: '将探索主线归档：从默认/可选列表收拢，旗下未删除子行动一并归档（显示层，不删除）。',
  request: { params: idParamSchema },
  responses: { 204: { description: '已归档' }, 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
})

const unarchiveTrackRoute = createRoute({
  method: 'post',
  path: '/{id}/unarchive',
  tags: ['ExplorationTracks'],
  summary: '取消探索主线归档',
  description: '将已归档探索主线恢复：回到默认/可选列表，旗下子行动一并恢复。',
  request: { params: idParamSchema },
  responses: { 200: jsonSuccess(explorationTrackSchema, '恢复后的探索主线'), 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
})

const dragnet = createRoute({
  method: 'get',
  path: '/archived',
  tags: ['ExplorationTracks'],
  summary: '列出已归档探索主线',
  description: '返回已归档、可取消归档的探索主线列表（含最近子行动）。',
  responses: { 200: jsonSuccess(z.array(explorationTrackListEntrySchema), '已归档探索主线'), 401: commonErrorResponses[401] },
})

const deleteTrackRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['ExplorationTracks'],
  summary: '软删探索主线',
  description: '将指定探索主线移入软删状态。',
  request: {
    params: idParamSchema,
  },
  responses: {
    204: { description: '已软删' },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

export function createExplorationTrackRoutes() {
  return createOpenApiApp()
    .openapi(listActiveRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.listActiveExplorationTracks(),
        200,
      )
    })

    .openapi(listSelectableRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.listSelectableExplorationTracks(),
        200,
      )
    })

    .openapi(listDeletedRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.listDeletedExplorationTracks(),
        200,
      )
    })

    .openapi(createTrackRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.createExplorationTrack(context.req.valid('json').name),
        201,
      )
    })

    .openapi(getHistoryRoute, async (context) => {
      const services = requireServices(context)
      const history = await services.explorationTracks.getExplorationTrackHistory(
        decodeURIComponent(context.req.valid('param').id),
      )
      if (!history) throw new ApiError(404, 'NOT_FOUND', '探索主线不存在')
      return context.json(history, 200)
    })

    .openapi(restoreTrackRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.restoreExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      )
    })

    .openapi(renameTrackRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.renameExplorationTrack(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').name,
        ),
        200,
      )
    })

    .openapi(updateDescriptionRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.updateExplorationTrackDescription(
          decodeURIComponent(context.req.valid('param').id),
          context.req.valid('json').description,
        ),
        200,
      )
    })

    .openapi(deleteTrackRoute, async (context) => {
      const services = requireServices(context)
      await services.explorationTracks.deleteExplorationTrack(
        decodeURIComponent(context.req.valid('param').id),
      )
      return context.body(null, 204)
    })

    .openapi(dragnet, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.listArchivedExplorationTracks(),
        200,
      )
    })

    .openapi(archiveTrackRoute, async (context) => {
      const services = requireServices(context)
      await services.explorationTracks.archiveExplorationTrack(
        decodeURIComponent(context.req.valid('param').id),
      )
      return context.body(null, 204)
    })

    .openapi(unarchiveTrackRoute, async (context) => {
      const services = requireServices(context)
      return context.json(
        await services.explorationTracks.restoreExplorationTrackFromArchive(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      )
    })
}
