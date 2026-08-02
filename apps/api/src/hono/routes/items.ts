import { createRoute, z } from '@hono/zod-openapi'
import { itemStatuses } from '@knowledge-base/contracts'
import { ApiError, validationError } from '../errors'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

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
}).openapi('CreateItemInput')

const itemLocatorQuerySchema = z.object({
  status: currentAssociatedStatusSchema.optional(),
  explorationTrackId: z.string().min(1).optional(),
}).refine(
  (value) => (value.status === undefined) === (value.explorationTrackId === undefined),
  { message: '事项定位参数无效' },
)

const updateContentSchema = z.object({ content: z.string() }).openapi('UpdateItemContentInput')
const startItemSchema = z.object({
  startAction: z.string().optional(),
  overwriteExistingStartAction: z.boolean().optional(),
}).openapi('StartItemInput')
const changeStatusSchema = z.object({ status: statusSchema }).openapi('ChangeItemStatusInput')
const assignExplorationTrackSchema = z.object({ trackId: z.string() }).openapi('AssignExplorationTrackInput')

const itemSchema = z.object({
  id: z.string(),
  status: z.string(),
}).passthrough().openapi('Item')

const statusEventSchema = z.object({
  id: z.string(),
}).passthrough().openapi('ItemStatusEvent')

const explorationTrackContextSchema = z.object({
  itemId: z.string(),
}).passthrough().openapi('ItemExplorationTrackContext')

const listItemsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Items'],
  summary: '列出事项',
  description: '无 query 时返回全部事项；同时提供 status 与 explorationTrackId 时按主线与状态筛选。',
  request: {
    query: itemLocatorQuerySchema,
  },
  responses: {
    200: jsonSuccess(z.array(itemSchema), '事项列表'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
})

const createItemRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Items'],
  summary: '创建事项',
  description: '创建新想法事项，可选关联探索主线或稍后保存。',
  request: {
    body: { required: true, content: { 'application/json': { schema: createItemSchema } } },
  },
  responses: {
    201: jsonSuccess(itemSchema, '新建事项'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    415: commonErrorResponses[415],
  },
})

const listItemTrashRoute = createRoute({
  method: 'get',
  path: '/trash',
  tags: ['Items'],
  summary: '列出已删事项',
  description: '返回事项回收站中的已删事项列表。',
  responses: {
    200: jsonSuccess(z.array(itemSchema), '已删事项列表'),
    401: commonErrorResponses[401],
  },
})

const getItemExplorationTrackRoute = createRoute({
  method: 'get',
  path: '/{id}/exploration-track',
  tags: ['Items'],
  summary: '事项探索主线上下文',
  description: '返回指定事项当前关联的探索主线上下文。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(explorationTrackContextSchema, '探索主线上下文'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const assignItemExplorationTrackRoute = createRoute({
  method: 'put',
  path: '/{id}/exploration-track',
  tags: ['Items'],
  summary: '关联探索主线',
  description: '将事项关联到指定探索主线。',
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: assignExplorationTrackSchema } } },
  },
  responses: {
    200: jsonSuccess(explorationTrackContextSchema, '更新后的探索主线上下文'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    415: commonErrorResponses[415],
  },
})

const removeItemExplorationTrackRoute = createRoute({
  method: 'delete',
  path: '/{id}/exploration-track',
  tags: ['Items'],
  summary: '移除探索主线关联',
  description: '解除事项与探索主线的关联。',
  request: {
    params: idParamSchema,
  },
  responses: {
    204: { description: '已移除关联' },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const listStatusEventsRoute = createRoute({
  method: 'get',
  path: '/{id}/status-events',
  tags: ['Items'],
  summary: '事项状态事件',
  description: '返回指定事项的状态变更事件历史。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(z.array(statusEventSchema), '状态事件列表'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const updateItemContentRoute = createRoute({
  method: 'patch',
  path: '/{id}/content',
  tags: ['Items'],
  summary: '更新事项内容',
  description: '更新指定事项的说明内容。',
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: updateContentSchema } } },
  },
  responses: {
    200: jsonSuccess(itemSchema, '更新后的事项'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    415: commonErrorResponses[415],
  },
})

const startItemRoute = createRoute({
  method: 'post',
  path: '/{id}/start',
  tags: ['Items'],
  summary: '开始执行',
  description: '将事项转为执行中并可选记录开始动作。',
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: startItemSchema } } },
  },
  responses: {
    200: jsonSuccess(itemSchema, '开始后的事项'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const changeItemStatusRoute = createRoute({
  method: 'post',
  path: '/{id}/status',
  tags: ['Items'],
  summary: '变更事项状态',
  description: '按状态机规则变更指定事项的状态。',
  request: {
    params: idParamSchema,
    body: { required: true, content: { 'application/json': { schema: changeStatusSchema } } },
  },
  responses: {
    200: jsonSuccess(itemSchema, '变更后的事项'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const restoreItemRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Items'],
  summary: '恢复事项',
  description: '从回收站恢复指定事项。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(itemSchema, '恢复后的事项'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const getItemRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Items'],
  summary: '获取事项',
  description: '返回指定事项的完整读模型。',
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonSuccess(itemSchema, '事项详情'),
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

const deleteItemRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Items'],
  summary: '删除事项',
  description: '将指定事项移入回收站。',
  request: {
    params: idParamSchema,
  },
  responses: {
    204: { description: '已移入回收站' },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
})

export function createItemRoutes() {
  const app = createOpenApiApp()
  app.on('POST', '/', requireJson)
  app.on('PUT', '/:id/exploration-track', requireJson)
  app.on('PATCH', '/:id/content', requireJson)
  app.on('POST', '/:id/start', requireJson)
  app.on('POST', '/:id/status', requireJson)

  app.openapi(listItemsRoute, async (context) => {
    const services = requireServices(context)
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
      throw validationError('事项定位参数无效')
    }
    return context.json(
      await services.explorationTracks.listItemsByExplorationTrackAndStatus(
        query.explorationTrackId,
        query.status,
      ),
      200,
    )
  })

  app.openapi(createItemRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.createIdea(context.req.valid('json')),
      201,
    )
  })

  app.openapi(listItemTrashRoute, async (context) => {
    const services = requireServices(context)
    return context.json(await services.items.listTrash(), 200)
  })

  app.openapi(getItemExplorationTrackRoute, async (context) => {
    const services = requireServices(context)
    const trackContext = await services.explorationTracks.getItemExplorationTrackContext(
      decodeURIComponent(context.req.valid('param').id),
    )
    if (!trackContext) throw new ApiError(404, 'NOT_FOUND', '事项不存在')
    return context.json(trackContext, 200)
  })

  app.openapi(assignItemExplorationTrackRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.explorationTracks.assignItemToExplorationTrack(
        decodeURIComponent(context.req.valid('param').id),
        context.req.valid('json').trackId,
      ),
      200,
    )
  })

  app.openapi(removeItemExplorationTrackRoute, async (context) => {
    const services = requireServices(context)
    await services.explorationTracks.removeItemFromExplorationTrack(
      decodeURIComponent(context.req.valid('param').id),
    )
    return context.body(null, 204)
  })

  app.openapi(listStatusEventsRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.listStatusEvents(decodeURIComponent(context.req.valid('param').id)),
      200,
    )
  })

  app.openapi(updateItemContentRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.updateItemContent(
        decodeURIComponent(context.req.valid('param').id),
        context.req.valid('json').content,
      ),
      200,
    )
  })

  app.openapi(startItemRoute, async (context) => {
    const services = requireServices(context)
    const input = context.req.valid('json')
    return context.json(
      await services.items.startExecution(
        decodeURIComponent(context.req.valid('param').id),
        input.startAction,
        input.overwriteExistingStartAction,
      ),
      200,
    )
  })

  app.openapi(changeItemStatusRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.changeStatus(
        decodeURIComponent(context.req.valid('param').id),
        context.req.valid('json').status,
      ),
      200,
    )
  })

  app.openapi(restoreItemRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.restoreItem(decodeURIComponent(context.req.valid('param').id)),
      200,
    )
  })

  app.openapi(getItemRoute, async (context) => {
    const services = requireServices(context)
    return context.json(
      await services.items.getItem(decodeURIComponent(context.req.valid('param').id)),
      200,
    )
  })

  app.openapi(deleteItemRoute, async (context) => {
    const services = requireServices(context)
    await services.items.deleteItem(decodeURIComponent(context.req.valid('param').id))
    return context.body(null, 204)
  })

  return app
}
