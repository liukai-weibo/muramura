import { createRoute, z } from '@hono/zod-openapi'
import { auditActions, auditModules, type AuditModule, type AuditAction, type ActivityAuditEvent } from '@knowledge-base/contracts'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import type { RootHonoServices } from '../services'

const auditEventSchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  actorUsername: z.string(),
  module: z.enum(auditModules),
  action: z.enum(auditActions),
  entityId: z.string().optional(),
  snapshot: z.string(),
  riskLevel: z.string(),
  createdAt: z.string(),
}).openapi('ActivityAuditEvent')

const auditEventPageSchema = z.object({
  items: z.array(auditEventSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
}).openapi('ActivityAuditEventPage')

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const querySchema = z.object({
  actorQuery: z.string().optional(),
  modules: z.string().optional(),
  actions: z.string().optional(),
  from: z.string().regex(datePattern).optional(),
  to: z.string().regex(datePattern).optional(),
  keyword: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

const listEventsRoute = createRoute({
  method: 'get',
  path: '/events',
  tags: ['Admin'],
  summary: '列出内容审计事件',
  description: '仅平台管理员。按 actorQuery（用户 ID/昵称模糊）、modules/actions（逗号分隔枚举）、from/to（YYYY-MM-DD）、keyword（快照全文）与 search（用户/昵称/快照全文任一匹配）组合筛选，分页返回。',
  request: { query: querySchema },
  responses: {
    200: jsonSuccess(auditEventPageSchema, '审计事件分页'),
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
})

export function createAuditRoutes(root: RootHonoServices) {
  return createOpenApiApp()
    .openapi(listEventsRoute, async (context) => {
      const query = context.req.valid('query')
      return context.json(
        await root.platformAudit.list({
          actorQuery: query.actorQuery,
          modules: parseCsvEnum<AuditModule>(query.modules, auditModules, '模块'),
          actions: parseCsvEnum<AuditAction>(query.actions, auditActions, '操作'),
          from: query.from,
          to: query.to,
          keyword: query.keyword,
          search: query.search,
          page: parsePositiveInt(query.page, 1),
          pageSize: parsePageSize(query.pageSize),
        }),
        200,
      )
    })
    .get('/export', async (context) => {
      const query = context.req.query()
      const events = await root.platformAudit.listAllMatches({
        actorQuery: query.actorQuery,
        modules: parseCsvEnum<AuditModule>(query.modules, auditModules, '模块'),
        actions: parseCsvEnum<AuditAction>(query.actions, auditActions, '操作'),
        from: isDate(query.from) ? query.from : undefined,
        to: isDate(query.to) ? query.to : undefined,
        keyword: query.keyword,
        search: query.search,
      })
      const csv = '\uFEFF' + toCsv(events)
      return context.body(csv, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="audit-events.csv"',
      })
    })
}

function parseCsvEnum<T extends string>(raw: string | undefined, allowed: readonly string[], label: string): T[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) return undefined
  if (values.some((value) => !allowed.includes(value))) throw new ApiError(400, 'VALIDATION_FAILED', `${label}筛选参数无效`)
  return values as T[]
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new ApiError(400, 'VALIDATION_FAILED', '页码参数无效')
  return value
}

function parsePageSize(raw: string | undefined): number {
  if (raw === undefined) return 20
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new ApiError(400, 'VALIDATION_FAILED', '分页大小参数无效')
  return value
}

function isDate(value: string | undefined): value is string {
  return Boolean(value && datePattern.test(value))
}

const moduleLabels: Record<AuditModule, string> = {
  daily_note: '手记',
  mood: '情绪记录',
  meal: '三餐记录',
  item: '灵感Todo',
  search: '全局搜索',
  exploration_track: '探索轨道',
  method: '方法',
  review: '复盘',
  daily_summary: '状态小结',
  daily_diet: '饮食推荐',
  home_ai_card: '首页AI卡片',
  ai_preference: 'AI偏好',
  ai_conversation: 'AI会话',
  ai_config: 'AI配置',
}
const actionLabels: Record<AuditAction, string> = {
  create: '新建',
  update: '编辑',
  delete: '删除',
  search: '搜索',
  assign: '分配',
  remove: '移除',
  restore: '恢复',
  purge: '清空',
  archive: '归档',
  complete: '复盘',
  append: '发送',
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function toCsv(events: ActivityAuditEvent[]): string {
  const header = ['时间', '用户', '模块', '操作', '目标ID', '快照', '风险等级']
  const rows = events.map((event) => [
    event.createdAt,
    event.actorUsername || event.actorUserId,
    moduleLabels[event.module],
    actionLabels[event.action],
    event.entityId ?? '',
    event.snapshot,
    event.riskLevel,
  ])
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')
}
