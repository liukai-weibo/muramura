import type { Item } from '@knowledge-base/contracts'
import type { ItemAction } from '@knowledge-base/application'

export function shouldInterceptStartAction(item: Item, action: ItemAction): boolean {
  return !item.deletedAt && item.status === 'idea_to_try' && action.status === 'doing'
}

export function canOpenStartConfirm(item: Item | undefined): item is Item {
  return Boolean(item && !item.deletedAt && item.status === 'idea_to_try')
}

export type DoingActionContextLayout = 'hidden' | 'content' | 'start-action' | 'both' | 'editing'

export function getDoingActionContextLayout(item: Item, editingContent: boolean): DoingActionContextLayout {
  if (item.status !== 'doing' || item.deletedAt) return 'hidden'
  const hasContent = Boolean(item.content.trim())
  const hasStartAction = Boolean(item.startAction?.trim())
  if (editingContent && hasStartAction) return 'editing'
  if (hasStartAction) return 'both'
  return 'content'
}

export function shouldDisplayStartAction(item: Item): boolean {
  return Boolean(item.startAction && item.status !== 'idea_to_try' && item.status !== 'idea_later')
}

export function startFeedbackVisible(feedbackItemId: string | undefined, item: Item | undefined): boolean {
  return Boolean(feedbackItemId && item && feedbackItemId === item.id && item.status === 'doing')
}
