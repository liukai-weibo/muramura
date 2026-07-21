import type { Item } from '@knowledge-base/contracts'

export function mergeUpdatedItemContent(current: Item, updated: Item): Item {
  return {
    ...current,
    content: updated.content,
    updatedAt: current.updatedAt > updated.updatedAt ? current.updatedAt : updated.updatedAt,
  }
}

export function mergeUpdatedItemContentIntoList(items: Item[], updated: Item): Item[] {
  return items
    .map((item) => item.id === updated.id ? mergeUpdatedItemContent(item, updated) : item)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}
