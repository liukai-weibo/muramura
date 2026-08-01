import type { Item, ItemStatus } from './items-and-tracks'

/**
 * 复盘与方法契约。
 *
 * 完成复盘可以形成、验证或修订方法，并同时产生方法版本与证据；这些名词属于
 * 同一知识沉淀闭环，集中放置比按数据表逐个拆分更容易审查完整业务关系。
 */

// --- Review / 复盘 ---

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

// --- Method / 方法、版本与应用 ---

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

/**
 * 方法来源的删除与不可用事实必须保持可区分，不能由消费者合并成“无关联”。
 */
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

// --- Evidence and tombstones / 方法证据与永久删除事实 ---

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

export interface MethodTombstoneVersion {
  version: number
}

export interface MethodTombstone {
  methodId: string
  title: string
  permanentlyDeletedAt: string
  versions: MethodTombstoneVersion[]
}

// --- Repository ports / 存储与复盘工作流端口 ---

export interface MethodApplicationRepository {
  createItem(input: CreateMethodApplicationInput): Promise<Item>
  getContextByItemId(itemId: string): Promise<MethodApplicationContext | undefined>
  getContextResultByItemId(itemId: string): Promise<MethodApplicationContextResult>
  listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]>
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

/** `complete` 的多集合写入由具体 Repository 在单一事务中保证全有或全无。 */
export interface ReviewWorkflowRepository {
  complete(input: CompleteReviewInput): Promise<CompleteReviewResult>
}
