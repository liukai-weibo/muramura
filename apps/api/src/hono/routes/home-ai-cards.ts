import { z, createRoute } from '@hono/zod-openapi'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { HOME_AI_CARD_TITLE_MAX_LENGTH, HOME_AI_CARD_PROMPT_MAX_LENGTH, HOME_AI_CARD_OUTPUT_MAX_LENGTH } from '@knowledge-base/contracts'

const homeAiCardSchema = z.object({
  id: z.string(),
  cardTitle: z.string(),
  aiPrompt: z.string(),
  cardSize: z.enum(['small', 'medium', 'large']),
  cardTheme: z.enum(['cream', 'green', 'beige']),
  refreshMode: z.enum(['daily', 'manual']),
  sortIndex: z.number(),
  isHidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const homeAiCardCacheSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  cacheDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aiOutput: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const homeAiCardInputSchema = z.object({
  cardTitle: z.string().min(1).max(HOME_AI_CARD_TITLE_MAX_LENGTH),
  aiPrompt: z.string().min(1).max(HOME_AI_CARD_PROMPT_MAX_LENGTH),
  cardSize: z.enum(['small', 'medium', 'large']),
  cardTheme: z.enum(['cream', 'green', 'beige']),
  refreshMode: z.enum(['daily', 'manual']),
})

const homeAiCardCacheInputSchema = z.object({
  aiOutput: z.string().min(1).max(HOME_AI_CARD_OUTPUT_MAX_LENGTH),
})

export function createHomeAiCardRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({
      method: 'get',
      path: '/',
      tags: ['Home AI cards'],
      responses: { 200: jsonSuccess(z.array(homeAiCardSchema), 'home ai cards'), 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      return context.json(await service.list(), 200)
    })
    .openapi(createRoute({
      method: 'get',
      path: '/caches',
      tags: ['Home AI cards'],
      request: {
        query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      },
      responses: { 200: jsonSuccess(z.array(homeAiCardCacheSchema), 'home ai card caches'), 401: commonErrorResponses[401], 400: commonErrorResponses[400] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      const query = context.req.valid('query')
      return context.json(await service.listCaches(query.date), 200)
    })
    .openapi(createRoute({
      method: 'post',
      path: '/',
      tags: ['Home AI cards'],
      middleware: [requireJson],
      request: {
        body: { required: true, content: { 'application/json': { schema: homeAiCardInputSchema } } },
      },
      responses: { 200: jsonSuccess(homeAiCardSchema, 'created home ai card'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      const body = await context.req.json()
      return context.json(await service.create(body), 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{cardId}',
      tags: ['Home AI cards'],
      middleware: [requireJson],
      request: {
        params: z.object({ cardId: z.string().min(1) }),
        body: { required: true, content: { 'application/json': { schema: homeAiCardInputSchema } } },
      },
      responses: { 200: jsonSuccess(homeAiCardSchema, 'updated home ai card'), 400: commonErrorResponses[400], 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      const body = await context.req.json()
      const updated = await service.update(context.req.param('cardId'), body)
      if (!updated) throw new ApiError(404, 'NOT_FOUND', 'home ai card not found')
      return context.json(updated, 200)
    })
    .openapi(createRoute({
      method: 'delete',
      path: '/{cardId}',
      tags: ['Home AI cards'],
      request: {
        params: z.object({ cardId: z.string().min(1) }),
      },
      responses: { 200: jsonSuccess(z.object({ deleted: z.boolean() }), 'deleted home ai card'), 401: commonErrorResponses[401], 404: commonErrorResponses[404] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      const deleted = await service.delete(context.req.param('cardId'))
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'home ai card not found')
      return context.json({ deleted: true }, 200)
    })
    .openapi(createRoute({
      method: 'put',
      path: '/{cardId}/caches/{cacheDate}',
      tags: ['Home AI cards'],
      middleware: [requireJson],
      request: {
        params: z.object({ cardId: z.string().min(1), cacheDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
        body: { required: true, content: { 'application/json': { schema: homeAiCardCacheInputSchema } } },
      },
      responses: { 200: jsonSuccess(homeAiCardCacheSchema, 'upserted home ai card cache'), 400: commonErrorResponses[400], 401: commonErrorResponses[401] },
    }), async context => {
      const service = requireServices(context).homeAiCards
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'home ai cards unavailable')
      const body = await context.req.json()
      return context.json(await service.upsertCache(context.req.param('cardId'), context.req.param('cacheDate'), body.aiOutput), 200)
    })
}