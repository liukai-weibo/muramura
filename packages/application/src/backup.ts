import {
  itemStatuses,
  type BackupData,
  type BackupDataV3,
  type BackupDataV4,
  type BackupDataV5,
  type BackupDataV6,
  type BackupDocument,
  type BackupRepository,
  type ItemStatusEvent,
  type MethodTombstone,
  type MethodVersion,
  type AiConversationBackupStore,
  type AiPreferenceBackupStore,
  type DailyNoteBackupStore,
  type MoodEntryBackupStore,
} from '@knowledge-base/contracts'
import { BusinessError, createId } from '@knowledge-base/domain'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidBackup(message: string): BusinessError {
  return new BusinessError('INVALID_BACKUP', message)
}

function requireUniqueIds(entries: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw invalidBackup(`${label}存在空 ID 或重复 ID`)
    ids.add(entry.id)
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function requireV3Timestamp(value: unknown, label: string): void {
  if (!isTimestamp(value)) throw invalidBackup(`V3 ${label}存在无效时间`)
}

/** V3 在 Repository 开始事务前完成整份文档校验，避免部分写入。 */
function validateV3Data(data: BackupDataV3): void {
  const collections: Array<[string, unknown[]]> = [
    ['items', data.items], ['reviews', data.reviews], ['methods', data.methods],
    ['methodEvidence', data.methodEvidence], ['methodVersions', data.methodVersions],
    ['methodApplications', data.methodApplications], ['itemStatusEvents', data.itemStatusEvents],
    ['itemLinks', data.itemLinks], ['methodTombstones', data.methodTombstones], ['explorationTracks', data.explorationTracks],
  ]
  for (const [name, entries] of collections) {
    if (!Array.isArray(entries)) throw invalidBackup(`V3 备份缺少 ${name} 数据表`)
    for (const entry of entries) {
      if (!isRecord(entry)) throw invalidBackup(`V3 ${name}中存在无效记录`)
      if (name !== 'methodTombstones' && (typeof entry.id !== 'string' || !entry.id.trim())) throw invalidBackup(`V3 ${name}中存在无效 ID`)
    }
  }
  for (const item of data.items) {
    requireV3Timestamp(item.createdAt, '事项'); requireV3Timestamp(item.updatedAt, '事项')
    if (item.deletedAt !== undefined) requireV3Timestamp(item.deletedAt, '事项')
    if (item.explorationTrackId !== undefined && (typeof item.explorationTrackId !== 'string' || !item.explorationTrackId.trim())) throw invalidBackup('V3 事项存在无效主线引用')
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
    if (!track.id.trim() || trackIds.has(track.id)) throw invalidBackup('V3 主线存在空 ID 或重复 ID')
    trackIds.add(track.id)
    if (typeof track.name !== 'string' || typeof track.normalizedName !== 'string') throw invalidBackup('V3 主线存在无效名称')
    const name = track.name.normalize('NFKC').trim()
    if (!name || [...name].length > 80 || name !== track.name || name.toLowerCase() !== track.normalizedName || normalizedNames.has(track.normalizedName)) throw invalidBackup('V3 主线名称或规范名无效')
    normalizedNames.add(track.normalizedName)
    requireV3Timestamp(track.createdAt, '主线'); requireV3Timestamp(track.updatedAt, '主线')
    if (track.deletedAt !== undefined) requireV3Timestamp(track.deletedAt, '主线')
  }
  if (data.items.some(item => item.explorationTrackId !== undefined && !trackIds.has(item.explorationTrackId))) throw invalidBackup('V3 事项引用了不存在的主线')
}

/**
 * 将 JSON 解析、旧版本补齐和整份引用校验作为确定性规则执行。
 * `newId` 显式注入后可在测试中固定旧备份补齐结果。
 */
export function parseAndValidateBackup(input: string, newId: () => string = createId): BackupDocument {
  let value: unknown
  try { value = JSON.parse(input) }
  catch { throw invalidBackup('备份文件不是有效的 JSON') }
  if (!isRecord(value) || value.format !== 'knowledge-base-backup') throw invalidBackup('这不是本系统的备份文件')
  if (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6) throw invalidBackup(`不支持的备份版本：${String(value.version)}`)
  if (!isRecord(value.data)) throw invalidBackup('备份缺少 data 数据区')

  const requiredCollectionNames = ['items', 'reviews', 'methods', 'methodEvidence', 'itemLinks'] as const
  for (const name of requiredCollectionNames) {
    if (!Array.isArray(value.data[name])) throw invalidBackup(`备份缺少 ${name} 数据表`)
    if (value.data[name].some((entry) => !isRecord(entry) || typeof entry.id !== 'string')) {
      throw invalidBackup(`${name} 中存在无效记录`)
    }
  }

  const rawDocument = value as unknown as BackupDocument
  const legacyEvidence = rawDocument.data.methodEvidence
  const rawMethodVersions = Array.isArray(value.data.methodVersions)
    ? value.data.methodVersions as unknown as MethodVersion[]
    : rawDocument.data.methods.map((method) => ({
      id: newId(), methodId: method.id, version: method.version,
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
      id: newId(), itemId: item.id, toStatus: item.status, createdAt: item.createdAt,
    }))
  const parsedMethodTombstones = Array.isArray(value.data.methodTombstones)
    ? value.data.methodTombstones as MethodTombstone[]
    : []
  const normalizedData: BackupData = { ...rawDocument.data, methodVersions, methodApplications, itemStatusEvents, methodTombstones: parsedMethodTombstones }
  const document: BackupDocument = value.version === 6
    ? { ...rawDocument, version: 6, data: { ...normalizedData, explorationTracks: value.data.explorationTracks as BackupDataV3['explorationTracks'], dailyNotes: Array.isArray(value.data.dailyNotes) ? value.data.dailyNotes as BackupDataV6['dailyNotes'] : [], moodEntries: Array.isArray(value.data.moodEntries) ? value.data.moodEntries as BackupDataV6['moodEntries'] : [] } }
    : value.version === 5
    ? { ...rawDocument, version: 5, data: { ...normalizedData, explorationTracks: value.data.explorationTracks as BackupDataV3['explorationTracks'], dailyNotes: Array.isArray(value.data.dailyNotes) ? value.data.dailyNotes as BackupDataV5['dailyNotes'] : [] } }
    : value.version === 4
    ? { ...rawDocument, version: 4, data: { ...normalizedData, explorationTracks: value.data.explorationTracks as BackupDataV3['explorationTracks'], dailyNotes: Array.isArray(value.data.dailyNotes) ? (value.data.dailyNotes as BackupDataV4['dailyNotes']).map(note => ({ ...note, aiConversationId: undefined })) : [] } }
    : value.version === 3
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
    throw invalidBackup('方法墓碑存在无效记录')
  }

  const itemIds = new Set(items.map((item) => item.id))
  const reviewIds = new Set(reviews.map((review) => review.id))
  const methodIds = new Set(methods.map((method) => method.id))
  if ([...methodIds].some((methodId) => tombstoneIds.has(methodId))) throw invalidBackup('方法与墓碑不能同时存在')
  if (items.some((item) => !item.title || !itemStatuses.includes(item.status) || (item.startAction !== undefined && typeof item.startAction !== 'string'))) {
    throw invalidBackup('事项中存在空标题、非法状态或无效启动动作')
  }
  if (reviews.some((review) => !itemIds.has(review.itemId))) throw invalidBackup('复盘引用了不存在的事项')
  if (methodEvidence.some((entry) => !(methodIds.has(entry.methodId) || tombstoneIds.has(entry.methodId)) || !reviewIds.has(entry.reviewId))) {
    throw invalidBackup('方法证据引用了不存在的方法或复盘')
  }
  if (methodVersions.some((entry) => !methodIds.has(entry.methodId) || (entry.sourceReviewId && !reviewIds.has(entry.sourceReviewId)))) {
    throw invalidBackup('方法版本引用了不存在的方法或复盘')
  }
  if (methodApplications.some((entry) => !(methodIds.has(entry.methodId) || tombstoneIds.has(entry.methodId)) || !itemIds.has(entry.itemId))) {
    throw invalidBackup('方法应用引用了不存在的方法或事项')
  }
  if (new Set(methodApplications.map((entry) => entry.itemId)).size !== methodApplications.length) {
    throw invalidBackup('同一事项不能关联多个方法应用')
  }
  if (methodApplications.some((entry) => !(
    methodIds.has(entry.methodId)
      ? methodVersions.some((version) => version.methodId === entry.methodId && version.version === entry.methodVersion)
      : methodTombstones.find((tombstone) => tombstone.methodId === entry.methodId)?.versions.some((version) => version.version === entry.methodVersion)
  ))) {
    throw invalidBackup('方法应用引用了不存在的方法版本')
  }
  if (itemStatusEvents.some((event) => !itemIds.has(event.itemId) || !itemStatuses.includes(event.toStatus) || (event.fromStatus && !itemStatuses.includes(event.fromStatus)))) {
    throw invalidBackup('状态事件引用了不存在的事项或非法状态')
  }
  if (itemLinks.some((link) => !reviewIds.has(link.sourceReviewId) || !itemIds.has(link.targetItemId) || link.type !== 'derived_from_review')) {
    throw invalidBackup('想法来源关系存在无效引用')
  }
  if (document.version === 3 || document.version === 4 || document.version === 5 || document.version === 6) validateV3Data(document.data)
  if ((document.version === 4 || document.version === 5) && document.data.dailyNotes.some(note => !note.id || !/^\d{4}-\d{2}-\d{2}$/.test(note.entryDate) || typeof note.content !== 'string' || !isTimestamp(note.createdAt) || !isTimestamp(note.updatedAt) || (note.aiConversationId !== undefined && !note.aiConversationId))) throw invalidBackup('日记存在无效记录')
  if (document.version === 6 && document.data.moodEntries.some(entry => !entry.id || typeof entry.content !== 'string' || typeof entry.entryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.entryDate) || typeof entry.moodLevel !== 'number' || entry.moodLevel < 1 || entry.moodLevel > 5 || !isTimestamp(entry.createdAt) || !isTimestamp(entry.updatedAt))) throw invalidBackup('情绪记录存在无效记录')
  if (document.version === 5) {
    const conversationIds = new Set((document.data.aiConversations ?? []).map(entry => entry.conversation.id))
    document.data.dailyNotes = document.data.dailyNotes.map(note => note.aiConversationId && !conversationIds.has(note.aiConversationId) ? { ...note, aiConversationId: undefined } : note)
  }
  return document
}

export class BackupApplicationService {
  constructor(private readonly repository: BackupRepository, private readonly aiConversations?: AiConversationBackupStore, private readonly aiPreferences?: AiPreferenceBackupStore, private readonly dailyNotes?: DailyNoteBackupStore, private readonly moodEntries?: MoodEntryBackupStore) {}

  async createBackup(): Promise<BackupDocument> {
    const data = await this.repository.exportData()
    if (this.aiConversations) data.aiConversations = await this.aiConversations.exportBackup()
    if (this.aiPreferences) data.aiPreferences = await this.aiPreferences.exportBackup()
    if (this.dailyNotes && 'explorationTracks' in data) (data as BackupDataV5).dailyNotes = await this.dailyNotes.exportBackup()
    if (this.moodEntries && 'explorationTracks' in data) (data as BackupDataV6).moodEntries = await this.moodEntries.exportBackup()
    return {
      format: 'knowledge-base-backup',
      version: 'moodEntries' in data ? 6 : 'dailyNotes' in data ? 5 : 'explorationTracks' in data ? 3 : 2,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      data,
    } as BackupDocument
  }

  parseAndValidate(input: string): BackupDocument {
    return parseAndValidateBackup(input)
  }

  async restoreBackup(document: BackupDocument): Promise<void> {
    const data = { ...document.data, methodTombstones: document.data.methodTombstones ?? [] }
    await this.repository.replaceData(data)
    if (this.aiConversations && data.aiConversations) await this.aiConversations.replaceBackup(data.aiConversations)
    if (this.aiPreferences && data.aiPreferences) await this.aiPreferences.replaceBackup(data.aiPreferences)
    if (this.dailyNotes) await this.dailyNotes.replaceBackup(document.version === 4 || document.version === 5 || document.version === 6 ? document.data.dailyNotes : [])
    if (this.moodEntries) await this.moodEntries.replaceBackup(document.version === 6 ? document.data.moodEntries : [])
  }

  async restoreBackupSafely(document: BackupDocument, preserveCurrent: (backup: BackupDocument) => void | Promise<void>): Promise<void> {
    const safetyBackup = await this.createBackup()
    await preserveCurrent(safetyBackup)
    await this.restoreBackup(document)
  }
}
