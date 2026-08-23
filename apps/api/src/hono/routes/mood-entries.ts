import { z, createRoute } from '@hono/zod-openapi'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const moodEntrySchema = z.object({
  id: z.string(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string(),
  moodLevel: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  response: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const entryInputSchema = z.object({
  content: z.string().min(1).max(2000),
  moodLevel: z.number().int().min(1).max(5),
  tags: z.array(z.string().min(1).max(20)).max(10).optional(),
  response: z.string().max(1000).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const idSchema = z.object({ id: z.string().min(1) })

export function createMoodEntryRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Mood entries'],
      request: {
        query: z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      responses: { 200: jsonSuccess(z.array(moodEntrySchema), 'mood entries'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).moodEntries
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'mood entries unavailable')
      const query = context.req.valid('query')
      return context.json(await service.listRange(query.from, query.to), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/',
      tags: ['Mood entries'],
      middleware: [requireJson],
      request: { body: { required: true, content: { 'application/json': { schema: entryInputSchema } } } },
      responses: { 200: jsonSuccess(moodEntrySchema, 'created mood entry'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).moodEntries
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'mood entries unavailable')
      const body = await context.req.json()
      return context.json(await service.create(body), 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{id}',
      tags: ['Mood entries'],
      middleware: [requireJson],
      request: { params: idSchema, body: { required: true, content: { 'application/json': { schema: entryInputSchema } } } },
      responses: { 200: jsonSuccess(moodEntrySchema, 'updated mood entry'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).moodEntries
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'mood entries unavailable')
      const body = await context.req.json()
      return context.json(await service.updateMine(context.req.param('id'), body), 200)
    })
    .openapi(createRoute({
      method: 'delete',
      path: '/{id}',
      tags: ['Mood entries'],
      request: { params: idSchema },
      responses: { 200: jsonSuccess(z.object({ deleted: z.boolean() }), 'deleted'), 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).moodEntries
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'mood entries unavailable')
      await service.deleteMine(context.req.param('id'))
      return context.json({ deleted: true }, 200)
    })
}
