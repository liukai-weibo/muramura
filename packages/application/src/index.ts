import type { Item, ItemRepository, ItemStatus } from '@knowledge-base/contracts'
import { allowedTransitions } from '@knowledge-base/domain'

export interface CaptureIdeaInput {
  title?: string
  content?: string
  saveForLater?: boolean
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
    { label: '执行完成', status: 'waiting_review', tone: 'primary' },
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

export class ItemApplicationService {
  constructor(private readonly repository: ItemRepository) {}

  createIdea(input: CaptureIdeaInput): Promise<Item> {
    const enteredTitle = input.title?.trim() ?? ''
    const enteredContent = input.content?.trim() ?? ''
    const title = enteredTitle || enteredContent.split(/\r?\n/, 1)[0]?.slice(0, 120) || ''

    return this.repository.create({
      title,
      content: enteredTitle ? enteredContent : '',
      status: input.saveForLater ? 'idea_later' : 'idea_to_try',
    })
  }

  async listItems(): Promise<Item[]> {
    const items = await this.repository.list()
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getItem(id: string): Promise<Item> {
    const item = await this.repository.getById(id)
    if (!item || item.deletedAt) throw new Error('事项不存在')
    return item
  }

  changeStatus(id: string, status: ItemStatus): Promise<Item> {
    return this.repository.changeStatus(id, status)
  }

  deleteItem(id: string): Promise<void> {
    return this.repository.delete(id)
  }

  actionsFor(item: Item): readonly ItemAction[] {
    const legalStatuses = allowedTransitions(item.status)
    return (statusActions[item.status] ?? []).filter((action) => legalStatuses.includes(action.status))
  }
}
