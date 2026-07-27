import type { ItemStatus } from '@knowledge-base/contracts'

export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const transitions: Record<ItemStatus, readonly ItemStatus[]> = {
  idea_to_try: ['idea_later', 'doing', 'abandoned'],
  idea_later: ['idea_to_try', 'abandoned'],
  doing: ['paused', 'archived_no_review', 'abandoned'],
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
