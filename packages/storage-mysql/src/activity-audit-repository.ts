import crypto from 'node:crypto'
import {
  AUDIT_SNAPSHOT_KEY_LABELS,
  AUDIT_SNAPSHOT_VALUE_LABELS,
  type ActivityAuditEvent,
  type ActivityAuditEventInput,
  type ActivityAuditEventPage,
  type ActivityAuditEventQuery,
  type ActivityAuditRepository,
} from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'

type AuditRow = RowDataPacket & {
  id: string
  actor_user_id: string
  actor_username: string | null
  module_code: string
  action_code: string
  entity_id: string | null
  snapshot: string | null
  risk_level: string
  created_at: string | Date
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`

const map = (row: AuditRow): ActivityAuditEvent => ({
  id: row.id,
  actorUserId: row.actor_user_id,
  actorUsername: row.actor_username ?? '',
  module: row.module_code as ActivityAuditEvent['module'],
  action: row.action_code as ActivityAuditEvent['action'],
  ...(row.entity_id == null ? {} : { entityId: row.entity_id }),
  snapshot: row.snapshot ?? '',
  riskLevel: row.risk_level,
  createdAt: iso(row.created_at),
})

const auditColumns = 'id, actor_user_id, actor_username, module_code, action_code, entity_id, snapshot, risk_level, created_at'
const datePattern = /^\d{4}-\d{2}-\d{2}$/

/** 可分页读模型接口（本仓库内部使用）。 */
interface AuditReadQuery {
  actorQuery?: string
  modules?: ActivityAuditEventQuery['modules']
  actions?: ActivityAuditEventQuery['actions']
  from?: string
  to?: string
  keyword?: string
  search?: string
  page?: number
  pageSize?: number
}

/** 把查询词中含有的中文标签展开为对应快照原文（枚举值如“早餐”→“breakfast”、字段名如“餐次类型”→“mealType”），供全文 LIKE 等价命中。 */
function expandSnapshotSearchValues(text: string): string[] {
  const found: string[] = []
  for (const [storage, chinese] of Object.entries(AUDIT_SNAPSHOT_VALUE_LABELS)) {
    if (chinese.includes(text)) found.push(storage)
  }
  for (const [storage, chinese] of Object.entries(AUDIT_SNAPSHOT_KEY_LABELS)) {
    if (chinese.includes(text)) found.push(storage)
  }
  return found
}

function filterParams(query: AuditReadQuery): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (query.actorQuery?.trim()) {
    clauses.push('(actor_user_id = ? OR actor_username LIKE ?)')
    const text = query.actorQuery.trim()
    params.push(text, `%${text}%`)
  }
  if (query.modules?.length) {
    clauses.push(`module_code IN (${query.modules.map(() => '?').join(',')})`)
    params.push(...query.modules)
  }
  if (query.actions?.length) {
    clauses.push(`action_code IN (${query.actions.map(() => '?').join(',')})`)
    params.push(...query.actions)
  }
  if (query.from && datePattern.test(query.from)) {
    clauses.push('created_at >= ?')
    params.push(`${query.from} 00:00:00.000`)
  }
  if (query.to && datePattern.test(query.to)) {
    clauses.push('created_at <= ?')
    params.push(`${query.to} 23:59:59.999`)
  }
  if (query.keyword?.trim()) {
    clauses.push('snapshot LIKE ?')
    params.push(`%${query.keyword.trim()}%`)
  }
  if (query.search?.trim()) {
    const text = query.search.trim()
    const terms = [text, ...expandSnapshotSearchValues(text)]
    const snapshotClauses = terms.map(() => 'snapshot LIKE ?')
    clauses.push(`(actor_user_id = ? OR actor_username LIKE ? OR ${snapshotClauses.join(' OR ')})`)
    params.push(text, `%${text}%`, ...terms.map((term) => `%${term}%`))
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

/**
 * 内容与操作审计事件仓库。
 *
 * 写入按追加日志处理，失败由调用方（Application）决定是否降级；
 * 读取面向平台管理员，按 module/action/actor/日期/关键词组合过滤，时间最新在前。
 */
export class MySqlActivityAuditRepository implements ActivityAuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: ActivityAuditEventInput): Promise<void> {
    await this.pool.execute(
      'INSERT INTO activity_audit_events(id, actor_user_id, actor_username, module_code, action_code, entity_id, snapshot, risk_level, created_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',
      [crypto.randomUUID(), input.actorUserId, input.actorUsername ?? null, input.module, input.action, input.entityId ?? null, input.snapshot ?? null, 'normal'],
    )
  }

  list(query: ActivityAuditEventQuery): Promise<ActivityAuditEventPage> {
    return this.runPageQuery(query)
  }

  listAllMatches(query: Omit<ActivityAuditEventQuery, 'page' | 'pageSize'>): Promise<ActivityAuditEvent[]> {
    return this.runAllQuery(query)
  }

  private runPageQuery(query: ActivityAuditEventQuery): Promise<ActivityAuditEventPage> {
    const { where, params } = filterParams(query)
    const page = Number.isSafeInteger(query.page) && query.page > 0 ? query.page : 1
    const pageSize = Number.isSafeInteger(query.pageSize) && query.pageSize > 0 && query.pageSize <= 100 ? query.pageSize : 20
    return (async () => {
      const [countRows] = await this.pool.query<Array<RowDataPacket & { total: number }>>(`SELECT COUNT(*) AS total FROM activity_audit_events${where}`, params)
      const total = countRows[0]?.total ?? 0
      const offset = (page - 1) * pageSize
      const [rows] = await this.pool.query<AuditRow[]>(
        `SELECT ${auditColumns} FROM activity_audit_events${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      return { items: rows.map(map), page, pageSize, total }
    })()
  }

  private async runAllQuery(query: Omit<ActivityAuditEventQuery, 'page' | 'pageSize'>): Promise<ActivityAuditEvent[]> {
    const { where, params } = filterParams(query)
    const [rows] = await this.pool.query<AuditRow[]>(
      `SELECT ${auditColumns} FROM activity_audit_events${where} ORDER BY created_at DESC, id DESC`,
      params,
    )
    return rows.map(map)
  }
}
