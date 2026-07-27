/** UI-only guards: API facts win, while a failed write never clears a user's draft. */
export function isCurrentExplorationRequest(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId
}

export function captureDraftAfterWrite(draft: string, completed: boolean): string {
  return completed ? '' : draft
}

/** Keeps a literal three-dot suffix while respecting the rendered width of the actual font. */
export function truncateDisplayName(value: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(value) <= maxWidth) return value
  const suffix = '...'
  const characters = Array.from(value)
  while (characters.length > 0 && measure(`${characters.join('')}${suffix}`) > maxWidth) characters.pop()
  return `${characters.join('')}${suffix}`
}

/** An unknown write stays locked until every required fact read has succeeded. */
export function mayUnlockUnknownOutcome(reads: boolean[]): boolean {
  return reads.length > 0 && reads.every(Boolean)
}

export function explorationListReadState(input: { loading: boolean; hasSucceeded: boolean; hasEntries: boolean }): 'loading' | 'error' | 'content' | 'empty' {
  if (input.loading && !input.hasSucceeded) return 'loading'
  if (!input.hasSucceeded) return 'error'
  return input.hasEntries ? 'content' : 'empty'
}
