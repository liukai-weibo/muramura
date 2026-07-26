import type { ItemExplorationTrackContext } from '@knowledge-base/contracts'

/** Structural API context is the only authority for whether the UI may alter an association. */
export function canModifyItemExplorationContext(context: ItemExplorationTrackContext | undefined): boolean {
  return context?.status === 'no-association' || context?.status === 'available'
}

export function itemExplorationReadState(input: { loading: boolean; error: string; context?: ItemExplorationTrackContext }): 'loading' | 'error' | 'empty' | 'available' | 'track-deleted' | 'unavailable' {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  return input.context?.status === 'no-association' ? 'empty' : input.context?.status ?? 'empty'
}
