import type {
  BackupDocument,
  CompleteReviewInput,
  CompleteReviewResult,
  DashboardReport,
  DashboardWindow,
  CurrentAssociatedStatus,
  DeletedExplorationTrackListEntry,
  ExplorationTrack,
  ExplorationTrackHistory,
  ExplorationTrackListEntry,
  ExplorationTrackSelection,
  Item,
  ItemExplorationTrackContext,
  ItemMethodSourceDisplay,
  ItemStatus,
  ItemStatusEvent,
  Method,
  MethodApplicationContextResult,
  MethodEvidenceDetail,
  MethodVersion,
  Review,
  SearchResult,
  TrashEntry,
  TrashFilter,
} from '@knowledge-base/contracts'

export interface ApiClientError extends Error { status?: number }

export class ApiClientUnknownOutcomeError extends Error {
  readonly name = 'ApiClientUnknownOutcomeError'

  constructor() {
    super('本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。')
  }
}

export function isApiClientUnknownOutcome(error: unknown): error is ApiClientUnknownOutcomeError {
  return error instanceof ApiClientUnknownOutcomeError
}

export function isApiClientAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isWrite = init.method !== undefined && init.method !== 'GET'
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    })
  } catch (error) {
    if (isApiClientAbort(error)) {
      if (isWrite) throw new ApiClientUnknownOutcomeError()
      throw error
    }
    if (isWrite) throw new ApiClientUnknownOutcomeError()
    throw new Error('无法连接本地数据服务，请确认 API 与 MySQL 已启动。')
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
  const error = new Error(body?.error?.message ?? '本地数据服务请求失败。') as ApiClientError
  error.status = response.status
  throw error
}

const json = (value: unknown) => JSON.stringify(value)

export type ApiItemAction = { label: string; status: ItemStatus; tone: 'primary' | 'secondary' | 'danger' }

export function actionsFor(item: Item): ApiItemAction[] {
  const actions: Partial<Record<ItemStatus, Array<{ label: string; status: ItemStatus; tone: 'primary' | 'secondary' | 'danger' }>>> = {
    idea_to_try: [{ label: '开始执行', status: 'doing', tone: 'primary' }, { label: '以后再说', status: 'idea_later', tone: 'secondary' }],
    idea_later: [{ label: '重新考虑', status: 'idea_to_try', tone: 'primary' }, { label: '放弃', status: 'abandoned', tone: 'danger' }],
    doing: [{ label: '暂停', status: 'paused', tone: 'secondary' }],
    paused: [{ label: '恢复执行', status: 'doing', tone: 'primary' }, { label: '放弃', status: 'abandoned', tone: 'danger' }],
    waiting_review: [{ label: '返回执行', status: 'doing', tone: 'secondary' }],
    abandoned: [{ label: '重新考虑', status: 'idea_to_try', tone: 'primary' }],
  }
  return actions[item.status] ?? []
}

export const apiClient = {
  actionsFor,
  listItems: (signal?: AbortSignal) => request<Item[]>('/items', { signal }),
  listTrash: (signal?: AbortSignal) => request<Item[]>('/items/trash', { signal }),
  createIdea: (input: { title?: string; content?: string; saveForLater?: boolean; explorationTrack?: ExplorationTrackSelection }, signal?: AbortSignal) => request<Item>('/items', { method: 'POST', body: json(input), signal }),
  listExplorationTracks: (signal?: AbortSignal) => request<ExplorationTrackListEntry[]>('/exploration-tracks', { signal }),
  listSelectableExplorationTracks: (signal?: AbortSignal) => request<ExplorationTrack[]>('/exploration-tracks/selectable', { signal }),
  listDeletedExplorationTracks: (signal?: AbortSignal) => request<DeletedExplorationTrackListEntry[]>('/exploration-tracks/deleted', { signal }),
  getExplorationTrackHistory: (id: string, signal?: AbortSignal) => request<ExplorationTrackHistory>(`/exploration-tracks/${encodeURIComponent(id)}/history`, { signal }),
  createExplorationTrack: (name: string, signal?: AbortSignal) => request<ExplorationTrack>('/exploration-tracks', { method: 'POST', body: json({ name }), signal }),
  renameExplorationTrack: (id: string, name: string, signal?: AbortSignal) => request<ExplorationTrack>(`/exploration-tracks/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ name }), signal }),
  deleteExplorationTrack: (id: string, signal?: AbortSignal) => request<void>(`/exploration-tracks/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  restoreExplorationTrack: (id: string, signal?: AbortSignal) => request<ExplorationTrack>(`/exploration-tracks/${encodeURIComponent(id)}/restore`, { method: 'POST', signal }),
  listItemsByExplorationTrackAndStatus: (trackId: string, status: CurrentAssociatedStatus, signal?: AbortSignal) => request<Item[]>(`/items?status=${encodeURIComponent(status)}&explorationTrackId=${encodeURIComponent(trackId)}`, { signal }),
  getItemExplorationTrack: (id: string, signal?: AbortSignal) => request<ItemExplorationTrackContext>(`/items/${encodeURIComponent(id)}/exploration-track`, { signal }),
  assignItemToExplorationTrack: (id: string, trackId: string, signal?: AbortSignal) => request<ItemExplorationTrackContext>(`/items/${encodeURIComponent(id)}/exploration-track`, { method: 'PUT', body: json({ trackId }), signal }),
  removeItemFromExplorationTrack: (id: string, signal?: AbortSignal) => request<void>(`/items/${encodeURIComponent(id)}/exploration-track`, { method: 'DELETE', signal }),
  getItem: async (id: string, signal?: AbortSignal) => {
    try { return await request<Item>(`/items/${encodeURIComponent(id)}`, { signal }) }
    catch (error) { if ((error as ApiClientError).status === 404) return undefined; throw error }
  },
  updateItemContent: (id: string, content: string) => request<Item>(`/items/${encodeURIComponent(id)}/content`, { method: 'PATCH', body: json({ content }) }),
  startExecution: (id: string, startAction?: string) => request<Item>(`/items/${encodeURIComponent(id)}/start`, { method: 'POST', body: json(startAction === undefined ? {} : { startAction }) }),
  changeStatus: (id: string, status: ItemStatus) => request<Item>(`/items/${encodeURIComponent(id)}/status`, { method: 'POST', body: json({ status }) }),
  deleteItem: (id: string) => request<void>(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreItem: (id: string) => request<Item>(`/items/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  listStatusEvents: (id: string, signal?: AbortSignal) => request<ItemStatusEvent[]>(`/items/${encodeURIComponent(id)}/status-events`, { signal }),
  listMethods: (signal?: AbortSignal) => request<Method[]>('/methods', { signal }),
  completeReview: (input: CompleteReviewInput) => request<CompleteReviewResult>('/reviews/complete', { method: 'POST', body: json(input) }),
  getReviewForItem: async (id: string, signal?: AbortSignal) => {
    try { return await request<Review>(`/reviews/by-item/${encodeURIComponent(id)}`, { signal }) }
    catch (error) { if ((error as ApiClientError).status === 404) return undefined; throw error }
  },
  getReview: async (id: string, signal?: AbortSignal) => {
    try { return await request<Review>(`/reviews/${encodeURIComponent(id)}`, { signal }) }
    catch (error) { if ((error as ApiClientError).status === 404) return undefined; throw error }
  },
  listMethodVersions: (id: string, signal?: AbortSignal) => request<MethodVersion[]>(`/methods/${encodeURIComponent(id)}/versions`, { signal }),
  listMethodEvidenceDetails: (id: string, signal?: AbortSignal) => request<MethodEvidenceDetail[]>(`/methods/${encodeURIComponent(id)}/evidence`, { signal }),
  moveMethodToTrash: (id: string) => request<void>(`/methods/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreMethod: (id: string) => request<Method>(`/methods/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  createMethodItem: (methodId: string, title: string, content?: string) => request<Item>('/method-applications', { method: 'POST', body: json({ methodId, title, content }) }),
  getMethodContext: (itemId: string, signal?: AbortSignal) => request<MethodApplicationContextResult>(`/method-applications/${encodeURIComponent(itemId)}/context`, { signal }),
  listSourceDisplaysForItems: (itemIds: string[], signal?: AbortSignal) => request<ItemMethodSourceDisplay[]>(`/method-source-displays?itemIds=${encodeURIComponent(itemIds.join(','))}`, { signal }),
  search: (query: string, signal?: AbortSignal) => request<SearchResult[]>(`/search?query=${encodeURIComponent(query)}`, { signal }),
  getDashboard: (window: DashboardWindow, signal?: AbortSignal) => request<DashboardReport>(`/dashboard?window=${window}`, { signal }),
  getReport: (window: DashboardWindow, signal?: AbortSignal) => request<DashboardReport>(`/dashboard?window=${window}`, { signal }),
  listTrashEntries: (filter: TrashFilter, signal?: AbortSignal) => request<TrashEntry[]>(`/trash?filter=${filter}`, { signal }),
  createBackup: () => request<BackupDocument>('/backup'),
  restoreBackup: (document: BackupDocument) => request<void>('/backup/restore', { method: 'POST', body: json(document) }),
}
