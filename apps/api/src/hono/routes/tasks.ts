import { z, createRoute } from '@hono/zod-openapi'
import { TASK_VISIBLE_STATUSES } from '@knowledge-base/contracts'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'pool', 'completed']),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const taskCreateSchema = z.object({
  title: z.string().min(1).max(120),
  bucket: z.enum(TASK_VISIBLE_STATUSES).optional(),
})

const taskParamsSchema = z.object({ id: z.string().min(1) })

export function createTaskRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Tasks'],
      responses: { 200: jsonSuccess(z.array(taskSchema), 'visible tasks'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.list(), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/',
      tags: ['Tasks'],
      middleware: [requireJson],
      request: { body: { required: true, content: { 'application/json': { schema: taskCreateSchema } } } },
      responses: { 200: jsonSuccess(taskSchema, 'created task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.create(context.req.valid('json')), 200)
    })
    .openapi(createRoute({
      method: 'get',
      path: '/completed',
      tags: ['Tasks'],
      responses: { 200: jsonSuccess(z.array(taskSchema), 'completed tasks'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.listCompleted(), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/{id}/claim',
      tags: ['Tasks'],
      request: { params: taskParamsSchema },
      responses: { 200: jsonSuccess(taskSchema, 'claimed task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.claim(context.req.valid('param').id), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/{id}/complete',
      tags: ['Tasks'],
      request: { params: taskParamsSchema },
      responses: { 200: jsonSuccess(taskSchema, 'completed task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.complete(context.req.valid('param').id), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/{id}/abandon',
      tags: ['Tasks'],
      request: { params: taskParamsSchema },
      responses: { 200: jsonSuccess(taskSchema, 'abandoned task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.abandon(context.req.valid('param').id), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/{id}/restore',
      tags: ['Tasks'],
      request: { params: taskParamsSchema },
      responses: { 200: jsonSuccess(taskSchema, 'restored task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      return context.json(await service.restore(context.req.valid('param').id), 200)
    })
    .openapi(createRoute({
      method: 'delete',
      path: '/{id}',
      tags: ['Tasks'],
      request: { params: taskParamsSchema },
      responses: { 200: jsonSuccess(z.object({ ok: z.boolean() }), 'deleted task'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).tasks
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'tasks unavailable')
      await service.remove(context.req.valid('param').id)
      return context.json({ ok: true }, 200)
    })
}
