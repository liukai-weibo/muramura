import type {
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
  ) {}

  createExplorationTrack(name: string): Promise<ExplorationTrack> {
    const createdAt = new Date().toISOString()
    return this.repository.create({ id: createId(), ...normalizeExplorationTrackName(name), createdAt })
  }

  renameExplorationTrack(id: string, name: string): Promise<ExplorationTrack> {
    return this.repository.rename(id, { ...normalizeExplorationTrackName(name), updatedAt: new Date().toISOString() })
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
  ) {}

  createIdea(input: CaptureIdeaInput): Promise<Item> {
    const enteredTitle = normalizeItemTitle(input.title ?? '')
    const enteredContent = input.content?.trim() ?? ''
    const title = normalizeItemTitle(enteredTitle || enteredContent.split(/\r?\n/, 1)[0] || '')
    assertItemTitleLength(title)
    const capture = { title, content: enteredTitle ? enteredContent : '', status: input.saveForLater ? 'idea_later' as const : 'idea_to_try' as const }
    if (!input.explorationTrack) return this.repository.create(capture)
    if (!this.explorationWorkflow) throw new BusinessError('EXPLORATION_TRACK_WORKFLOW_UNAVAILABLE', '探索主线工作流不可用')
    return this.explorationWorkflow.createItemWithExplorationTrack({ ...capture, id: createId(), createdAt: new Date().toISOString() }, prepareExplorationTrackSelection(input.explorationTrack))
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
    if (!item) throw new BusinessError('ITEM_NOT_FOUND', '事项不存在')
    return this.repository.listStatusEvents(itemId)
  }

  async getItem(id: string): Promise<Item> {
    const item = await this.repository.getById(id)
    if (!item || item.deletedAt) throw new BusinessError('ITEM_NOT_FOUND', '事项不存在')
    return item
  }

  startExecution(id: string, startAction?: string, overwriteExistingStartAction?: boolean): Promise<Item> {
    return this.repository.startExecution(id, startAction?.trim() ? { startAction, overwriteExistingStartAction } : undefined)
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
