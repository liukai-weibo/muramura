import type { Item, ItemStatus, ItemStatusEvent } from './items-and-tracks'
import type {
  Method,
  MethodApplication,
  MethodEvidence,
  MethodVersion,
  Review,
} from './reviews-and-methods'

/**
 * 面向查询与展示的组合读模型。这里定义结果形状和读取端口，不承载前端状态，
 * 也不允许消费者根据文案或缺失字段反推业务关系。
 */

// --- Dashboard / 仪表盘 ---

export type DashboardWindow = '7d' | '30d' | 'all'

export interface DashboardSnapshot {
  items: Item[]
  reviews: Review[]
  methods: Method[]
  methodEvidence: MethodEvidence[]
  methodVersions: MethodVersion[]
  methodApplications: MethodApplication[]
  itemStatusEvents: ItemStatusEvent[]
}

export type DashboardMetricKey =
  | 'newItems'
  | 'startedExecutions'
  | 'completedReviews'
  | 'newMethods'
  | 'methodValidations'
  | 'methodRevisions'
  | 'methodApplications'

export interface DashboardDrilldownRecord {
  id: string
  title: string
  detail: string
  itemId?: string
  methodId?: string
}

export interface DashboardMetrics {
  newItems: number
  startedExecutions: number
  completedReviews: number
  newMethods: number
  methodValidations: number
  methodRevisions: number
  methodApplications: number
}

export interface DashboardBacklog {
  ideaToTry: number
  doing: number
  waitingReview: number
  paused: number
  ideaLater: number
}

export interface DashboardMethodInsight {
  methodId: string
  title: string
  count: number
  detail: string
}

export interface DashboardReport {
  window: DashboardWindow
  metrics: DashboardMetrics
  metricRecords: Record<DashboardMetricKey, DashboardDrilldownRecord[]>
  backlog: DashboardBacklog
  mostValidated?: DashboardMethodInsight
  mostApplied?: DashboardMethodInsight
  recentlyRevised?: DashboardMethodInsight
  unreviewedMethodActions: number
  facts: string[]
}

export interface DashboardRepository {
  getSnapshot(): Promise<DashboardSnapshot>
}

// --- Search / 搜索 ---

export type SearchResultType = 'item' | 'review' | 'method' | 'daily-note' | 'exploration-track'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  excerpt: string
  itemId?: string
  itemStatus?: ItemStatus
  methodId?: string
  methodVersion?: number
  entryDate?: string
  explorationTrackId?: string
  deletedAt?: string
}

export interface SearchRepository {
  search(query: string): Promise<SearchResult[]>
}

// --- Trash / 统一回收站展示 ---

export type TrashEntry =
  | { type: 'item'; id: string; title: string; deletedAt: string }
  | { type: 'method'; id: string; title: string; deletedAt: string }
  | { type: 'exploration-track'; id: string; title: string; deletedAt: string }

export type TrashFilter = 'all' | 'item' | 'method' | 'exploration-track'

export type TrashPurgeEntry = Pick<TrashEntry, 'type' | 'id'>

export interface TrashPurgeRepository {
  purge(entries: readonly TrashPurgeEntry[]): Promise<void>
}
