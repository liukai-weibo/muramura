import { z, createRoute } from '@hono/zod-openapi'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const DAILY_DIET_MAX = 1200

const dailyDietSchema = z.object({
  id: z.string(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const dailyDietInputSchema = z.object({
  content: z.string().min(1).max(DAILY_DIET_MAX),
})

export function createDailyDietRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Daily diet'],
      request: {
        query: z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      responses: { 200: jsonSuccess(z.array(dailyDietSchema), 'daily diet recommendations'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).dailyDiet
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily diet unavailable')
      const query = context.req.valid('query')
      return context.json(await service.listRange(query.from, query.to), 200)
    })
    .openapi(createRoute({
      method: 'get',
      path: '/{entryDate}',
      tags: ['Daily diet'],
      request: {
        params: z.object({ entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      },
      responses: { 200: jsonSuccess(dailyDietSchema.nullable(), 'daily diet recommendation'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).dailyDiet
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily diet unavailable')
      const entry = await service.getByDate(context.req.param('entryDate'))
      return context.json(entry ?? null, 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{entryDate}',
      tags: ['Daily diet'],
      middleware: [requireJson],
      request: {
        params: z.object({ entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
        body: { required: true, content: { 'application/json': { schema: dailyDietInputSchema } } },
      },
      responses: { 200: jsonSuccess(dailyDietSchema, 'upserted daily diet recommendation'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).dailyDiet
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily diet unavailable')
      const body = await context.req.json()
      return context.json(await service.upsertForDate({ entryDate: context.req.param('entryDate'), content: body.content }), 200)
    })
}
