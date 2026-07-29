export * from './errors'

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
  startAction?: string
  explorationTrackId?: string
}

export interface ExplorationTrack {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type ExplorationTrackSelection =
  | { type: 'existing'; trackId: string }
  | { type: 'new'; name: string }

export type CurrentAssociatedStatus =
  | 'doing'
  | 'idea_to_try'
  | 'idea_later'
  | 'paused'

export interface ItemLocator {
  itemId: string
  status: ItemStatus
}

export interface ExplorationTrackItem {
  item: Pick<Item, 'id' | 'title' | 'status' | 'createdAt' | 'startAction'>
  locator: ItemLocator
  reviewSummary?: Pick<Review, 'actualAction' | 'result'>
  reviewSummaryStatus: 'available' | 'not-reviewed' | 'unavailable'
}

export interface CurrentAssociatedGroup {
  status: CurrentAssociatedStatus
  items: ExplorationTrackItem[]
  hasMore: boolean
  moreLocator?: {
    status: CurrentAssociatedStatus
    explorationTrackId: string
  }
}

export interface ExplorationTrackHistory {
  track: ExplorationTrack
  lifecycle: 'active' | 'deleted'
  currentAssociatedItems: CurrentAssociatedGroup[]
  history: ExplorationTrackItem[]
  abandonedHistory: ExplorationTrackItem[]
}

export interface ExplorationTrackListEntry {
  track: ExplorationTrack
  latestAssociatedItem?: Pick<Item, 'id' | 'title' | 'status' | 'createdAt'>
}

export interface DeletedExplorationTrackListEntry {
  track: Required<Pick<ExplorationTrack, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'deletedAt'>>
}

export type AvailableExplorationTrack = Omit<ExplorationTrack, 'deletedAt'> & {
  deletedAt?: undefined
}

export type DeletedExplorationTrack = Omit<ExplorationTrack, 'deletedAt'> & {
  deletedAt: string
}

export type ItemExplorationTrackContext =
  | { status: 'no-association'; itemId: string }
  | { status: 'available'; itemId: string; track: AvailableExplorationTrack }
  | { status: 'track-deleted'; itemId: string; track: DeletedExplorationTrack }
  | { status: 'unavailable'; itemId: string; trackId: string }

export interface ExplorationTrackRepository {
  create(input: { id: string; name: string; normalizedName: string; createdAt: string }): Promise<ExplorationTrack>
  getById(id: string): Promise<ExplorationTrack | undefined>
  rename(id: string, input: { name: string; normalizedName: string; updatedAt: string }): Promise<ExplorationTrack>
  softDelete(id: string, deletedAt: string): Promise<void>
  restore(id: string, updatedAt: string): Promise<ExplorationTrack>
  listActive(): Promise<ExplorationTrackListEntry[]>
  listSelectable(): Promise<ExplorationTrack[]>
  listDeleted(): Promise<DeletedExplorationTrackListEntry[]>
  getHistory(id: string): Promise<ExplorationTrackHistory | undefined>
  getItemContext(itemId: string): Promise<ItemExplorationTrackContext | undefined>
  listItemsByTrackAndStatus(trackId: string, status: CurrentAssociatedStatus): Promise<Item[]>
}

export type PreparedExplorationTrackSelection =
  | { type: 'existing'; trackId: string }
  | { type: 'new'; name: string; normalizedName: string }

export interface ExplorationTrackWorkflowRepository {
  createItemWithExplorationTrack(input: CreateItemInput & { id: string; createdAt: string }, selection: PreparedExplorationTrackSelection): Promise<Item>
  assignItemToExplorationTrack(itemId: string, trackId: string): Promise<ItemExplorationTrackContext>
  removeItemFromExplorationTrack(itemId: string): Promise<void>
}

export interface CreateItemInput {
  title: string
  content?: string
  status?: ItemStatus
  explorationTrack?: ExplorationTrackSelection
}

export interface UpdateItemContentInput {
  content: string
}

export interface StartItemExecutionInput {
  startAction?: string
  overwriteExistingStartAction?: boolean
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
  deletedAt?: string
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

export type MethodApplicationUnavailableReason =
  | 'method-missing'
  | 'version-missing'
  | 'method-and-version-missing'

export type MethodApplicationContextResult =
  | { status: 'no-association' }
  | {
      status: 'available'
      application: MethodApplication
      method: Method
      version: MethodVersion
    }
  | {
      status: 'method-in-trash'
      application: MethodApplication
      method: Method
      version: MethodVersion
    }
  | {
      status: 'method-purged'
      application: MethodApplication
      tombstone: MethodTombstone
    }
  | {
      status: 'unavailable'
      application: MethodApplication
      reason: MethodApplicationUnavailableReason
    }

export type ItemMethodSourceDisplay =
  | { status: 'no-association'; itemId: string }
  | { status: 'available'; itemId: string; title: string }
  | { status: 'method-in-trash'; itemId: string; title: string }
  | { status: 'method-purged'; itemId: string; title: string }
  | { status: 'unavailable'; itemId: string; title?: string }

export interface MethodEvidence {
  id: string
  methodId: string
  reviewId: string
  createdAt: string
  relation?: MethodEvidenceRelation
  methodVersion?: number
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

export interface MethodTombstoneVersion {
  version: number
}

export interface MethodTombstone {
  methodId: string
  title: string
  permanentlyDeletedAt: string
  versions: MethodTombstoneVersion[]
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
  methodTombstones: MethodTombstone[]
}

/** The persisted form includes the normalized database key so V3 restores do
 * not need to infer it from display text. */
export interface BackupExplorationTrack extends ExplorationTrack {
  normalizedName: string
}

export interface BackupDataV3 extends BackupData {
  explorationTracks: BackupExplorationTrack[]
}

export interface BackupDocumentV1 {
  format: 'knowledge-base-backup'
  version: 1
  exportedAt: string
  appVersion: string
  data: Omit<BackupData, 'methodTombstones'> & { methodTombstones?: MethodTombstone[] }
}

export interface BackupDocumentV2 {
  format: 'knowledge-base-backup'
  version: 2
  exportedAt: string
  appVersion: string
  data: BackupData
}

export interface BackupDocumentV3 {
  format: 'knowledge-base-backup'
  version: 3
  exportedAt: string
  appVersion: string
  data: BackupDataV3
}

export type BackupDocument = BackupDocumentV1 | BackupDocumentV2 | BackupDocumentV3

export interface BackupRepository {
  exportData(): Promise<BackupData | BackupDataV3>
  replaceData(data: BackupData | BackupDataV3): Promise<void>
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

export type TrashEntry =
  | { type: 'item'; id: string; title: string; deletedAt: string }
  | { type: 'method'; id: string; title: string; deletedAt: string }
  | { type: 'exploration-track'; id: string; title: string; deletedAt: string }

export type TrashFilter = 'all' | 'item' | 'method' | 'exploration-track'

export interface MethodApplicationRepository {
  createItem(input: CreateMethodApplicationInput): Promise<Item>
  getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined>
  getContextResultByItemId(itemId: string): Promise<MethodApplicationContextResult>
  listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]>
}

export interface ItemRepository {
  create(input: CreateItemInput): Promise<Item>
  getById(id: string): Promise<Item | undefined>
  list(): Promise<Item[]>
  listDeleted(): Promise<Item[]>
  listStatusEvents(itemId: string): Promise<ItemStatusEvent[]>
  changeStatus(id: string, status: ItemStatus): Promise<Item>
  startExecution(id: string, input?: StartItemExecutionInput): Promise<Item>
  updateContent(id: string, input: UpdateItemContentInput): Promise<Item>
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
  moveToTrash(methodId: string): Promise<void>
  restore(methodId: string): Promise<Method>
  listDeleted(): Promise<Method[]>
  purgeDeletedBefore(cutoff: string): Promise<void>
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
