import { z, createRoute } from '@hono/zod-openapi'
import { SLEEP_INPUT_PRECISIONS } from '@knowledge-base/contracts'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const sleepEntrySchema = z.object({
  id: z.string(),
  sleepDate: dateSchema,
  wakeAt: z.string().optional(),
  bedAt: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const sleepPatchSchema = z.object({
  wakeAt: z.string().min(1).nullable().optional(),
  bedAt: z.string().min(1).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
})

const sleepSaveResultSchema = z.object({
  deleted: z.boolean(),
  entry: sleepEntrySchema.optional(),
})

const sleepSettingsSchema = z.object({
  remindEnabled: z.boolean(),
  remindStartMinute: z.number().int().min(0).max(1439),
  remindEndMinute: z.number().int().min(0).max(1439),
  inputPrecision: z.enum(SLEEP_INPUT_PRECISIONS),
  lastPromptedDate: dateSchema.optional(),
})

const sleepSettingsInputSchema = z.object({
  remindEnabled: z.boolean(),
  remindStartMinute: z.number().int().min(0).max(1439),
  remindEndMinute: z.number().int().min(0).max(1439),
  inputPrecision: z.enum(SLEEP_INPUT_PRECISIONS),
})

const sleepParamsSchema = z.object({ sleepDate: dateSchema })

export function createSleepRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Sleep'],
      request: {
        query: z.object({
          from: dateSchema.optional(),
          to: dateSchema.optional(),
        }),
      },
      responses: { 200: jsonSuccess(z.array(sleepEntrySchema), 'sleep entries'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep entries unavailable')
      const query = context.req.valid('query')
      return context.json(await service.listRange(query.from, query.to), 200)
    })
    // 静态路径必须注册在 /{sleepDate} 之前，否则会被动态参数吞掉。
    .openapi(createRoute({
      method: 'get',
      path: '/settings',
      tags: ['Sleep'],
      responses: { 200: jsonSuccess(sleepSettingsSchema, 'sleep settings'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep settings unavailable')
      return context.json(await service.getSettings(), 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/settings',
      tags: ['Sleep'],
      middleware: [requireJson],
      request: { body: { required: true, content: { 'application/json': { schema: sleepSettingsInputSchema } } } },
      responses: { 200: jsonSuccess(sleepSettingsSchema, 'saved sleep settings'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep settings unavailable')
      const body = await context.req.json()
      return context.json(await service.saveSettings(body), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/reminder/ack',
      tags: ['Sleep'],
      middleware: [requireJson],
      request: { body: { required: true, content: { 'application/json': { schema: z.object({ date: dateSchema }) } } } },
      responses: { 200: jsonSuccess(sleepSettingsSchema, 'acknowledged reminder'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep settings unavailable')
      const body = await context.req.json()
      return context.json(await service.acknowledgeReminder(body.date), 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{sleepDate}',
      tags: ['Sleep'],
      middleware: [requireJson],
      request: {
        params: sleepParamsSchema,
        body: { required: true, content: { 'application/json': { schema: sleepPatchSchema } } },
      },
      responses: { 200: jsonSuccess(sleepSaveResultSchema, 'saved sleep entry or deletion'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep entries unavailable')
      const body = await context.req.json()
      return context.json(await service.save(context.req.param('sleepDate'), body), 200)
    })
    .openapi(createRoute({
      method: 'delete',
      path: '/{sleepDate}',
      tags: ['Sleep'],
      request: { params: sleepParamsSchema },
      responses: { 200: jsonSuccess(z.object({ deleted: z.boolean() }), 'deleted'), 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).sleep
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'sleep entries unavailable')
      const deleted = await service.remove(context.req.param('sleepDate'))
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'sleep entry not found')
      return context.json({ deleted }, 200)
    })
}
