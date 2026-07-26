/** UI-only guards: API facts win, while a failed write never clears a user's draft. */
export function isCurrentExplorationRequest(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId
}

export function captureDraftAfterWrite(draft: string, completed: boolean): string {
  return completed ? '' : draft
}

/** An unknown write stays locked until every required fact read has succeeded. */
export function mayUnlockUnknownOutcome(reads: boolean[]): boolean {
  return reads.length > 0 && reads.every(Boolean)
}

export function explorationListReadState(input: { loading: boolean; hasSucceeded: boolean; hasEntries: boolean }): 'loading' | 'error' | 'content' | 'empty' {
  if (input.loading) return 'loading'
  if (!input.hasSucceeded) return 'error'
  return input.hasEntries ? 'content' : 'empty'
}
