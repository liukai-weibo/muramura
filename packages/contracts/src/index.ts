export const itemStatuses = [
  'idea_to_try',
  'idea_later',
  'doing',
  'paused',
  'waiting_review',
  'reviewed',
  'archived_no_review',
  'abandoned',
] as const

export type ItemStatus = (typeof itemStatuses)[number]

export interface Item {
  id: string
  title: string
  content: string
  status: ItemStatus
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface CreateItemInput {
  title: string
  content?: string
  status?: ItemStatus
}

export interface Review {
  id: string
  itemId: string
  actualAction: string
  result: string
  effective: string
  incompatible: string
  reason: string
  adjustment: string
  newIdeas: string
  createdAt: string
  updatedAt: string
}

export interface CreateReviewInput {
  itemId: string
  actualAction: string
  result: string
  effective: string
  incompatible: string
  reason: string
  adjustment: string
  newIdeas?: string
}

export interface Method {
  id: string
  title: string
  applicable: string
  unsuitable: string
  steps: string
  validationCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateMethodInput {
  title: string
  applicable: string
  unsuitable?: string
  steps: string
}

export interface MethodVersion {
  id: string
  methodId: string
  version: number
  title: string
  applicable: string
  unsuitable: string
  steps: string
  sourceReviewId?: string
  createdAt: string
}

export interface ValidateMethodInput {
  methodId: string
  revision?: CreateMethodInput
}

export interface MethodApplication {
  id: string
  methodId: string
  methodVersion: number
  itemId: string
  createdAt: string
}

export interface CreateMethodApplicationInput {
  methodId: string
  title: string
  content?: string
}

export interface MethodApplicationContext {
  application: MethodApplication
  method: Method
  version: MethodVersion
}

export interface MethodEvidence {
  id: string
  methodId: string
  reviewId: string
  createdAt: string
}

export type MethodEvidenceRelation = 'formation' | 'validation' | 'revision' | 'unknown'

export interface MethodEvidenceDetail {
  evidenceId: string
  methodId: string
  reviewId: string
  itemId: string
  itemTitle: string
  reviewCreatedAt: string
  reviewSummary: string
  relation: MethodEvidenceRelation
  methodVersion?: number
}

export interface ItemStatusEvent {
  id: string
  itemId: string
  fromStatus?: ItemStatus
  toStatus: ItemStatus
  createdAt: string
}

export type ItemLinkType = 'derived_from_review'

export interface ItemLink {
  id: string
  sourceReviewId: string
  targetItemId: string
  type: ItemLinkType
  createdAt: string
}

export interface BackupData {
  items: Item[]
  reviews: Review[]
  methods: Method[]
  methodEvidence: MethodEvidence[]
  methodVersions: MethodVersion[]
  methodApplications: MethodApplication[]
  itemStatusEvents: ItemStatusEvent[]
  itemLinks: ItemLink[]
}

export interface BackupDocument {
  format: 'knowledge-base-backup'
  version: 1
  exportedAt: string
  appVersion: string
  data: BackupData
}

export interface BackupRepository {
  exportData(): Promise<BackupData>
  replaceData(data: BackupData): Promise<void>
}

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

export type SearchResultType = 'item' | 'review' | 'method'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  excerpt: string
  itemId?: string
  itemStatus?: ItemStatus
  methodId?: string
  methodVersion?: number
}

export interface SearchRepository {
  search(query: string): Promise<SearchResult[]>
}

export interface MethodApplicationRepository {
  createItem(input: CreateMethodApplicationInput): Promise<Item>
  getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined>
}

export interface ItemRepository {
  create(input: CreateItemInput): Promise<Item>
  getById(id: string): Promise<Item | undefined>
  list(): Promise<Item[]>
  listDeleted(): Promise<Item[]>
  listStatusEvents(itemId: string): Promise<ItemStatusEvent[]>
  changeStatus(id: string, status: ItemStatus): Promise<Item>
  delete(id: string): Promise<void>
  restore(id: string): Promise<Item>
  purgeDeletedBefore(cutoff: string): Promise<void>
}

export interface ReviewRepository {
  create(input: CreateReviewInput): Promise<Review>
  getById(id: string): Promise<Review | undefined>
  getByItemId(itemId: string): Promise<Review | undefined>
  delete(id: string): Promise<void>
}

export interface MethodRepository {
  createFromReview(input: CreateMethodInput, reviewId: string): Promise<Method>
  list(): Promise<Method[]>
  listByReviewId(reviewId: string): Promise<Method[]>
  listVersions(methodId: string): Promise<MethodVersion[]>
  listEvidenceDetails(methodId: string): Promise<MethodEvidenceDetail[]>
  validateFromReview(methodId: string, reviewId: string, revision?: CreateMethodInput): Promise<Method>
}

export interface CompleteReviewInput extends CreateReviewInput {
  method?: CreateMethodInput
  existingMethod?: ValidateMethodInput
}

export interface CompleteReviewResult {
  item: Item
  review: Review
  method?: Method
  createdIdea?: Item
}

export interface ReviewWorkflowRepository {
  complete(input: CompleteReviewInput): Promise<CompleteReviewResult>
}
