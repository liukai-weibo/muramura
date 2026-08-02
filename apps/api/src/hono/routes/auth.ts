import { createRoute, z } from '@hono/zod-openapi'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { requireJson } from '../http'
import { buildExpiredSessionCookie, buildSessionCookie, parseSessionSecretFromCookie } from '../session'
import type { RootHonoServices } from '../services'

const credentialsSchema = z.object({
  username: z.string().openapi({ example: 'alice' }),
  password: z.string().min(1).openapi({ example: 'password-123' }),
}).openapi('AuthCredentials')

const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  roles: z.array(z.enum(['member', 'platform_admin'])),
  createdAt: z.string(),
}).openapi('AuthUser')

const authSessionSchema = z.object({
  user: authUserSchema,
}).openapi('AuthSession')

const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Auth'],
  summary: '注册账户',
  description: '创建本地账户并建立会话。成功时通过 Set-Cookie 下发 HttpOnly `kb_session`，响应体为会话读模型（不含 secret）。',
  request: {
    body: { required: true, content: { 'application/json': { schema: credentialsSchema } } },
  },
  responses: {
    201: jsonSuccess(authSessionSchema, '注册成功并已建立会话'),
    400: commonErrorResponses[400],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  summary: '登录',
  description: '校验用户名与密码。用户不存在与密码错误均返回同一粗粒度失败（防枚举）。成功时 Set-Cookie 下发 `kb_session`。',
  request: {
    body: { required: true, content: { 'application/json': { schema: credentialsSchema } } },
  },
  responses: {
    200: jsonSuccess(authSessionSchema, '登录成功'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    415: commonErrorResponses[415],
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  summary: '登出',
  description: '撤销当前 Cookie 对应会话，并清除 `kb_session` Cookie。',
  request: {
    body: { required: true, content: { 'application/json': { schema: z.object({}).openapi('EmptyObject') } } },
  },
  responses: {
    204: { description: '已登出' },
    415: commonErrorResponses[415],
  },
})

const sessionRoute = createRoute({
  method: 'get',
  path: '/session',
  tags: ['Auth'],
  summary: '读取当前会话',
  description: '根据 Cookie 返回当前会话用户；无效或缺失会话返回 401。',
  responses: {
    200: jsonSuccess(authSessionSchema, '当前会话'),
    401: commonErrorResponses[401],
  },
})

export function createAuthRoutes(root: RootHonoServices) {
  const app = createOpenApiApp()
  app.use('/register', requireJson)
  app.use('/login', requireJson)
  app.use('/logout', requireJson)

  app.openapi(registerRoute, async (context) => {
    const body = context.req.valid('json')
    const result = await root.auth.register(body)
    context.header('set-cookie', buildSessionCookie(result.secret, result.expiresAt))
    return context.json(result.session, 201)
  })

  app.openapi(loginRoute, async (context) => {
    const body = context.req.valid('json')
    const result = await root.auth.login(body)
    context.header('set-cookie', buildSessionCookie(result.secret, result.expiresAt))
    return context.json(result.session, 200)
  })

  app.openapi(logoutRoute, async (context) => {
    await root.auth.logout(parseSessionSecretFromCookie(context.req.header('cookie')))
    context.header('set-cookie', buildExpiredSessionCookie())
    return context.body(null, 204)
  })

  app.openapi(sessionRoute, async (context) => {
    const session = await root.auth.current(parseSessionSecretFromCookie(context.req.header('cookie')))
    if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
    return context.json(session, 200)
  })

  return app
}
