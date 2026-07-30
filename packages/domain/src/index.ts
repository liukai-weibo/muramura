import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { ItemStatus } from '@knowledge-base/contracts'

const scrypt = promisify(crypto.scrypt) as unknown as (password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>
const SCRYPT_N = 32768; const SCRYPT_R = 8; const SCRYPT_P = 1; const SCRYPT_KEY_LENGTH = 64
export function normalizeUsername(value: string): string { return value.trim() }
export function assertAuthCredentials(username: string, password: string): void {
  if (!username || username.length > 80 || password.length < 8) throw new Error('invalid authentication credentials')
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16); const key = await scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }) as Buffer
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$'); if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '1') return false
  try { const actual = await scrypt(password, Buffer.from(parts[4]!, 'base64'), SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }) as Buffer; const expected = Buffer.from(parts[5]!, 'base64'); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) } catch { return false }
}
export function createSessionSecret(): Buffer { return crypto.randomBytes(32) }
export function hashSessionSecret(secret: Uint8Array): Buffer { return crypto.createHash('sha256').update(secret).digest() }

export type BusinessErrorCategory = 'validation' | 'not-found' | 'conflict' | 'internal'

export type BusinessErrorCode =
  | 'INVALID_BACKUP'
  | 'INVALID_ITEM_STATUS_TRANSITION'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_IN_TRASH'
  | 'ITEM_TITLE_REQUIRED'
  | 'ITEM_TITLE_TOO_LONG'
  | 'ITEM_START_ACTION_ALREADY_EXISTS'
  | 'ITEM_METHOD_ALREADY_ASSOCIATED'
  | 'EXPLORATION_TRACK_NAME_REQUIRED'
  | 'EXPLORATION_TRACK_NAME_TOO_LONG'
  | 'EXPLORATION_TRACK_NOT_FOUND'
  | 'EXPLORATION_TRACK_DELETED'
  | 'EXPLORATION_TRACK_NAME_CONFLICT'
  | 'EXPLORATION_TRACK_ASSOCIATION_READ_ONLY'
  | 'EXPLORATION_TRACK_ASSOCIATION_UNAVAILABLE'
  | 'EXPLORATION_TRACK_STATUS_INVALID'
  | 'EXPLORATION_TRACK_NORMALIZED_NAME_MISSING'
  | 'EXPLORATION_TRACK_WORKFLOW_UNAVAILABLE'
  | 'METHOD_REQUIRED_FIELDS_MISSING'
  | 'METHOD_NOT_FOUND'
  | 'METHOD_NOT_IN_TRASH'
  | 'METHOD_ALREADY_IN_TRASH'
  | 'METHOD_TOMBSTONE_ALREADY_EXISTS'
  | 'METHOD_VERSION_HISTORY_UNPROVABLE'
  | 'METHOD_ALREADY_VALIDATED_BY_REVIEW'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_REQUIRED_FIELDS_MISSING'
  | 'REVIEW_ALREADY_COMPLETED'
  | 'REVIEW_HAS_METHOD_RELATION'
  | 'REVIEW_METHOD_MODE_CONFLICT'
  | 'ITEM_NOT_REVIEWABLE'

export class BusinessError extends Error {
  override readonly name = 'BusinessError'

  constructor(
    readonly code: BusinessErrorCode,
    readonly category: BusinessErrorCategory,
    message: string,
  ) {
    super(message)
  }
}

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

const itemTitleSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function normalizeItemTitle(value: string): string {
  return value.trim()
}

export function assertItemTitleLength(value: string): void {
  if (Array.from(itemTitleSegmenter.segment(value)).length > 20) {
    throw new BusinessError('ITEM_TITLE_TOO_LONG', 'validation', '标题最多 20 个字符')
  }
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
    throw new BusinessError(
      'INVALID_ITEM_STATUS_TRANSITION',
      'conflict',
      `不允许从 ${from} 变更为 ${to}`,
    )
  }
}
