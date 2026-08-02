import { OpenAPIHono, z } from '@hono/zod-openapi'
import { apiV1BasePath } from './paths'
import type { ApiEnv } from './types'

export const apiTags = [
  { name: 'Health', description: '服务健康与数据库就绪探测' },
  { name: 'Auth', description: '注册、登录、会话与登出（Cookie kb_session）' },
  { name: 'Admin', description: '平台管理员用户与角色管理' },
  { name: 'Items', description: '事项池：创建、状态流转、说明与回收' },
  { name: 'ExplorationTracks', description: '探索主线：创建、重命名、软删、恢复与关联' },
  { name: 'Methods', description: '方法库：列表、版本、证据与回收站' },
  { name: 'Reviews', description: '复盘完成与查询' },
  { name: 'MethodApplications', description: '方法应用与来源展示' },
  { name: 'Backup', description: '备份导出与整库恢复' },
  { name: 'Trash', description: '统一回收站列表与恢复' },
  { name: 'Search', description: '全文搜索' },
  { name: 'Dashboard', description: '仪表盘报表' },
] as const

export type ApiTagName = (typeof apiTags)[number]['name']

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().openapi({ example: 'VALIDATION_FAILED' }),
    message: z.string(),
    requestId: z.uuid(),
    businessCode: z.string().optional(),
  }),
}).openapi('ApiErrorBody')

export const jsonError = (description: string, exampleCode = 'VALIDATION_FAILED') => ({
  description,
  content: {
    'application/json': {
      schema: ApiErrorBodySchema,
      example: {
        error: {
          code: exampleCode,
          message: description,
          requestId: '00000000-0000-4000-8000-000000000000',
        },
      },
    },
  },
})

export const commonErrorResponses = {
  400: jsonError('请求参数无效', 'VALIDATION_FAILED'),
  401: jsonError('需要登录或会话无效', 'UNAUTHORIZED'),
  403: jsonError('无权执行该操作', 'FORBIDDEN'),
  404: jsonError('资源不存在', 'NOT_FOUND'),
  409: jsonError('业务冲突', 'CONFLICT'),
  413: jsonError('请求体过大', 'REQUEST_TOO_LARGE'),
  415: jsonError('不支持的 Content-Type', 'UNSUPPORTED_MEDIA_TYPE'),
  500: jsonError('未分类内部错误', 'INTERNAL_ERROR'),
  503: jsonError('数据库不可用', 'MYSQL_UNAVAILABLE'),
} as const

export const jsonSuccess = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: {
    'application/json': {
      schema,
    },
  },
})

export function createOpenApiApp() {
  return new OpenAPIHono<ApiEnv>({
    defaultHook: (result, context) => {
      if (!result.success) {
        return context.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: '请求参数无效',
            requestId: context.get('requestId'),
          },
        }, 400)
      }
    },
  })
}

export const openApiInfo = {
  openapi: '3.1.0',
  info: {
    title: 'Knowledge Base API',
    version: '1.0.0',
    description: [
      '本地单用户（按登录会话隔离）知识库 HTTP API。',
      `除 \`/health\`、\`${apiV1BasePath}/auth/*\`、\`/openapi.json\`、\`/docs\` 外，业务接口需要 Cookie \`kb_session\`。`,
      '错误体统一为 `{ error: { code, message, requestId, businessCode? } }`；`businessCode` 仅白名单业务码对外透出。',
    ].join('\n\n'),
  },
  tags: [...apiTags],
} as const
