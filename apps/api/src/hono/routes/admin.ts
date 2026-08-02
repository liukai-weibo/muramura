import { createRoute, z } from '@hono/zod-openapi'
import type { PlatformRole } from '@knowledge-base/contracts'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { requireJson } from '../http'
import type { RootHonoServices } from '../services'
import type { ApiEnv } from '../types'

const platformUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  roles: z.array(z.enum(['member', 'platform_admin'])),
  createdAt: z.string(),
}).openapi('PlatformUserSummary')

const platformUserPageSchema = z.object({
  items: z.array(platformUserSchema),
  page: z.number().int(),
  pageSize: z.literal(20),
  total: z.number().int(),
}).openapi('PlatformUserPage')

const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  tags: ['Admin'],
  summary: '分页列出用户',
  description: '仅平台管理员。支持可选 username 模糊查询（query）与页码（page，从 1 开始，每页 20）。未知查询键、重复键、非正整数页码或 pageSize 均拒绝。',
  request: {
    query: z.object({
      page: z.string().optional().openapi({ example: '1' }),
      query: z.string().optional().openapi({ example: 'alice' }),
    }).passthrough(),
  },
  responses: {
    200: jsonSuccess(platformUserPageSchema, '用户分页'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
})

const setRolesRoute = createRoute({
  method: 'put',
  path: '/users/{userId}/roles',
  tags: ['Admin'],
  summary: '设置目标用户平台角色',
  description: '仅平台管理员。roles 只能是 `["member"]` 或 `["member","platform_admin"]`；operationId 必须为 UUID。禁止修改自己的角色。',
  request: {
    params: z.object({ userId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            roles: z.array(z.string()),
            operationId: z.string().uuid(),
          }).strict().openapi('AdminSetUserRolesRequest'),
        },
      },
    },
  },
  responses: {
    200: jsonSuccess(platformUserSchema, '更新后的用户摘要'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

const revokeSessionsRoute = createRoute({
  method: 'post',
  path: '/users/{userId}/revoke-sessions',
  tags: ['Admin'],
  summary: '撤销目标用户全部会话',
  description: '仅平台管理员。operationId 必须为 UUID。禁止通过管理接口撤销自己的会话。',
  request: {
    params: z.object({ userId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            operationId: z.string().uuid(),
          }).strict().openapi('AdminRevokeUserSessionsRequest'),
        },
      },
    },
  },
  responses: {
    200: jsonSuccess(z.object({ revokedSessionCount: z.number().int() }).openapi('AdminRevokeUserSessionsResponse'), '撤销结果'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    415: commonErrorResponses[415],
  },
})

function requireActor(context: { get: (key: 'actor') => ApiEnv['Variables']['actor'] }) {
  const actor = context.get('actor')
  if (!actor) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
  return actor
}

function parseAdminUserListQuery(parameters: URLSearchParams): { page: number; query?: string } {
  for (const key of parameters.keys()) {
    if (key !== 'page' && key !== 'query') throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  }
  const pages = parameters.getAll('page')
  const queries = parameters.getAll('query')
  if (pages.length > 1 || queries.length > 1) throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  const rawPage = pages[0]
  if (rawPage !== undefined && !/^[1-9][0-9]*$/.test(rawPage)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const page = rawPage === undefined ? 1 : Number(rawPage)
  if (!Number.isSafeInteger(page)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const query = queries[0]?.trim()
  if (query !== undefined && query.length > 80) throw new ApiError(400, 'VALIDATION_FAILED', '搜索文本过长')
  return query ? { page, query } : { page }
}

function parseAdminRoles(value: unknown): PlatformRole[] {
  if (!Array.isArray(value) || value.some((role) => typeof role !== 'string')) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'roles 参数无效')
  }
  if (value.length === 1 && value[0] === 'member') return ['member']
  if (value.length === 2 && value[0] === 'member' && value[1] === 'platform_admin') {
    return ['member', 'platform_admin']
  }
  throw new ApiError(400, 'VALIDATION_FAILED', 'roles 参数无效')
}

function parseAdminTargetId(encoded: string): string {
  let value: string
  try {
    value = decodeURIComponent(encoded)
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', '目标用户 ID 无效')
  }
  if (value.length < 1 || value.length > 128 || value.trim() !== value || /[\u0000-\u001f\u007f/?#]/.test(value)) {
    throw new ApiError(400, 'VALIDATION_FAILED', '目标用户 ID 无效')
  }
  return value
}

export function createAdminRoutes(root: RootHonoServices) {
  const app = createOpenApiApp()
  app.use('/users/:userId/roles', requireJson)
  app.use('/users/:userId/revoke-sessions', requireJson)

  app.openapi(listUsersRoute, async (context) => {
    const actor = requireActor(context)
    const listQuery = parseAdminUserListQuery(new URL(context.req.url).searchParams)
    return context.json(await root.platformAdministration.listUsers(actor, listQuery), 200)
  })

  app.openapi(setRolesRoute, async (context) => {
    const actor = requireActor(context)
    const { userId } = context.req.valid('param')
    const body = context.req.valid('json')
    return context.json(await root.platformAdministration.setUserRoles(actor, {
      targetUserId: parseAdminTargetId(userId),
      roles: parseAdminRoles(body.roles),
      operationId: body.operationId,
    }), 200)
  })

  app.openapi(revokeSessionsRoute, async (context) => {
    const actor = requireActor(context)
    const { userId } = context.req.valid('param')
    const body = context.req.valid('json')
    return context.json(await root.platformAdministration.revokeAllUserSessions(actor, {
      targetUserId: parseAdminTargetId(userId),
      operationId: body.operationId,
    }), 200)
  })

  return app
}
