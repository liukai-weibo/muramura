import type { ItemExplorationTrackContext, ItemStatus } from '@knowledge-base/contracts'

/** Structured item status and API association facts jointly gate association writes. */
export function canModifyItemExplorationContext(context: ItemExplorationTrackContext | undefined, itemStatus?: ItemStatus): boolean {
  return itemStatus !== 'abandoned' && (context?.status === 'no-association' || context?.status === 'available')
}

export function itemExplorationReadState(input: { loading: boolean; error: string; context?: ItemExplorationTrackContext }): 'loading' | 'error' | 'empty' | 'available' | 'track-deleted' | 'unavailable' {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  return input.context?.status === 'no-association' ? 'empty' : input.context?.status ?? 'empty'
}
