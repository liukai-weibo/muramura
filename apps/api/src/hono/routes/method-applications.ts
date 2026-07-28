import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { validationError } from '../errors'
import { requireJson } from '../http'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const idParamSchema = z.object({ id: z.string().min(1) })
const createMethodApplicationSchema = z.object({
  methodId: z.string(),
  title: z.string(),
  content: z.string().optional(),
})
const sourceDisplaysQuerySchema = z.object({ itemIds: z.string().optional() })
const methodSourceDisplaysUrlLimit = 8 * 1024

export function createMethodApplicationRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .post(
      '/',
      requireJson,
      zValidator('json', createMethodApplicationSchema, (result) => {
        if (!result.success) {
          throw validationError('方法应用参数无效')
        }
      }),
      async (context) => {
        const input = context.req.valid('json')
        return context.json(
          await services.methodApplications.createItem(
            input.methodId,
            input.title,
            input.content,
          ),
          201,
        )
      },
    )
    .get(
      '/:id/context',
      zValidator('param', idParamSchema),
      async (context) => context.json(
        await services.methodApplications.getContextResultForItem(
          decodeURIComponent(context.req.valid('param').id),
        ),
        200,
      ),
    )
}

export function createMethodSourceDisplayRoutes(services: HonoServices) {
  return new Hono<ApiEnv>().get(
    '/',
    zValidator('query', sourceDisplaysQuerySchema, (result) => {
      if (!result.success) {
        throw validationError('itemIds 参数无效')
      }
    }),
    async (context) => {
      const raw = context.req.valid('query').itemIds ?? ''
      const itemIds = raw ? raw.split(',') : []
      const requestUrl = new URL(context.req.url)
      if (
        requestUrl.pathname.length + requestUrl.search.length > methodSourceDisplaysUrlLimit
        || itemIds.length > 100
        || itemIds.some((value) => !value)
      ) {
        throw validationError('itemIds 参数无效')
      }
      return context.json(
        await services.methodApplications.listSourceDisplaysForItems(itemIds),
        200,
      )
    },
  )
}
