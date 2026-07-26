import type {
  BackupDocument,
  BackupData,
  BackupDataV3,
  BackupRepository,
  CompleteReviewInput,
  CompleteReviewResult,
  DashboardReport,
  DashboardRepository,
  DashboardSnapshot,
  DashboardWindow,
  ExplorationTrack,
  ExplorationTrackRepository,
  ExplorationTrackSelection,
  PreparedExplorationTrackSelection,
  ExplorationTrackWorkflowRepository,
  CurrentAssociatedStatus,
  CreateItemInput,
  Item,
  ItemMethodSourceDisplay,
  ItemRepository,
  ItemStatus,
  ItemStatusEvent,
  Method,
  MethodApplicationContext,
  MethodApplicationContextResult,
  MethodApplicationRepository,
  MethodRepository,
  MethodTombstone,
  TrashEntry,
  TrashFilter,
  MethodVersion,
  Review,
  ReviewRepository,
  ReviewWorkflowRepository,
  SearchRepository,
  SearchResult,
} from '@knowledge-base/contracts'
import { allowedTransitions, createId } from '@knowledge-base/domain'
import { itemStatuses } from '@knowledge-base/contracts'

export const TRASH_RETENTION_DAYS = 30

function trashCutoff(now = new Date()): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export interface CaptureIdeaInput {
  title?: string
  content?: string
  saveForLater?: boolean
  explorationTrack?: ExplorationTrackSelection
}

export interface ItemAction {
  label: string
  status: ItemStatus
  tone: 'primary' | 'secondary' | 'danger'
}

const statusActions: Partial<Record<ItemStatus, readonly ItemAction[]>> = {
  idea_to_try: [
    { label: '开始执行', status: 'doing', tone: 'primary' },
    { label: '以后再说', status: 'idea_later', tone: 'secondary' },
    { label: '放弃', status: 'abandoned', tone: 'danger' },
  ],
  idea_later: [
    { label: '重新考虑', status: 'idea_to_try', tone: 'primary' },
    { label: '放弃', status: 'abandoned', tone: 'danger' },
  ],
  doing: [
    { label: '暂停', status: 'paused', tone: 'secondary' },
    { label: '放弃', status: 'abandoned', tone: 'danger' },
  ],
  paused: [
    { label: '恢复执行', status: 'doing', tone: 'primary' },
    { label: '放弃', status: 'abandoned', tone: 'danger' },
  ],
  waiting_review: [
    { label: '返回执行', status: 'doing', tone: 'secondary' },
  ],
  abandoned: [
    { label: '重新考虑', status: 'idea_to_try', tone: 'primary' },
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireUniqueIds(entries: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`${label}存在空 ID 或重复 ID`)
    ids.add(entry.id)
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function requireV3Timestamp(value: unknown, label: string): void {
  if (!isTimestamp(value)) throw new Error(`V3 ${label}存在无效时间`)
}

/** V3 is validated completely before the repository can begin its transaction. */
function validateV3Data(data: BackupDataV3): void {
  const collections: Array<[string, unknown[]]> = [
    ['items', data.items], ['reviews', data.reviews], ['methods', data.methods],
    ['methodEvidence', data.methodEvidence], ['methodVersions', data.methodVersions],
    ['methodApplications', data.methodApplications], ['itemStatusEvents', data.itemStatusEvents],
    ['itemLinks', data.itemLinks], ['methodTombstones', data.methodTombstones], ['explorationTracks', data.explorationTracks],
  ]
  for (const [name, entries] of collections) {
    if (!Array.isArray(entries)) throw new Error(`V3 备份缺少 ${name} 数据表`)
    for (const entry of entries) {
      if (!isRecord(entry)) throw new Error(`V3 ${name}中存在无效记录`)
      if (name !== 'methodTombstones' && (typeof entry.id !== 'string' || !entry.id.trim())) throw new Error(`V3 ${name}中存在无效 ID`)
    }
  }
  for (const item of data.items) {
    requireV3Timestamp(item.createdAt, '事项'); requireV3Timestamp(item.updatedAt, '事项')
    if (item.deletedAt !== undefined) requireV3Timestamp(item.deletedAt, '事项')
    if (item.explorationTrackId !== undefined && (typeof item.explorationTrackId !== 'string' || !item.explorationTrackId.trim())) throw new Error('V3 事项存在无效主线引用')
  }
  for (const review of data.reviews) { requireV3Timestamp(review.createdAt, '复盘'); requireV3Timestamp(review.updatedAt, '复盘') }
  for (const method of data.methods) { requireV3Timestamp(method.createdAt, '方法'); requireV3Timestamp(method.updatedAt, '方法'); if (method.deletedAt !== undefined) requireV3Timestamp(method.deletedAt, '方法') }
  for (const entry of data.methodEvidence) requireV3Timestamp(entry.createdAt, '方法证据')
  for (const entry of data.methodVersions) requireV3Timestamp(entry.createdAt, '方法版本')
  for (const entry of data.methodApplications) requireV3Timestamp(entry.createdAt, '方法应用')
  for (const entry of data.itemStatusEvents) requireV3Timestamp(entry.createdAt, '状态事件')
  for (const entry of data.itemLinks) requireV3Timestamp(entry.createdAt, '想法来源关系')
  for (const entry of data.methodTombstones) requireV3Timestamp(entry.permanentlyDeletedAt, '方法墓碑')

  const trackIds = new Set<string>()
  const normalizedNames = new Set<string>()
  for (const track of data.explorationTracks) {
    if (!track.id.trim() || trackIds.has(track.id)) throw new Error('V3 主线存在空 ID 或重复 ID')
    trackIds.add(track.id)
    if (typeof track.name !== 'string' || typeof track.normalizedName !== 'string') throw new Error('V3 主线存在无效名称')
    const name = track.name.normalize('NFKC').trim()
    if (!name || [...name].length > 80 || name !== track.name || name.toLowerCase() !== track.normalizedName || normalizedNames.has(track.normalizedName)) throw new Error('V3 主线名称或规范名无效')
    normalizedNames.add(track.normalizedName)
    requireV3Timestamp(track.createdAt, '主线'); requireV3Timestamp(track.updatedAt, '主线')
    if (track.deletedAt !== undefined) requireV3Timestamp(track.deletedAt, '主线')
  }
  if (data.items.some(item => item.explorationTrackId !== undefined && !trackIds.has(item.explorationTrackId))) throw new Error('V3 事项引用了不存在的主线')
}

export class BackupApplicationService {
  constructor(private readonly repository: BackupRepository) {}

  async createBackup(): Promise<BackupDocument> {
    const data = await this.repository.exportData()
    return {
      format: 'knowledge-base-backup',
      version: 'explorationTracks' in data ? 3 : 2,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      data,
    } as BackupDocument
  }

  parseAndValidate(input: string): BackupDocument {
    let value: unknown
    try { value = JSON.parse(input) }
    catch { throw new Error('备份文件不是有效的 JSON') }
    if (!isRecord(value) || value.format !== 'knowledge-base-backup') throw new Error('这不是本系统的备份文件')
    if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new Error(`不支持的备份版本：${String(value.version)}`)
    if (!isRecord(value.data)) throw new Error('备份缺少 data 数据区')

    const requiredCollectionNames = ['items', 'reviews', 'methods', 'methodEvidence', 'itemLinks'] as const
    for (const name of requiredCollectionNames) {
      if (!Array.isArray(value.data[name])) throw new Error(`备份缺少 ${name} 数据表`)
      if (value.data[name].some((entry) => !isRecord(entry) || typeof entry.id !== 'string')) {
        throw new Error(`${name} 中存在无效记录`)
      }
    }

    const rawDocument = value as unknown as BackupDocument
    const legacyEvidence = rawDocument.data.methodEvidence
    const rawMethodVersions = Array.isArray(value.data.methodVersions)
      ? value.data.methodVersions as unknown as MethodVersion[]
      : rawDocument.data.methods.map((method) => ({
        id: createId(), methodId: method.id, version: method.version,
        title: method.title, applicable: method.applicable, unsuitable: method.unsuitable, steps: method.steps,
        sourceReviewId: legacyEvidence.find((entry) => entry.methodId === method.id)?.reviewId,
        createdAt: method.createdAt,
      }))
    const reviewIdsForNormalization = new Set(rawDocument.data.reviews.map((review) => review.id))
    const methodVersions: MethodVersion[] = rawMethodVersions.map((version): MethodVersion => {
      if (!version.sourceReviewId || reviewIdsForNormalization.has(version.sourceReviewId)) return version
      const { sourceReviewId: _sourceReviewId, ...normalizedVersion } = version
      return normalizedVersion
    })
    const methodApplications = Array.isArray(value.data.methodApplications)
      ? value.data.methodApplications as unknown as BackupDocument['data']['methodApplications']
      : []
    const itemStatusEvents: ItemStatusEvent[] = Array.isArray(value.data.itemStatusEvents)
      ? value.data.itemStatusEvents as unknown as ItemStatusEvent[]
      : rawDocument.data.items.map((item) => ({
        id: createId(), itemId: item.id, toStatus: item.status, createdAt: item.createdAt,
      }))
    const parsedMethodTombstones = Array.isArray(value.data.methodTombstones)
      ? value.data.methodTombstones as MethodTombstone[]
      : []
    const normalizedData: BackupData = { ...rawDocument.data, methodVersions, methodApplications, itemStatusEvents, methodTombstones: parsedMethodTombstones }
    const document: BackupDocument = value.version === 3
      ? { ...rawDocument, version: 3, data: { ...normalizedData, explorationTracks: value.data.explorationTracks as BackupDataV3['explorationTracks'] } }
      : {
      ...rawDocument,
      version: 2,
      data: { ...normalizedData, items: normalizedData.items.map(({ explorationTrackId: _trackId, ...item }) => item) },
    }
    const { items, reviews, methods, methodEvidence, itemLinks, methodTombstones } = document.data
    requireUniqueIds(items, '事项')
    requireUniqueIds(reviews, '复盘')
    requireUniqueIds(methods, '方法')
    requireUniqueIds(methodEvidence, '方法证据')
    requireUniqueIds(methodVersions, '方法版本')
    requireUniqueIds(methodApplications, '方法应用')
    requireUniqueIds(itemStatusEvents, '状态事件')
    requireUniqueIds(itemLinks, '想法来源关系')
    const tombstoneIds = new Set(methodTombstones.map((entry) => entry.methodId))
    if (methodTombstones.some((entry) => !entry.methodId || !entry.title || !entry.permanentlyDeletedAt || !Array.isArray(entry.versions) || entry.versions.some(({ version }) => !Number.isInteger(version)))) {
      throw new Error('方法墓碑存在无效记录')
    }

    const itemIds = new Set(items.map((item) => item.id))
    const reviewIds = new Set(reviews.map((review) => review.id))
    const methodIds = new Set(methods.map((method) => method.id))
    if ([...methodIds].some((methodId) => tombstoneIds.has(methodId))) throw new Error('方法与墓碑不能同时存在')
    if (items.some((item) => !item.title || !itemStatuses.includes(item.status) || (item.startAction !== undefined && typeof item.startAction !== 'string'))) {
      throw new Error('事项中存在空标题、非法状态或无效启动动作')
    }
    if (reviews.some((review) => !itemIds.has(review.itemId))) throw new Error('复盘引用了不存在的事项')
    if (methodEvidence.some((entry) => !(methodIds.has(entry.methodId) || tombstoneIds.has(entry.methodId)) || !reviewIds.has(entry.reviewId))) {
      throw new Error('方法证据引用了不存在的方法或复盘')
    }
    if (methodVersions.some((entry) => !methodIds.has(entry.methodId) || (entry.sourceReviewId && !reviewIds.has(entry.sourceReviewId)))) {
      throw new Error('方法版本引用了不存在的方法或复盘')
    }
    if (methodApplications.some((entry) => !(methodIds.has(entry.methodId) || tombstoneIds.has(entry.methodId)) || !itemIds.has(entry.itemId))) {
      throw new Error('方法应用引用了不存在的方法或事项')
    }
    if (new Set(methodApplications.map((entry) => entry.itemId)).size !== methodApplications.length) {
      throw new Error('同一事项不能关联多个方法应用')
    }
    if (methodApplications.some((entry) => !(
      methodIds.has(entry.methodId)
        ? methodVersions.some((version) => version.methodId === entry.methodId && version.version === entry.methodVersion)
        : methodTombstones.find((tombstone) => tombstone.methodId === entry.methodId)?.versions.some((version) => version.version === entry.methodVersion)
    ))) {
      throw new Error('方法应用引用了不存在的方法版本')
    }
    if (itemStatusEvents.some((event) => !itemIds.has(event.itemId) || !itemStatuses.includes(event.toStatus) || (event.fromStatus && !itemStatuses.includes(event.fromStatus)))) {
      throw new Error('状态事件引用了不存在的事项或非法状态')
    }
    if (itemLinks.some((link) => !reviewIds.has(link.sourceReviewId) || !itemIds.has(link.targetItemId) || link.type !== 'derived_from_review')) {
      throw new Error('想法来源关系存在无效引用')
    }
    if (document.version === 3) validateV3Data(document.data)
    return document
  }

  restoreBackup(document: BackupDocument): Promise<void> {
    const data = { ...document.data, methodTombstones: document.data.methodTombstones ?? [] }
    return this.repository.replaceData(data)
  }

  async restoreBackupSafely(document: BackupDocument, preserveCurrent: (backup: BackupDocument) => void | Promise<void>): Promise<void> {
    const safetyBackup = await this.createBackup()
    await preserveCurrent(safetyBackup)
    await this.restoreBackup(document)
  }
}

export class ReviewApplicationService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly methodRepository: MethodRepository,
    private readonly workflowRepository: ReviewWorkflowRepository,
  ) {}

  completeReview(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    return this.workflowRepository.complete(input)
  }

  getReview(reviewId: string): Promise<Review | undefined> {
    return this.reviewRepository.getById(reviewId)
  }

  getReviewForItem(itemId: string): Promise<Review | undefined> {
    return this.reviewRepository.getByItemId(itemId)
  }

  listMethods(): Promise<Method[]> {
    return this.methodRepository.list()
  }

  listMethodsFromReview(reviewId: string): Promise<Method[]> {
    return this.methodRepository.listByReviewId(reviewId)
  }

  listMethodVersions(methodId: string): Promise<MethodVersion[]> {
    return this.methodRepository.listVersions(methodId)
  }

  listMethodEvidenceDetails(methodId: string) {
    return this.methodRepository.listEvidenceDetails(methodId)
  }
}

export class DashboardApplicationService {
  constructor(private readonly repository: DashboardRepository) {}

  async getReport(window: DashboardWindow, now = new Date()): Promise<DashboardReport> {
    const snapshot = await this.repository.getSnapshot()
    return buildDashboardReport(snapshot, window, now)
  }
}

function buildDashboardReport(snapshot: DashboardSnapshot, window: DashboardWindow, now: Date): DashboardReport {
  const cutoff = window === 'all' ? undefined : new Date(now.getTime() - (window === '7d' ? 7 : 30) * 86400000).toISOString()
  const inWindow = (createdAt: string) => !cutoff || createdAt >= cutoff
  const activeItems = snapshot.items
  const versionEvidenceIds = new Set(snapshot.methodVersions.map((version) => version.sourceReviewId).filter(Boolean))
  const periodEvidence = snapshot.methodEvidence.filter((entry) => inWindow(entry.createdAt))
  const periodApplications = snapshot.methodApplications.filter((entry) => inWindow(entry.createdAt))
  const periodRevisions = snapshot.methodVersions.filter((version) => version.version > 1 && inWindow(version.createdAt))
  const periodStarts = snapshot.itemStatusEvents.filter((event) => event.fromStatus && event.toStatus === 'doing' && inWindow(event.createdAt))
  const periodItems = activeItems.filter((item) => inWindow(item.createdAt))
  const periodReviews = snapshot.reviews.filter((review) => inWindow(review.createdAt))
  const periodMethods = snapshot.methods.filter((method) => inWindow(method.createdAt))
  const periodValidations = periodEvidence.filter((entry) => !versionEvidenceIds.has(entry.reviewId))
  const metrics = {
    newItems: periodItems.length,
    startedExecutions: periodStarts.length,
    completedReviews: periodReviews.length,
    newMethods: periodMethods.length,
    methodValidations: periodValidations.length,
    methodRevisions: periodRevisions.length,
    methodApplications: periodApplications.length,
  }
  const backlog = {
    ideaToTry: activeItems.filter((item) => item.status === 'idea_to_try').length,
    doing: activeItems.filter((item) => item.status === 'doing').length,
    waitingReview: activeItems.filter((item) => item.status === 'waiting_review').length,
    paused: activeItems.filter((item) => item.status === 'paused').length,
    ideaLater: activeItems.filter((item) => item.status === 'idea_later').length,
  }
  const methodById = new Map(snapshot.methods.map((method) => [method.id, method]))
  const itemById = new Map(activeItems.map((item) => [item.id, item]))
  const reviewById = new Map(snapshot.reviews.map((review) => [review.id, review]))
  const metricRecords = {
    newItems: periodItems.map((item) => ({ id: item.id, title: item.title, detail: `创建时状态：${item.status}`, itemId: item.id })),
    startedExecutions: periodStarts.map((event) => {
      const item = itemById.get(event.itemId)
      return { id: event.id, title: item?.title ?? '已删除事项', detail: `${event.fromStatus} → ${event.toStatus}`, itemId: item?.id }
    }),
    completedReviews: periodReviews.map((review) => {
      const item = itemById.get(review.itemId)
      return { id: review.id, title: item?.title ?? '已删除事项', detail: review.result || '已完成复盘', itemId: item?.id }
    }),
    newMethods: periodMethods.map((method) => ({ id: method.id, title: method.title, detail: `形成 v${method.version}`, methodId: method.id })),
    methodValidations: periodValidations.map((evidence) => {
      const method = methodById.get(evidence.methodId)
      const review = reviewById.get(evidence.reviewId)
      return { id: evidence.id, title: method?.title ?? '已删除方法', detail: '通过复盘完成仅验证', itemId: review?.itemId, methodId: method?.id }
    }),
    methodRevisions: periodRevisions.map((version) => ({ id: version.id, title: version.title, detail: `修订至 v${version.version}`, methodId: version.methodId })),
    methodApplications: periodApplications.map((application) => {
      const method = methodById.get(application.methodId)
      const item = itemById.get(application.itemId)
      return { id: application.id, title: item?.title ?? '已删除事项', detail: `使用“${method?.title ?? '已删除方法'}”v${application.methodVersion}`, itemId: item?.id, methodId: method?.id }
    }),
  }
  const topInsight = (entries: Array<{ methodId: string }>, detail: (count: number) => string) => {
    const counts = new Map<string, number>()
    entries.forEach((entry) => counts.set(entry.methodId, (counts.get(entry.methodId) ?? 0) + 1))
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
    const method = top ? methodById.get(top[0]) : undefined
    return top && method ? { methodId: method.id, title: method.title, count: top[1], detail: detail(top[1]) } : undefined
  }
  const mostValidated = topInsight(periodEvidence, (count) => `窗口内关联 ${count} 条复盘证据`)
  const mostApplied = topInsight(periodApplications, (count) => `窗口内发起 ${count} 次行动`)
  const latestRevision = [...periodRevisions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const revisedMethod = latestRevision ? methodById.get(latestRevision.methodId) : undefined
  const recentlyRevised = latestRevision && revisedMethod
    ? { methodId: revisedMethod.id, title: revisedMethod.title, count: latestRevision.version, detail: `最近修订至 v${latestRevision.version}` }
    : undefined
  const reviewedItemIds = new Set(snapshot.reviews.map((review) => review.itemId))
  const unreviewedMethodActions = snapshot.methodApplications.filter((entry) => !reviewedItemIds.has(entry.itemId)).length
  const label = window === '7d' ? '过去 7 天' : window === '30d' ? '过去 30 天' : '全部时间'
  const facts = [
    `${label}新增 ${metrics.newItems} 条事项，进入执行 ${metrics.startedExecutions} 次，完成 ${metrics.completedReviews} 条复盘。`,
    backlog.waitingReview ? `当前有 ${backlog.waitingReview} 条事项等待复盘。` : '当前没有等待复盘的事项。',
    mostValidated ? `“${mostValidated.title}”在该窗口内证据最多，共 ${mostValidated.count} 条。` : '该窗口内还没有方法验证证据。',
    unreviewedMethodActions ? `有 ${unreviewedMethodActions} 条方法行动尚未完成复盘。` : '所有方法行动都已完成复盘。',
  ]
  return { window, metrics, metricRecords, backlog, mostValidated, mostApplied, recentlyRevised, unreviewedMethodActions, facts }
}

export class SearchApplicationService {
  constructor(private readonly repository: SearchRepository) {}

  search(query: string): Promise<SearchResult[]> {
    const normalized = query.trim()
    return normalized ? this.repository.search(normalized) : Promise.resolve([])
  }
}

export class MethodApplicationService {
  constructor(private readonly repository: MethodApplicationRepository) {}

  createItem(methodId: string, title: string, content?: string): Promise<Item> {
    return this.repository.createItem({ methodId, title, content })
  }

  getContextForItem(itemId: string): Promise<MethodApplicationContext | undefined> {
    return this.repository.getContextByItemId(itemId)
  }

  getContextResultForItem(itemId: string): Promise<MethodApplicationContextResult> {
    return this.repository.getContextResultByItemId(itemId)
  }

  listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]> {
    return this.repository.listSourceDisplaysForItems(itemIds)
  }
}

export class MethodLifecycleApplicationService {
  constructor(private readonly repository: MethodRepository) {}

  moveToTrash(methodId: string): Promise<void> {
    return this.repository.moveToTrash(methodId)
  }

  restore(methodId: string): Promise<Method> {
    return this.repository.restore(methodId)
  }

  async listTrash(): Promise<Method[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    return this.repository.listDeleted()
  }
}

export class TrashApplicationService {
  constructor(private readonly itemRepository: ItemRepository, private readonly methodRepository: MethodRepository) {}

  async listTrashEntries(filter: TrashFilter): Promise<TrashEntry[]> {
    await Promise.all([
      this.itemRepository.purgeDeletedBefore(trashCutoff()),
      this.methodRepository.purgeDeletedBefore(trashCutoff()),
    ])
    if (filter === 'item') return (await this.itemRepository.listDeleted()).map((item) => ({ type: 'item', id: item.id, title: item.title, deletedAt: item.deletedAt! }))
    if (filter === 'method') return (await this.methodRepository.listDeleted()).map((method) => ({ type: 'method', id: method.id, title: method.title, deletedAt: method.deletedAt! }))
    const [items, methods] = await Promise.all([this.itemRepository.listDeleted(), this.methodRepository.listDeleted()])
    return [
      ...items.map((item) => ({ type: 'item' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
      ...methods.map((method) => ({ type: 'method' as const, id: method.id, title: method.title, deletedAt: method.deletedAt! })),
    ].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
  }
}

export class ExplorationTrackApplicationService {
  constructor(
    private readonly repository: ExplorationTrackRepository,
    private readonly workflow: ExplorationTrackWorkflowRepository,
  ) {}

  private normalizeName(value: string): { name: string; normalizedName: string } {
    const name = value.normalize('NFKC').trim()
    const length = [...name].length
    if (length === 0) throw new Error('主线名称不能为空')
    if (length > 80) throw new Error('主线名称最多 80 个字符')
    return { name, normalizedName: name.toLowerCase() }
  }

  private prepareSelection(selection: ExplorationTrackSelection): PreparedExplorationTrackSelection {
    return selection.type === 'new'
      ? { type: 'new', ...this.normalizeName(selection.name) }
      : selection
  }

  createExplorationTrack(name: string): Promise<ExplorationTrack> {
    const createdAt = new Date().toISOString()
    return this.repository.create({ id: createId(), ...this.normalizeName(name), createdAt })
  }

  renameExplorationTrack(id: string, name: string): Promise<ExplorationTrack> {
    return this.repository.rename(id, { ...this.normalizeName(name), updatedAt: new Date().toISOString() })
  }

  deleteExplorationTrack(id: string): Promise<void> { return this.repository.softDelete(id, new Date().toISOString()) }
  restoreExplorationTrack(id: string): Promise<ExplorationTrack> { return this.repository.restore(id, new Date().toISOString()) }
  listActiveExplorationTracks() { return this.repository.listActive() }
  listSelectableExplorationTracks() { return this.repository.listSelectable() }
  listDeletedExplorationTracks() { return this.repository.listDeleted() }
  getExplorationTrackHistory(id: string) { return this.repository.getHistory(id) }
  getItemExplorationTrackContext(itemId: string) { return this.repository.getItemContext(itemId) }
  assignItemToExplorationTrack(itemId: string, trackId: string) { return this.workflow.assignItemToExplorationTrack(itemId, trackId) }
  removeItemFromExplorationTrack(itemId: string) { return this.workflow.removeItemFromExplorationTrack(itemId) }
  listItemsByExplorationTrackAndStatus(trackId: string, status: CurrentAssociatedStatus) { return this.repository.listItemsByTrackAndStatus(trackId, status) }

  createItemWithExplorationTrack(input: CreateItemInput, selection: ExplorationTrackSelection): Promise<Item> {
    const title = input.title.trim()
    if (!title) throw new Error('标题不能为空')
    const prepared = this.prepareSelection(selection)
    return this.workflow.createItemWithExplorationTrack({ ...input, title, id: createId(), createdAt: new Date().toISOString() }, prepared)
  }
}

export class ItemApplicationService {
  constructor(
    private readonly repository: ItemRepository,
    private readonly explorationWorkflow?: ExplorationTrackWorkflowRepository,
  ) {}

  private prepareExplorationTrackSelection(selection: ExplorationTrackSelection): PreparedExplorationTrackSelection {
    if (selection.type === 'existing') return selection
    const name = selection.name.normalize('NFKC').trim()
    const length = [...name].length
    if (length === 0) throw new Error('主线名称不能为空')
    if (length > 80) throw new Error('主线名称最多 80 个字符')
    return { type: 'new', name, normalizedName: name.toLowerCase() }
  }

  createIdea(input: CaptureIdeaInput): Promise<Item> {
    const enteredTitle = input.title?.trim() ?? ''
    const enteredContent = input.content?.trim() ?? ''
    const title = enteredTitle || enteredContent.split(/\r?\n/, 1)[0]?.slice(0, 120) || ''
    const capture = { title, content: enteredTitle ? enteredContent : '', status: input.saveForLater ? 'idea_later' as const : 'idea_to_try' as const }
    if (!input.explorationTrack) return this.repository.create(capture)
    if (!this.explorationWorkflow) throw new Error('探索主线工作流不可用')
    return this.explorationWorkflow.createItemWithExplorationTrack({ ...capture, id: createId(), createdAt: new Date().toISOString() }, this.prepareExplorationTrackSelection(input.explorationTrack))
  }

  async listItems(): Promise<Item[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    const items = await this.repository.list()
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async listTrash(): Promise<Item[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    const items = await this.repository.listDeleted()
    return items.sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''))
  }

  async listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> {
    const item = await this.repository.getById(itemId)
    if (!item) throw new Error('事项不存在')
    return this.repository.listStatusEvents(itemId)
  }

  async getItem(id: string): Promise<Item> {
    const item = await this.repository.getById(id)
    if (!item || item.deletedAt) throw new Error('事项不存在')
    return item
  }

  startExecution(id: string, startAction?: string): Promise<Item> {
    return this.repository.startExecution(id, startAction?.trim() ? { startAction } : undefined)
  }

  updateItemContent(id: string, content: string): Promise<Item> {
    return this.repository.updateContent(id, { content })
  }

  changeStatus(id: string, status: ItemStatus): Promise<Item> {
    return this.repository.changeStatus(id, status)
  }

  deleteItem(id: string): Promise<void> {
    return this.repository.delete(id)
  }

  restoreItem(id: string): Promise<Item> {
    return this.repository.restore(id)
  }

  actionsFor(item: Item): readonly ItemAction[] {
    const legalStatuses = allowedTransitions(item.status)
    return (statusActions[item.status] ?? []).filter((action) => legalStatuses.includes(action.status))
  }
}
