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
  roles: z.array(z.enum(['member', 'ordinary_admin', 'platform_admin'])),
  isInitialPlatformAdmin: z.boolean(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
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
      status: z.enum(['active', 'deleted']).optional().openapi({ example: 'active' }),
    }),
  },
  responses: {
    200: jsonSuccess(platformUserPageSchema, '用户分页'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
})

const getUserRoute = createRoute({
  method: 'get',
  path: '/users/{userId}',
  tags: ['Admin'],
  summary: '读取单个用户',
  description: '仅平台管理员。返回目标用户当前角色和软删除状态，可用于写入结果未知后的人工确认。',
  request: { params: z.object({ userId: z.string().min(1) }) },
  responses: {
    200: jsonSuccess(platformUserSchema, '用户摘要'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
})

const setRolesRoute = createRoute({
  middleware: [requireJson],
  method: 'put',
  path: '/users/{userId}/roles',
  tags: ['Admin'],
  summary: '设置目标用户管理员角色',
  description: '仅平台管理员可调整普通管理员角色。roles 只能是 `["member"]` 或 `["member","ordinary_admin"]`；operationId 必须为 UUID。平台管理员和初始平台管理员不可由此接口修改。',
  request: {
    params: z.object({ userId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            roles: z.array(z.string()),
            operationId: z.uuid(),
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
  middleware: [requireJson],
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
            operationId: z.uuid(),
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

function accountStateRoute(kind: 'soft-delete' | 'restore') {
  return createRoute({
    middleware: [requireJson],
    method: 'post',
    path: `/users/{userId}/${kind}`,
    tags: ['Admin'],
    summary: kind === 'soft-delete' ? '软删除目标用户' : '恢复目标用户',
    description: kind === 'soft-delete'
      ? '仅平台管理员。禁止删除自己；删除会撤销目标用户全部会话并移除其平台管理员角色，但保留账号和业务数据。'
      : '仅平台管理员。禁止恢复自己；恢复不会恢复旧会话或平台管理员角色。',
    request: {
      params: z.object({ userId: z.string().min(1) }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({ operationId: z.uuid() }).strict().openapi(
              kind === 'soft-delete' ? 'AdminSoftDeleteUserRequest' : 'AdminRestoreUserRequest',
            ),
          },
        },
      },
    },
    responses: {
      200: jsonSuccess(platformUserSchema, kind === 'soft-delete' ? '软删除后的用户摘要' : '恢复后的用户摘要'),
      400: commonErrorResponses[400],
      401: commonErrorResponses[401],
      403: commonErrorResponses[403],
      404: commonErrorResponses[404],
      409: commonErrorResponses[409],
      415: commonErrorResponses[415],
    },
  })
}

const softDeleteUserRoute = accountStateRoute('soft-delete')
const restoreUserRoute = accountStateRoute('restore')

const updateUsernameRoute = createRoute({
  middleware: [requireJson],
  method: 'patch',
  path: '/users/{userId}/username',
  tags: ['Admin'],
  summary: '修改目标用户用户名',
  description: '仅平台管理员。operationId 必须为 UUID。禁止修改自己的用户名；已删除账号不可修改。',
  request: {
    params: z.object({ userId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            username: z.string(),
            operationId: z.uuid(),
          }).strict().openapi('AdminUpdateUsernameRequest'),
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

const resetPasswordRoute = createRoute({
  middleware: [requireJson],
  method: 'post',
  path: '/users/{userId}/reset-password',
  tags: ['Admin'],
  summary: '重置目标用户密码',
  description: '仅平台管理员。operationId 必须为 UUID。禁止重置自己的密码；已删除账号不可重置；成功后撤销目标用户全部会话。',
  request: {
    params: z.object({ userId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            newPassword: z.string().min(1),
            operationId: z.uuid(),
          }).strict().openapi('AdminResetPasswordRequest'),
        },
      },
    },
  },
  responses: {
    200: jsonSuccess(z.object({ revokedSessionCount: z.number().int() }).openapi('AdminResetPasswordResponse'), '重置结果'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
    415: commonErrorResponses[415],
  },
})

function requireActor(context: { get: (key: 'actor') => ApiEnv['Variables']['actor'] }) {
  const actor = context.get('actor')
  if (!actor) throw new ApiError(401, 'UNAUTHORIZED', 'authentication required')
  return actor
}

function parseAdminUserListQuery(parameters: URLSearchParams): { page: number; query?: string; status?: 'active' | 'deleted' } {
  if (parameters.has('status')) {
    const status = parameters.get('status')
    if (status !== 'active' && status !== 'deleted') throw new ApiError(400, 'VALIDATION_FAILED', 'invalid user status')
    const withoutStatus = new URLSearchParams(parameters)
    withoutStatus.delete('status')
    return { ...parseAdminUserListQuery(withoutStatus), status }
  }
  for (const key of parameters.keys()) {
    if (key !== 'page' && key !== 'query') throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  }
  const pages = parameters.getAll('page')
  const queries = parameters.getAll('query')
  const statuses = parameters.getAll('status')
  if (pages.length > 1 || queries.length > 1) throw new ApiError(400, 'VALIDATION_FAILED', '用户列表查询参数无效')
  if (pages.length > 1 || queries.length > 1 || statuses.length > 1) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid user list query')
  const rawPage = pages[0]
  if (rawPage !== undefined && !/^[1-9][0-9]*$/.test(rawPage)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const page = rawPage === undefined ? 1 : Number(rawPage)
  if (!Number.isSafeInteger(page)) throw new ApiError(400, 'VALIDATION_FAILED', '页码无效')
  const query = queries[0]?.trim()
  if (query !== undefined && query.length > 80) throw new ApiError(400, 'VALIDATION_FAILED', '搜索文本过长')
  const status = statuses[0]
  if (status !== undefined && status !== 'active' && status !== 'deleted') throw new ApiError(400, 'VALIDATION_FAILED', 'invalid user status')
  return { page, ...(query ? { query } : {}), ...(status ? { status } : {}) }
}

function parseAdminRoles(value: unknown): PlatformRole[] {
  if (!Array.isArray(value) || value.some((role) => typeof role !== 'string')) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'roles 参数无效')
  }
  if (value.length === 1 && value[0] === 'member') return ['member']
  if (value.length === 2 && value[0] === 'member' && value[1] === 'ordinary_admin') {
    return ['member', 'ordinary_admin']
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
  return createOpenApiApp()
    .openapi(listUsersRoute, async (context) => {
      const actor = requireActor(context)
      const listQuery = parseAdminUserListQuery(new URL(context.req.url).searchParams)
      return context.json(await root.platformAdministration.listUsers(actor, listQuery), 200)
    })

    .openapi(getUserRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      return context.json(await root.platformAdministration.getUser(actor, parseAdminTargetId(userId)), 200)
    })

    .openapi(setRolesRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.setUserRoles(actor, {
        targetUserId: parseAdminTargetId(userId),
        roles: parseAdminRoles(body.roles),
        operationId: body.operationId,
      }), 200)
    })

    .openapi(revokeSessionsRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.revokeAllUserSessions(actor, {
        targetUserId: parseAdminTargetId(userId),
        operationId: body.operationId,
      }), 200)
    })

    .openapi(softDeleteUserRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.softDeleteUser(actor, {
        targetUserId: parseAdminTargetId(userId),
        operationId: body.operationId,
      }), 200)
    })

    .openapi(restoreUserRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.restoreUser(actor, {
        targetUserId: parseAdminTargetId(userId),
        operationId: body.operationId,
      }), 200)
    })

    .openapi(updateUsernameRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.updateUsername(actor, {
        targetUserId: parseAdminTargetId(userId),
        username: body.username,
        operationId: body.operationId,
      }), 200)
    })

    .openapi(resetPasswordRoute, async (context) => {
      const actor = requireActor(context)
      const { userId } = context.req.valid('param')
      const body = context.req.valid('json')
      return context.json(await root.platformAdministration.resetPassword(actor, {
        targetUserId: parseAdminTargetId(userId),
        newPassword: body.newPassword,
        operationId: body.operationId,
      }), 200)
    })
}
