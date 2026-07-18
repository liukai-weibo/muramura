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
}

export interface CreateItemInput {
  title: string
  content?: string
  status?: ItemStatus
}

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
}

export interface CreateMethodInput {
  title: string
  applicable: string
  unsuitable?: string
  steps: string
}

export interface MethodEvidence {
  id: string
  methodId: string
  reviewId: string
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

export interface ItemRepository {
  create(input: CreateItemInput): Promise<Item>
  getById(id: string): Promise<Item | undefined>
  list(): Promise<Item[]>
  listDeleted(): Promise<Item[]>
  changeStatus(id: string, status: ItemStatus): Promise<Item>
  delete(id: string): Promise<void>
  restore(id: string): Promise<Item>
  purgeDeletedBefore(cutoff: string): Promise<void>
}

export interface ReviewRepository {
  create(input: CreateReviewInput): Promise<Review>
  getByItemId(itemId: string): Promise<Review | undefined>
  delete(id: string): Promise<void>
}

export interface MethodRepository {
  createFromReview(input: CreateMethodInput, reviewId: string): Promise<Method>
  list(): Promise<Method[]>
  listByReviewId(reviewId: string): Promise<Method[]>
}

export interface CompleteReviewInput extends CreateReviewInput {
  method?: CreateMethodInput
}

export interface CompleteReviewResult {
  item: Item
  review: Review
  method?: Method
  createdIdea?: Item
}

export interface ReviewWorkflowRepository {
  complete(input: CompleteReviewInput): Promise<CompleteReviewResult>
}
