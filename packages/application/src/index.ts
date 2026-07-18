import type {
  BackupDocument,
  BackupRepository,
  CompleteReviewInput,
  CompleteReviewResult,
  Item,
  ItemRepository,
  ItemStatus,
  Method,
  MethodRepository,
  MethodVersion,
  Review,
  ReviewRepository,
  ReviewWorkflowRepository,
} from '@knowledge-base/contracts'
import { allowedTransitions } from '@knowledge-base/domain'
import { itemStatuses } from '@knowledge-base/contracts'

export const TRASH_RETENTION_DAYS = 30

function trashCutoff(now = new Date()): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

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

export class BackupApplicationService {
  constructor(private readonly repository: BackupRepository) {}

  async createBackup(): Promise<BackupDocument> {
    return {
      format: 'knowledge-base-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      data: await this.repository.exportData(),
    }
  }

  parseAndValidate(input: string): BackupDocument {
    let value: unknown
    try { value = JSON.parse(input) }
    catch { throw new Error('备份文件不是有效的 JSON') }
    if (!isRecord(value) || value.format !== 'knowledge-base-backup') throw new Error('这不是本系统的备份文件')
    if (value.version !== 1) throw new Error(`不支持的备份版本：${String(value.version)}`)
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
    const methodVersions = Array.isArray(value.data.methodVersions)
      ? value.data.methodVersions as unknown as MethodVersion[]
      : rawDocument.data.methods.map((method) => ({
        id: crypto.randomUUID(), methodId: method.id, version: method.version,
        title: method.title, applicable: method.applicable, unsuitable: method.unsuitable, steps: method.steps,
        sourceReviewId: legacyEvidence.find((entry) => entry.methodId === method.id)?.reviewId,
        createdAt: method.createdAt,
      }))
    const document: BackupDocument = { ...rawDocument, data: { ...rawDocument.data, methodVersions } }
    const { items, reviews, methods, methodEvidence, itemLinks } = document.data
    requireUniqueIds(items, '事项')
    requireUniqueIds(reviews, '复盘')
    requireUniqueIds(methods, '方法')
    requireUniqueIds(methodEvidence, '方法证据')
    requireUniqueIds(methodVersions, '方法版本')
    requireUniqueIds(itemLinks, '想法来源关系')

    const itemIds = new Set(items.map((item) => item.id))
    const reviewIds = new Set(reviews.map((review) => review.id))
    const methodIds = new Set(methods.map((method) => method.id))
    if (items.some((item) => !item.title || !itemStatuses.includes(item.status))) throw new Error('事项中存在空标题或非法状态')
    if (reviews.some((review) => !itemIds.has(review.itemId))) throw new Error('复盘引用了不存在的事项')
    if (methodEvidence.some((entry) => !methodIds.has(entry.methodId) || !reviewIds.has(entry.reviewId))) {
      throw new Error('方法证据引用了不存在的方法或复盘')
    }
    if (methodVersions.some((entry) => !methodIds.has(entry.methodId) || (entry.sourceReviewId && !reviewIds.has(entry.sourceReviewId)))) {
      throw new Error('方法版本引用了不存在的方法或复盘')
    }
    if (itemLinks.some((link) => !reviewIds.has(link.sourceReviewId) || !itemIds.has(link.targetItemId) || link.type !== 'derived_from_review')) {
      throw new Error('想法来源关系存在无效引用')
    }
    return document
  }

  restoreBackup(document: BackupDocument): Promise<void> {
    return this.repository.replaceData(document.data)
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
    await this.repository.purgeDeletedBefore(trashCutoff())
    const items = await this.repository.list()
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async listTrash(): Promise<Item[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    const items = await this.repository.listDeleted()
    return items.sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''))
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

  restoreItem(id: string): Promise<Item> {
    return this.repository.restore(id)
  }

  actionsFor(item: Item): readonly ItemAction[] {
    const legalStatuses = allowedTransitions(item.status)
    return (statusActions[item.status] ?? []).filter((action) => legalStatuses.includes(action.status))
  }
}
