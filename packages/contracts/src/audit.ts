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
  'refresh',
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
  /** 用户名/ID 模糊匹配，optional。与 search 至少提供一个时按 OR 组合。 */
  actorQuery?: string
  modules?: AuditModule[]
  actions?: AuditAction[]
  /** YYYY-MM-DD 起止（含两端），服务端本地日界。 */
  from?: string
  to?: string
  /** 快照全文 LIKE。 */
  keyword?: string
  /** 合并搜索：actor_user_id / actor_username / snapshot 任一模糊匹配，optional。与 actorQuery/keyword 的关系为 OR。 */
  search?: string
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

/**
 * 审计快照常见枚举值 → 中文标签（展示层翻译与搜索等价展开的单一来源）。
 * 键为快照 JSON 中实际存储的英文枚举值；值为审计中心展示的中文。
 */
export const AUDIT_SNAPSHOT_VALUE_LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
  small: '小',
  medium: '中',
  large: '大',
  cream: '奶油色',
  green: '绿色',
  beige: '米色',
  daily: '每天',
  manual: '手动',
  complete: '完成',
  pending: '待处理',
  architecture: '架构',
  method: '方法',
  exploration: '探索',
  daily_note: '手记',
  item: '事项',
  search: '搜索',
}

/**
 * 审计快照字段名 → 中文标签（展示层翻译与搜索等价展开的单一来源）。
 * 键为快照 JSON 中实际存储的字段名；值为审计中心展示的中文。
 */
export const AUDIT_SNAPSHOT_KEY_LABELS: Record<string, string> = {
  entryDate: '日期',
  cacheDate: '缓存日期',
  cacheId: '缓存ID',
  actualAction: '做了什么',
  result: '复盘结果',
  effective: '有效 / 舒服',
  incompatible: '阻力 / 不舒服',
  newIdeas: '产生新想法',
  cardTitle: '卡片标题',
  aiPrompt: 'AI提示词',
  cardSize: '卡片尺寸',
  cardTheme: '卡片底色',
  refreshMode: '刷新方式',
  meals: '餐次',
  mealType: '餐次类型',
  content: '内容',
  feeling: '感受',
  query: '搜索词',
  title: '标题',
  name: '名称',
  description: '描述',
  tags: '标签',
  moodLevel: '情绪等级',
  type: '类型',
  id: 'ID',
  itemId: '事项ID',
  actorUserId: '用户ID',
  actorUsername: '用户名',
  action: '操作',
  bizType: '业务类型',
  note: '备注',
  text: '文本',
}
