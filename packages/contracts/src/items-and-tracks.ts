import type { Review } from './reviews-and-methods'

/**
 * 事项与探索主线契约。
 *
 * 两者共同描述事项生命周期及其主线归属；创建事项并建立主线关联必须通过
 * 同一个工作流端口完成，因此保持在同一模块中，避免人为拆出循环依赖。
 */

// --- Item / 事项 ---

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

// --- ExplorationTrack / 探索主线 ---

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

/** Application 规范化新主线名称后交给原子工作流的可信输入。 */
export type PreparedExplorationTrackSelection =
  | { type: 'existing'; trackId: string }
  | { type: 'new'; name: string; normalizedName: string }

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

/**
 * 关联上下文显式区分未关联、可用、已删除和事实不可用，消费者不得把后两者
 * 降级成“未关联”。
 */
export type ItemExplorationTrackContext =
  | { status: 'no-association'; itemId: string }
  | { status: 'available'; itemId: string; track: AvailableExplorationTrack }
  | { status: 'track-deleted'; itemId: string; track: DeletedExplorationTrack }
  | { status: 'unavailable'; itemId: string; trackId: string }

// --- Item events and links / 事项事件与关系 ---

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

// --- Repository ports / 存储与原子工作流端口 ---

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

export interface ExplorationTrackWorkflowRepository {
  createItemWithExplorationTrack(input: CreateItemInput & { id: string; createdAt: string }, selection: PreparedExplorationTrackSelection): Promise<Item>
  assignItemToExplorationTrack(itemId: string, trackId: string): Promise<ItemExplorationTrackContext>
  removeItemFromExplorationTrack(itemId: string): Promise<void>
}
