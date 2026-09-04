import { z, createRoute } from '@hono/zod-openapi'
import { MEAL_SATIETY_VALUES } from '@knowledge-base/contracts'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const mealEntrySchema = z.object({
  id: z.string(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  content: z.string(),
  feeling: z.number().int().refine(value => MEAL_SATIETY_VALUES.has(value), { message: '饱腹度须为 0、5、7 或 9' }),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const mealSlotInputSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  content: z.string().max(1000),
  feeling: z.number().int().refine(value => MEAL_SATIETY_VALUES.has(value), { message: '饱腹度须为 0、5、7 或 9' }),
})

const mealDayInputSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meals: z.array(mealSlotInputSchema).max(3),
})

export function createMealEntryRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Meal entries'],
      request: {
        query: z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
      responses: { 200: jsonSuccess(z.array(mealEntrySchema), 'meal entries'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).meals
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'meal entries unavailable')
      const query = context.req.valid('query')
      return context.json(await service.listRange(query.from, query.to), 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{entryDate}',
      tags: ['Meal entries'],
      middleware: [requireJson],
      request: {
        params: z.object({ entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
        body: { required: true, content: { 'application/json': { schema: mealDayInputSchema } } },
      },
      responses: { 200: jsonSuccess(z.array(mealEntrySchema), 'saved day meals'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).meals
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'meal entries unavailable')
      const body = await context.req.json()
      return context.json(await service.saveDay({ entryDate: context.req.param('entryDate'), meals: body.meals }), 200)
    })
}
