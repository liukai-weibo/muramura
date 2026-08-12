import type {
  AdminResetPasswordRequest,
  AdminResetPasswordResponse,
  AdminUpdateUsernameRequest,
  AuthSession,
  AuthUser,
  BackupDocument,
  ChangeOwnPasswordInput,
  ChangeOwnUsernameInput,
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
  AdminChangeUserAccountStateRequest,
  AdminRevokeUserSessionsRequest,
  AdminRevokeUserSessionsResponse,
  AdminSetUserRolesRequest,
  PlatformUserPage,
  PlatformUserSummary,
  Review,
  SearchResult,
  TrashEntry,
  TrashFilter,
  TrashPurgeEntry,
  AiConfigInput,
  AiConfigMetadata,
  AiPreference,
  AiPreferenceInput,
  AiChatMessage,
  AiConversation,
  AiConversationSnapshot,
  AiStreamEvent,
} from '@knowledge-base/contracts'

export interface ApiClientError extends Error {
  status?: number
  code?: string
  businessCode?: string
  requestId?: string
}

let authenticationContextVersion = 0
let unauthorizedHandler: (() => void) | undefined
let adminForbiddenHandler: ((error: ApiClientError) => void) | undefined

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

export function resolveApiTransport(options: { isTauri?: boolean; configuredOrigin?: string } = {}): { origin: string; credentials: RequestCredentials } {
  const isDesktop = options.isTauri ?? isTauriRuntime()
  if (!isDesktop) return { origin: '', credentials: 'same-origin' }
  const configuredOrigin = String(options.configuredOrigin ?? process.env.TARO_APP_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  return { origin: configuredOrigin || 'http://127.0.0.1:32146', credentials: 'omit' }
}

const { origin: apiOrigin, credentials: apiCredentials } = resolveApiTransport()
const desktopTransport = apiCredentials === 'omit'
let desktopSessionToken: string | undefined
const apiUrl = (path: string) => `${apiOrigin}/api/v1${path}`

export function advanceApiClientAuthenticationContext(): void {
  authenticationContextVersion += 1
}

export function setApiClientUnauthorizedHandler(handler: (() => void) | undefined): () => void {
  unauthorizedHandler = handler
  return () => { if (unauthorizedHandler === handler) unauthorizedHandler = undefined }
}

export function setApiClientAdminForbiddenHandler(handler: ((error: ApiClientError) => void) | undefined): () => void {
  adminForbiddenHandler = handler
  return () => { if (adminForbiddenHandler === handler) adminForbiddenHandler = undefined }
}

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
  const requestAuthenticationContext = authenticationContextVersion
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: apiCredentials,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(desktopTransport && desktopSessionToken ? { authorization: `Bearer ${desktopSessionToken}` } : {}),
        ...init.headers,
      },
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
    if (desktopTransport && (path === '/auth/login' || path === '/auth/register')) {
      const token = response.headers.get('x-kb-session-token')
      if (token) desktopSessionToken = token
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  const body = await response.json().catch(() => undefined) as { error?: { code?: string; businessCode?: string; message?: string; requestId?: string } } | undefined
  const error = new Error(body?.error?.message ?? '本地数据服务请求失败。') as ApiClientError
  error.status = response.status
  error.code = body?.error?.code
  error.businessCode = body?.error?.businessCode
  error.requestId = body?.error?.requestId
  const rejectedCurrentPassword = path === '/account/password' && error.businessCode === 'AUTH_CURRENT_PASSWORD_INVALID'
  if (response.status === 401 && desktopTransport) desktopSessionToken = undefined
  if (response.status === 401 && !path.startsWith('/auth/') && !rejectedCurrentPassword && requestAuthenticationContext === authenticationContextVersion) unauthorizedHandler?.()
  if (response.status === 403 && path.startsWith('/admin/') && requestAuthenticationContext === authenticationContextVersion) adminForbiddenHandler?.(error)
  throw error
}

const json = (value: unknown) => JSON.stringify(value)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function parseAuthUser(value: unknown): AuthUser {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'username', 'roles', 'createdAt'])
    || typeof value.id !== 'string' || value.id.length === 0
    || typeof value.username !== 'string' || value.username.length === 0
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))
    || !Array.isArray(value.roles)
    || !(value.roles.length === 1 && value.roles[0] === 'member')
      && !(value.roles.length === 2 && value.roles[0] === 'member' && (value.roles[1] === 'ordinary_admin' || value.roles[1] === 'platform_admin'))) {
    throw new Error('账户响应结构无效。')
  }
  return { id: value.id, username: value.username, roles: [...value.roles], createdAt: value.createdAt } as AuthUser
}

function parsePlatformUserSummary(value: unknown): PlatformUserSummary {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'username', 'roles', 'createdAt', 'deletedAt']) && !hasExactKeys(value, ['id', 'username', 'roles', 'isInitialPlatformAdmin', 'createdAt', 'deletedAt'])
    || typeof value.id !== 'string' || value.id.length === 0
    || typeof value.username !== 'string' || value.username.length === 0
    || value.isInitialPlatformAdmin !== undefined && typeof value.isInitialPlatformAdmin !== 'boolean'
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))
    || !(value.deletedAt === null || typeof value.deletedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.deletedAt) && Number.isFinite(Date.parse(value.deletedAt)))
    || !Array.isArray(value.roles)
    || !(value.roles.length === 1 && value.roles[0] === 'member')
      && !(value.roles.length === 2 && value.roles[0] === 'member' && (value.roles[1] === 'ordinary_admin' || value.roles[1] === 'platform_admin'))) {
    throw new Error('用户管理响应结构无效。')
  }
  return { id: value.id, username: value.username, roles: [...value.roles], isInitialPlatformAdmin: value.isInitialPlatformAdmin === true, createdAt: value.createdAt, deletedAt: value.deletedAt } as PlatformUserSummary
}

function parsePlatformUserPage(value: unknown, expectedPage: number): PlatformUserPage {
  if (!isRecord(value) || !hasExactKeys(value, ['items', 'page', 'pageSize', 'total'])
    || !Number.isSafeInteger(value.page) || value.page !== expectedPage || expectedPage < 1
    || value.pageSize !== 20
    || !Number.isSafeInteger(value.total) || (value.total as number) < 0
    || !Array.isArray(value.items)) {
    throw new Error('用户管理列表响应结构无效。')
  }
  const items = value.items.map(parsePlatformUserSummary)
  const availableOnPage = Math.max(0, Math.min(20, (value.total as number) - (expectedPage - 1) * 20))
  if (items.length > availableOnPage) throw new Error('用户管理列表条目数量无效。')
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('用户管理列表包含重复用户。')
  return { items, page: expectedPage, pageSize: 20, total: value.total as number }
}

function parseRevokeSessionsResponse(value: unknown): AdminRevokeUserSessionsResponse {
  if (!isRecord(value) || !hasExactKeys(value, ['revokedSessionCount']) || !Number.isSafeInteger(value.revokedSessionCount) || (value.revokedSessionCount as number) < 0) {
    throw new Error('会话撤销响应结构无效。')
  }
  return { revokedSessionCount: value.revokedSessionCount as number }
}

async function parseUnknownAuthUserWrite(promise: Promise<unknown>): Promise<AuthUser> {
  try {
    return parseAuthUser(await promise)
  } catch (error) {
    if (error instanceof ApiClientUnknownOutcomeError || (error as ApiClientError).status !== undefined) throw error
    throw new ApiClientUnknownOutcomeError()
  }
}

async function parseUnknownVoidWrite(promise: Promise<unknown>): Promise<void> {
  try {
    if (await promise !== undefined) throw new Error('写入响应结构无效。')
  } catch (error) {
    if (error instanceof ApiClientUnknownOutcomeError || (error as ApiClientError).status !== undefined) throw error
    throw new ApiClientUnknownOutcomeError()
  }
}

async function parseUnknownUserWrite(promise: Promise<unknown>, targetUserId: string, mismatchMessage: string): Promise<PlatformUserSummary> {
  try {
    const summary = parsePlatformUserSummary(await promise)
    if (summary.id !== targetUserId) throw new Error(mismatchMessage)
    return summary
  } catch (error) {
    if (error instanceof ApiClientUnknownOutcomeError || (error as ApiClientError).status !== undefined) throw error
    throw new ApiClientUnknownOutcomeError()
  }
}

async function parseUnknownSessionsWrite(promise: Promise<unknown>): Promise<AdminRevokeUserSessionsResponse> {
  try {
    return parseRevokeSessionsResponse(await promise)
  } catch (error) {
    if (error instanceof ApiClientUnknownOutcomeError || (error as ApiClientError).status !== undefined) throw error
    throw new ApiClientUnknownOutcomeError()
  }
}

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validOperationId(value: string): boolean {
  return operationIdPattern.test(value)
}

function validAdminTargetId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f/?#]/.test(value)
}

function validPlatformRoles(value: readonly string[]): boolean {
  return value.length === 1 && value[0] === 'member'
    || value.length === 2 && value[0] === 'member' && value[1] === 'ordinary_admin'
}

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
  register: (input: { username: string; password: string }) => request<AuthSession>('/auth/register', { method: 'POST', body: json(input) }),
  login: (input: { username: string; password: string }) => request<AuthSession>('/auth/login', { method: 'POST', body: json(input) }),
  logout: async () => { try { return await request<void>('/auth/logout', { method: 'POST', body: json({}) }) } finally { if (desktopTransport) desktopSessionToken = undefined } },
  getCurrentSession: (signal?: AbortSignal) => request<AuthSession>('/auth/session', { signal }),
  changeOwnUsername: (input: ChangeOwnUsernameInput) => parseUnknownAuthUserWrite(
    request<unknown>('/account/username', { method: 'PATCH', body: json(input) }),
  ),
  changeOwnPassword: (input: ChangeOwnPasswordInput) => parseUnknownVoidWrite(
    request<unknown>('/account/password', { method: 'POST', body: json(input) }),
  ),
  listPlatformUsers: async (input: { page: number; query?: string }, signal?: AbortSignal) => {
    const query = input.query?.trim()
    if (!Number.isSafeInteger(input.page) || input.page < 1 || (query?.length ?? 0) > 80) throw new Error('用户列表请求参数无效。')
    const search = new URLSearchParams({ page: String(input.page) })
    if (query) search.set('query', query)
    return parsePlatformUserPage(await request<unknown>(`/admin/users?${search.toString()}`, { signal }), input.page)
  },
  setPlatformUserRoles: (targetUserId: string, input: AdminSetUserRolesRequest) => {
    if (!validAdminTargetId(targetUserId) || !validPlatformRoles(input.roles) || !validOperationId(input.operationId)) return Promise.reject(new Error('用户角色请求参数无效。'))
    return parseUnknownUserWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/roles`, { method: 'PUT', body: json({ roles: input.roles, operationId: input.operationId }) }),
      targetUserId,
      '角色响应目标不匹配。',
    )
  },
  revokePlatformUserSessions: (targetUserId: string, input: AdminRevokeUserSessionsRequest) => {
    if (!validAdminTargetId(targetUserId) || !validOperationId(input.operationId)) return Promise.reject(new Error('会话撤销请求参数无效。'))
    return parseUnknownSessionsWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/revoke-sessions`, { method: 'POST', body: json({ operationId: input.operationId }) }),
    )
  },
  updatePlatformUsername: (targetUserId: string, input: AdminUpdateUsernameRequest) => {
    if (!validAdminTargetId(targetUserId) || !validOperationId(input.operationId)) return Promise.reject(new Error('用户名修改请求参数无效。'))
    return parseUnknownUserWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/username`, { method: 'PATCH', body: json(input) }),
      targetUserId,
      '用户名修改响应目标不匹配。',
    )
  },
  resetPlatformUserPassword: (targetUserId: string, input: AdminResetPasswordRequest): Promise<AdminResetPasswordResponse> => {
    if (!validAdminTargetId(targetUserId) || !validOperationId(input.operationId)) return Promise.reject(new Error('密码重置请求参数无效。'))
    return parseUnknownSessionsWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/reset-password`, { method: 'POST', body: json(input) }),
    )
  },
  getPlatformUser: async (targetUserId: string, signal?: AbortSignal) => {
    if (!validAdminTargetId(targetUserId)) throw new Error('用户读取请求参数无效。')
    const result = parsePlatformUserSummary(await request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}`, { signal }))
    if (result.id !== targetUserId) throw new Error('用户响应目标不匹配。')
    return result
  },
  softDeletePlatformUser: (targetUserId: string, input: AdminChangeUserAccountStateRequest) => {
    if (!validAdminTargetId(targetUserId) || !validOperationId(input.operationId)) return Promise.reject(new Error('账号删除请求参数无效。'))
    return parseUnknownUserWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/soft-delete`, { method: 'POST', body: json(input) }),
      targetUserId,
      '账号删除响应目标不匹配。',
    )
  },
  restorePlatformUser: (targetUserId: string, input: AdminChangeUserAccountStateRequest) => {
    if (!validAdminTargetId(targetUserId) || !validOperationId(input.operationId)) return Promise.reject(new Error('账号恢复请求参数无效。'))
    return parseUnknownUserWrite(
      request<unknown>(`/admin/users/${encodeURIComponent(targetUserId)}/restore`, { method: 'POST', body: json(input) }),
      targetUserId,
      '账号恢复响应目标不匹配。',
    )
  },
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
  startExecution: (id: string, input: { startAction?: string; overwriteExistingStartAction?: boolean } = {}) => request<Item>(`/items/${encodeURIComponent(id)}/start`, { method: 'POST', body: json(input) }),
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
  purgeTrashEntry: (entry: TrashPurgeEntry, signal?: AbortSignal) => request<void>(`/trash/${entry.type}/${encodeURIComponent(entry.id)}`, { method: 'DELETE', signal }),
  purgeTrashEntries: (entries: TrashPurgeEntry[], signal?: AbortSignal) => request<void>('/trash/purge', { method: 'POST', body: json({ entries }), signal }),
  createBackup: () => request<BackupDocument>('/backup'),
  restoreBackup: (document: BackupDocument) => request<void>('/backup/restore', { method: 'POST', body: json(document) }),
  getExperimentalAiConfig: (signal?: AbortSignal) => request<AiConfigMetadata>('/admin/experimental/ai-config', { signal }),
  setExperimentalAiConfig: (input: AiConfigInput, signal?: AbortSignal) => request<AiConfigMetadata>('/admin/experimental/ai-config', { method: 'PUT', body: json(input), signal }),
  clearExperimentalAiConfig: (signal?: AbortSignal) => request<void>('/admin/experimental/ai-config', { method: 'DELETE', signal }),
  getAiPreferences: (signal?: AbortSignal) => request<AiPreference[]>('/ai/preferences', { signal }),
  createAiPreference: (input: AiPreferenceInput, signal?: AbortSignal) => request<AiPreference>('/ai/preferences', { method: 'POST', body: json(input), signal }),
  updateAiPreference: (id: string, input: AiPreferenceInput, signal?: AbortSignal) => request<AiPreference>(`/ai/preferences/${encodeURIComponent(id)}`, { method: 'PUT', body: json(input), signal }),
  deleteAiPreference: (id: string, signal?: AbortSignal) => request<void>(`/ai/preferences/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  getExperimentalAiConversation: (options?: { limit?: number; beforeSequence?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams()
    if (options?.limit !== undefined) query.set('limit', String(options.limit))
    if (options?.beforeSequence !== undefined) query.set('beforeSequence', String(options.beforeSequence))
    return request<AiConversationSnapshot>(`/experimental/ai-conversation${query.toString() ? `?${query}` : ''}`, { signal })
  },
  listAiConversations: (includeDeleted = false, signal?: AbortSignal) => request<AiConversation[]>(`/experimental/ai-conversations${includeDeleted ? '?includeDeleted=true' : ''}`, { signal }),
  listAiConversationTrash: (signal?: AbortSignal) => request<AiConversation[]>('/experimental/ai-conversations/trash', { signal }),
  createAiConversation: (title?: string, signal?: AbortSignal) => request<AiConversation>('/experimental/ai-conversations', { method: 'POST', body: json(title === undefined ? {} : { title }), signal }),
  updateAiConversationTitle: (id: string, title: string, signal?: AbortSignal) => request<AiConversation>(`/experimental/ai-conversations/${encodeURIComponent(id)}/title`, { method: 'PATCH', body: json({ title }), signal }),
  archiveAiConversation: (id: string, signal?: AbortSignal) => request<AiConversation>(`/experimental/ai-conversations/${encodeURIComponent(id)}/archive`, { method: 'POST', signal }),
  restoreAiConversation: (id: string, signal?: AbortSignal) => request<AiConversation>(`/experimental/ai-conversations/${encodeURIComponent(id)}/restore`, { method: 'POST', signal }),
  deleteAiConversation: (id: string, signal?: AbortSignal) => request<AiConversation>(`/experimental/ai-conversations/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  purgeAiConversation: (id: string, signal?: AbortSignal) => request<void>(`/experimental/ai-conversations/${encodeURIComponent(id)}/purge`, { method: 'DELETE', signal }),
  getExperimentalAiConversationById: (id: string, options?: { limit?: number; beforeSequence?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams()
    if (options?.limit !== undefined) query.set('limit', String(options.limit))
    if (options?.beforeSequence !== undefined) query.set('beforeSequence', String(options.beforeSequence))
    return request<AiConversationSnapshot>(`/experimental/ai-conversations/${encodeURIComponent(id)}${query.toString() ? `?${query}` : ''}`, { signal })
  },
  streamExperimentalAiChat: async function* (messages: AiChatMessage[], signal?: AbortSignal, conversationId?: string): AsyncGenerator<AiStreamEvent> {
    if (messages.some((message) => message.role === 'system')) throw new Error('system messages are server-owned')
    const response = await fetch(apiUrl('/experimental/ai-chat/stream'), { method: 'POST', credentials: apiCredentials, headers: { 'content-type': 'application/json', ...(desktopTransport && desktopSessionToken ? { authorization: `Bearer ${desktopSessionToken}` } : {}) }, body: json({ messages, ...(conversationId ? { conversationId } : {}) }), signal })
    if (!response.ok) throw new Error('AI stream failed')
    if (!response.body) throw new Error('AI stream failed')
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
    const parse = function* (chunk: string): Generator<AiStreamEvent> {
      const data = chunk.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (data) yield JSON.parse(data) as AiStreamEvent
    }
    while (true) {
      const next = await reader.read(); if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const chunks = buffer.split(/\r?\n\r?\n/); buffer = chunks.pop() ?? ''
      for (const chunk of chunks) yield* parse(chunk)
    }
    if (buffer.trim()) yield* parse(buffer)
  },
}
