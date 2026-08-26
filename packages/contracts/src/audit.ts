/**
 * 内容与操作审计中心共享契约。
 *
 * 只覆盖平台管理员（platform_admin）可读、业务写入路径追加的内容审计事件。
 * actor 身份由数据/应用层绑定；本模块只描述事件形状、录制端口与分页查询，不含权限判断。
 */

export const auditModules = [
  'daily_note',
  'mood',
  'meal',
  'item',
  'search',
  'exploration_track',
  'method',
  'review',
  'daily_summary',
  'daily_diet',
  'home_ai_card',
  'ai_preference',
  'ai_conversation',
  'ai_config',
] as const
export type AuditModule = (typeof auditModules)[number]

export const auditActions = [
  'create',
  'update',
  'delete',
  'search',
  'assign',
  'remove',
  'restore',
  'purge',
  'archive',
  'complete',
  'append',
] as const
export type AuditAction = (typeof auditActions)[number]

/** 面向 Repository 的完整入库事件；actor 身份由调用方补全。 */
export interface ActivityAuditEventInput {
  actorUserId: string
  actorUsername?: string
  module: AuditModule
  action: AuditAction
  entityId?: string
  /** 内容快照；JSON 字符串（新建为写入后、编辑为更新后、删除为删除前、搜索为 query）。 */
  snapshot?: string
}

export interface ActivityAuditEvent extends Required<Pick<ActivityAuditEventInput, 'actorUserId' | 'actorUsername' | 'module' | 'action' | 'snapshot'>> {
  id: string
  entityId?: string
  riskLevel: string
  createdAt: string
}

export interface ActivityAuditEventQuery {
  /** 用户名/ID 模糊匹配，optional。 */
  actorQuery?: string
  modules?: AuditModule[]
  actions?: AuditAction[]
  /** YYYY-MM-DD 起止（含两端），服务端本地日界。 */
  from?: string
  to?: string
  /** 快照全文 LIKE。 */
  keyword?: string
  page: number
  pageSize: number
}

export interface ActivityAuditEventPage {
  items: ActivityAuditEvent[]
  page: number
  pageSize: number
  total: number
}

export interface ActivityAuditRepository {
  record(input: ActivityAuditEventInput): Promise<void>
  list(query: ActivityAuditEventQuery): Promise<ActivityAuditEventPage>
  listAllMatches(query: Omit<ActivityAuditEventQuery, 'page' | 'pageSize'>): Promise<ActivityAuditEvent[]>
}

/** 面向 Application 的窄化录制端口：只携带操作与内容，actor 由构造方绑定。 */
export interface ActivityAuditEventDraft {
  module: AuditModule
  action: AuditAction
  entityId?: string
  snapshot?: string
}

export interface ActivityAuditRecorder {
  record(draft: ActivityAuditEventDraft): Promise<void>
}
