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

export interface ItemRepository {
  create(input: CreateItemInput): Promise<Item>
  getById(id: string): Promise<Item | undefined>
  list(): Promise<Item[]>
  changeStatus(id: string, status: ItemStatus): Promise<Item>
  delete(id: string): Promise<void>
}
