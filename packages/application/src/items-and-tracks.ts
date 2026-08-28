import type {
  ActivityAuditRecorder,
  CreateItemInput,
  CurrentAssociatedStatus,
  ExplorationTrack,
  ExplorationTrackRepository,
  ExplorationTrackSelection,
  ExplorationTrackWorkflowRepository,
  Item,
  ItemRepository,
  ItemStatus,
  ItemStatusEvent,
  PreparedExplorationTrackSelection,
} from '@knowledge-base/contracts'
import {
  allowedTransitions,
  assertItemTitleLength,
  BusinessError,
  createId,
  normalizeExplorationTrackName,
  normalizeItemTitle,
} from '@knowledge-base/domain'
import { trashCutoff } from './trash'
import { safeAuditRecord } from './audit'

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

function prepareExplorationTrackSelection(selection: ExplorationTrackSelection): PreparedExplorationTrackSelection {
  return selection.type === 'new'
    ? { type: 'new', ...normalizeExplorationTrackName(selection.name) }
    : selection
}

export class ExplorationTrackApplicationService {
  constructor(
    private readonly repository: ExplorationTrackRepository,
    private readonly workflow: ExplorationTrackWorkflowRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  async createExplorationTrack(name: string): Promise<ExplorationTrack> {
    const createdAt = new Date().toISOString()
    const created = await this.repository.create({ id: createId(), ...normalizeExplorationTrackName(name), createdAt })
    await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'create', entityId: created.id, snapshot: JSON.stringify({ name: created.name }) })
    return created
  }

  async renameExplorationTrack(id: string, name: string): Promise<ExplorationTrack> {
    const renamed = await this.repository.rename(id, { ...normalizeExplorationTrackName(name), updatedAt: new Date().toISOString() })
    await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'update', entityId: renamed.id, snapshot: JSON.stringify({ name: renamed.name }) })
    return renamed
  }

  async updateExplorationTrackDescription(id: string, description: string): Promise<ExplorationTrack> {
    if (!this.repository.updateDescription) throw new BusinessError('EXPLORATION_TRACK_NOT_FOUND', '长期探索描述暂不可更新')
    const updated = await this.repository.updateDescription(id, { description, updatedAt: new Date().toISOString() })
    await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ description: updated.description }) })
    return updated
  }

  async deleteExplorationTrack(id: string): Promise<void> {
    const before = await this.repository.getById(id)
    await this.repository.softDelete(id, new Date().toISOString())
    if (before) await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'delete', entityId: before.id, snapshot: JSON.stringify({ name: before.name }) })
  }

  async restoreExplorationTrack(id: string): Promise<ExplorationTrack> {
    const restored = await this.repository.restore(id, new Date().toISOString())
    await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'restore', entityId: restored.id, snapshot: JSON.stringify({ name: restored.name }) })
    return restored
  }

  async archiveExplorationTrack(id: string): Promise<void> {
    const before = await this.repository.getById(id)
    await this.repository.archive(id, new Date().toISOString())
    if (before) await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'archive', entityId: before.id, snapshot: JSON.stringify({ name: before.name }) })
  }

  async restoreExplorationTrackFromArchive(id: string): Promise<ExplorationTrack> {
    const restored = await this.repository.restoreFromArchive(id, new Date().toISOString())
    await safeAuditRecord(this.auditRecorder, { module: 'exploration_track', action: 'restore', entityId: restored.id, snapshot: JSON.stringify({ name: restored.name }) })
    return restored
  }

  listActiveExplorationTracks() { return this.repository.listActive() }
  listArchivedExplorationTracks() { return this.repository.listArchived() }
  listSelectableExplorationTracks() { return this.repository.listSelectable() }
  listDeletedExplorationTracks() { return this.repository.listDeleted() }
  getExplorationTrackHistory(id: string) { return this.repository.getHistory(id) }
  getItemExplorationTrackContext(itemId: string) { return this.repository.getItemContext(itemId) }
  async assignItemToExplorationTrack(itemId: string, trackId: string) {
    const result = await this.workflow.assignItemToExplorationTrack(itemId, trackId)
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'assign', entityId: itemId, snapshot: JSON.stringify({ itemId, trackId }) })
    return result
  }
  async removeItemFromExplorationTrack(itemId: string) {
    const before = await this.repository.getItemContext(itemId)
    await this.workflow.removeItemFromExplorationTrack(itemId)
    const removedTrackId = before && 'track' in before ? before.track.id : undefined
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'remove', entityId: itemId, snapshot: JSON.stringify({ itemId, ...(removedTrackId ? { removedTrackId } : {}) }) })
  }
  listItemsByExplorationTrackAndStatus(trackId: string, status: CurrentAssociatedStatus) { return this.repository.listItemsByTrackAndStatus(trackId, status) }

  createItemWithExplorationTrack(input: CreateItemInput, selection: ExplorationTrackSelection): Promise<Item> {
    const title = normalizeItemTitle(input.title)
    if (!title) throw new BusinessError('ITEM_TITLE_REQUIRED', '标题不能为空')
    assertItemTitleLength(title)
    const prepared = prepareExplorationTrackSelection(selection)
    return this.workflow.createItemWithExplorationTrack({ ...input, title, id: createId(), createdAt: new Date().toISOString() }, prepared)
  }
}

export class ItemApplicationService {
  constructor(
    private readonly repository: ItemRepository,
    private readonly explorationWorkflow?: ExplorationTrackWorkflowRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
    private readonly archivedExplorationIds?: () => Promise<ReadonlySet<string>>,
  ) {}

  async createIdea(input: CaptureIdeaInput): Promise<Item> {
    const enteredTitle = normalizeItemTitle(input.title ?? '')
    const enteredContent = input.content?.trim() ?? ''
    const title = normalizeItemTitle(enteredTitle || enteredContent.split(/\r?\n/, 1)[0] || '')
    assertItemTitleLength(title)
    // New captures are immediately actionable; saveForLater remains accepted for old clients only.
    const capture = { title, content: enteredTitle ? enteredContent : '', status: 'doing' as const }
    let created: Item
    if (!input.explorationTrack) {
      created = await this.repository.create(capture)
    } else {
      if (!this.explorationWorkflow) throw new BusinessError('EXPLORATION_TRACK_WORKFLOW_UNAVAILABLE', '探索主线工作流不可用')
      created = await this.explorationWorkflow.createItemWithExplorationTrack({ ...capture, id: createId(), createdAt: new Date().toISOString() }, prepareExplorationTrackSelection(input.explorationTrack))
    }
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'create', entityId: created.id, snapshot: JSON.stringify({ title: created.title, content: created.content }) })
    return created
  }

  async listItems(): Promise<Item[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    let items = await this.repository.list()
    if (this.archivedExplorationIds) {
      const archivedIds = await this.archivedExplorationIds()
      if (archivedIds.size > 0) {
        items = items.filter((item) => !item.explorationTrackId || !archivedIds.has(item.explorationTrackId))
      }
    }
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async listTrash(): Promise<Item[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    const items = await this.repository.listDeleted()
    return items.sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''))
  }

  async listStatusEvents(itemId: string): Promise<ItemStatusEvent[]> {
    const item = await this.repository.getById(itemId)
    if (!item) throw new BusinessError('ITEM_NOT_FOUND', '事项不存在')
    return this.repository.listStatusEvents(itemId)
  }

  async getItem(id: string): Promise<Item> {
    const item = await this.repository.getById(id)
    if (!item || item.deletedAt) throw new BusinessError('ITEM_NOT_FOUND', '事项不存在')
    return item
  }

  startExecution(id: string, startAction?: string, overwriteExistingStartAction?: boolean): Promise<Item> {
    throw new BusinessError('INVALID_ITEM_STATUS_TRANSITION', '事项创建后即为进行中，无需单独开始执行')
  }

  async updateItemContent(id: string, content: string): Promise<Item> {
    const updated = await this.repository.updateContent(id, { content })
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ title: updated.title, content: updated.content }) })
    return updated
  }

  async changeStatus(id: string, status: ItemStatus): Promise<Item> {
    const updated = await this.repository.changeStatus(id, status)
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ status: updated.status }) })
    return updated
  }

  async deleteItem(id: string): Promise<void> {
    const before = await this.repository.getById(id)
    await this.repository.delete(id)
    if (before) {
      await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'delete', entityId: before.id, snapshot: JSON.stringify({ title: before.title, content: before.content }) })
    }
  }

  async restoreItem(id: string): Promise<Item> {
    const restored = await this.repository.restore(id)
    await safeAuditRecord(this.auditRecorder, { module: 'item', action: 'update', entityId: restored.id, snapshot: JSON.stringify({ title: restored.title }) })
    return restored
  }

  actionsFor(item: Item): readonly ItemAction[] {
    const legalStatuses = allowedTransitions(item.status)
    return (statusActions[item.status] ?? []).filter((action) => legalStatuses.includes(action.status))
  }
}
