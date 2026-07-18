import type { ItemStatus } from '@knowledge-base/contracts'

const transitions: Record<ItemStatus, readonly ItemStatus[]> = {
  idea_to_try: ['idea_later', 'doing', 'abandoned'],
  idea_later: ['idea_to_try', 'abandoned'],
  doing: ['paused', 'waiting_review', 'archived_no_review', 'abandoned'],
  paused: ['doing', 'abandoned'],
  waiting_review: ['reviewed', 'doing'],
  reviewed: [],
  archived_no_review: [],
  abandoned: ['idea_to_try'],
}

export function allowedTransitions(status: ItemStatus): readonly ItemStatus[] {
  return transitions[status]
}

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return transitions[from].includes(to)
}

export function assertTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`不允许从 ${from} 变更为 ${to}`)
  }
}
