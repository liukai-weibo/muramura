import { createRoute, z } from '@hono/zod-openapi'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { requireJson } from '../http'
import { buildExpiredSessionCookie, isTauriOrigin } from '../session'
import type { RootHonoServices } from '../services'
import type { ApiEnv } from '../types'

const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  roles: z.array(z.enum(['member', 'ordinary_admin', 'platform_admin'])),
  createdAt: z.string(),
}).openapi('AccountAuthUser')

const changeUsernameRoute = createRoute({
  middleware: [requireJson],
  method: 'patch',
  path: '/username',
  tags: ['Account'],
  summary: '修改当前用户名',
  description: '需要登录。直接更新当前会话用户的用户名；撞名返回冲突。',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ username: z.string() }).strict().openapi('ChangeOwnUsernameRequest'),
        },
      },
    },
  },
  responses: {
    200: jsonSuccess(authUserSchema, '更新后的当前用户'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const changePasswordRoute = createRoute({
  middleware: [requireJson],
  method: 'post',
  path: '/password',
  tags: ['Account'],
  summary: '修改当前密码',
  description: '需要登录。校验当前密码后写入新密码，并撤销该用户全部会话；成功时清除 `kb_session` Cookie。',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            currentPassword: z.string().min(1),
            newPassword: z.string().min(1),
          }).strict().openapi('ChangeOwnPasswordRequest'),
        },
      },
    },
  },
  responses: {
    204: { description: '密码已更新，全部会话已撤销' },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

function requireActor(context: { get: (key: 'actor') => ApiEnv['Variables']['actor'] }) {
  const actor = context.get('actor')
  if (!actor) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
  return actor
}

export function createAccountRoutes(root: RootHonoServices) {
  return createOpenApiApp()
    .openapi(changeUsernameRoute, async (context) => {
      const actor = requireActor(context)
      const body = context.req.valid('json')
      return context.json(await root.auth.changeUsername(actor, body.username), 200)
    })

    .openapi(changePasswordRoute, async (context) => {
      const actor = requireActor(context)
      const body = context.req.valid('json')
      await root.auth.changePassword(actor, {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
      context.header('set-cookie', buildExpiredSessionCookie(isTauriOrigin(context.req.header('origin'))))
      return context.body(null, 204)
    })
}
