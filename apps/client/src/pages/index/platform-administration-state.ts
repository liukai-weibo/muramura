import type { AiConfigMetadata, PlatformRole, PlatformUserPage, PlatformUserSummary } from '@knowledge-base/contracts'
import type { ApiClientError } from './api-client'

export const PLATFORM_USERS_PAGE_SIZE = 20
export const PLATFORM_USER_QUERY_LIMIT = 80

export type PlatformAdministrationAction = 'grant-role' | 'revoke-role' | 'revoke-sessions' | 'soft-delete' | 'restore'
export type PlatformTargetWriteState = 'idle' | 'submitting-role' | 'submitting-sessions' | 'submitting-account' | 'role-unknown' | 'sessions-unknown' | 'account-unknown'

export type PlatformAiConfigStatus = 'initial-loading' | 'ready' | 'refreshing' | 'initial-error' | 'refresh-error' | 'saving' | 'clearing' | 'unknown'

export interface PlatformAiConfigState {
  status: PlatformAiConfigStatus
  metadata?: AiConfigMetadata
  message?: string
  requestId?: string
}

export function createPlatformAiConfigState(): PlatformAiConfigState {
  return { status: 'initial-loading' }
}

export function withAiConfigMetadata(_state: PlatformAiConfigState, metadata: AiConfigMetadata): PlatformAiConfigState {
  return { status: 'ready', metadata }
}

export function withAiConfigReadError(state: PlatformAiConfigState, message: string, requestId?: string): PlatformAiConfigState {
  return { status: state.metadata ? 'refresh-error' : 'initial-error', metadata: state.metadata, message, requestId }
}

export function withAiConfigUnknown(state: PlatformAiConfigState, message: string, requestId?: string): PlatformAiConfigState {
  return { status: 'unknown', metadata: state.metadata, message, requestId }
}

export interface PlatformAdministrationConfirmation {
  targetId: string
  targetUsername: string
  action: PlatformAdministrationAction
  expectedRoles: PlatformRole[]
  expectedDeletedAt: string | null
  returnToSessionsUnknown?: boolean
}

export interface PlatformAdministrationNotice {
  kind: 'success' | 'error' | 'unknown'
  message: string
  requestId?: string
  refreshSuggested?: boolean
}

export interface PlatformReadIdentity {
  aborted: boolean
  mounted: boolean
  requestGeneration: number
  currentGeneration: number
  authenticationContext: string
  currentAuthenticationContext: string
  factGeneration: number
  currentFactGeneration: number
}

export interface PlatformReadOwner {
  generation: number
  authenticationContext: string
  factGeneration: number
}

export class PlatformReadCoordinator {
  private owner?: PlatformReadOwner

  begin(owner: PlatformReadOwner): void {
    this.owner = owner
  }

  complete(generation: number, authenticationContext: string): boolean {
    if (!this.owner || this.owner.generation !== generation || this.owner.authenticationContext !== authenticationContext) return false
    this.owner = undefined
    return true
  }

  supersedeByWrite(authenticationContext: string, currentFactGeneration: number): boolean {
    if (!this.owner || this.owner.authenticationContext !== authenticationContext || this.owner.factGeneration === currentFactGeneration) return false
    this.owner = undefined
    return true
  }

  reset(): void {
    this.owner = undefined
  }
}

export interface RoleUnknownReadReconciliation {
  snapshot: PlatformUserPage
  resolved: Array<{ targetId: string; summary: PlatformUserSummary }>
  unresolvedTargetIds: string[]
}

export interface RoleUnknownFact {
  formedAtFactGeneration: number
  lastConfirmedSummary: PlatformUserSummary
}

export function hasPlatformAdminRole(roles: readonly PlatformRole[]): boolean {
  return roles.includes('platform_admin')
}

export function hasAdministratorRole(roles: readonly PlatformRole[]): boolean {
  return roles.includes('platform_admin') || roles.includes('ordinary_admin')
}

export function acceptPlatformUserQueryDraft(current: string, next: string): string {
  return next.length <= PLATFORM_USER_QUERY_LIMIT ? next : current
}

export function platformPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PLATFORM_USERS_PAGE_SIZE))
}

export function shouldApplyPlatformRead(identity: PlatformReadIdentity): boolean {
  return identity.mounted && !identity.aborted
    && identity.requestGeneration === identity.currentGeneration
    && identity.authenticationContext === identity.currentAuthenticationContext
    && identity.factGeneration === identity.currentFactGeneration
}

export function canResolveRoleUnknown(
  targetId: string,
  unknownFact: RoleUnknownFact,
  readFactGeneration: number,
  items: readonly PlatformUserSummary[],
): boolean {
  return readFactGeneration >= unknownFact.formedAtFactGeneration && items.some((item) => item.id === targetId)
}

export function reconcileRoleUnknownRead(
  result: PlatformUserPage,
  unknownFacts: ReadonlyMap<string, RoleUnknownFact>,
  readFactGeneration: number,
): RoleUnknownReadReconciliation {
  const resolved: Array<{ targetId: string; summary: PlatformUserSummary }> = []
  const unresolvedTargetIds: string[] = []
  for (const [targetId, fact] of unknownFacts) {
    const summary = result.items.find((item) => item.id === targetId)
    if (summary && readFactGeneration >= fact.formedAtFactGeneration) resolved.push({ targetId, summary })
    else unresolvedTargetIds.push(targetId)
  }
  return { snapshot: result, resolved, unresolvedTargetIds }
}

export function createRoleUnknownFact(
  lastConfirmedSummary: PlatformUserSummary,
  formedAtFactGeneration: number,
): RoleUnknownFact {
  return {
    formedAtFactGeneration,
    lastConfirmedSummary: { ...lastConfirmedSummary, roles: [...lastConfirmedSummary.roles] },
  }
}

export function platformRoleLabel(user: PlatformUserSummary): '成员' | '普通管理员' | '平台管理员' | '已删除' {
  if (user.deletedAt !== null) return '已删除'
  return user.roles.includes('platform_admin') ? '平台管理员' : user.roles.includes('ordinary_admin') ? '普通管理员' : '成员'
}

export function rolesForAction(action: PlatformAdministrationAction): PlatformRole[] | undefined {
  if (action === 'grant-role') return ['member', 'ordinary_admin']
  if (action === 'revoke-role') return ['member']
  return undefined
}

export function isConfirmationCompatible(
  confirmation: PlatformAdministrationConfirmation,
  snapshot: PlatformUserPage | undefined,
  currentUserId: string,
): boolean {
  const target = snapshot?.items.find((item) => item.id === confirmation.targetId)
  if (!target || target.id === currentUserId || target.username !== confirmation.targetUsername) return false
  if (target.deletedAt !== confirmation.expectedDeletedAt) return false
  if (target.roles.length !== confirmation.expectedRoles.length
    || target.roles.some((role, index) => role !== confirmation.expectedRoles[index])) return false
  return confirmation.action === 'restore' ? target.deletedAt !== null
    : confirmation.action === 'soft-delete' ? target.deletedAt === null
      : target.deletedAt === null && (confirmation.action === 'grant-role' ? target.roles.length === 1
        : confirmation.action === 'revoke-role' ? target.roles.includes('ordinary_admin')
          : true)
}

export function replacePlatformUser(snapshot: PlatformUserPage, replacement: PlatformUserSummary): PlatformUserPage {
  return { ...snapshot, items: snapshot.items.map((item) => item.id === replacement.id ? replacement : item) }
}

export function platformErrorNotice(error: unknown, fallback: string, refreshSuggested = false): PlatformAdministrationNotice {
  const apiError = error as ApiClientError
  return {
    kind: 'error',
    message: error instanceof Error ? error.message : fallback,
    requestId: apiError.requestId,
    refreshSuggested,
  }
}

export function createOperationId(cryptoValue: Pick<Crypto, 'randomUUID' | 'getRandomValues'> | undefined = globalThis.crypto): string | undefined {
  if (!cryptoValue) return undefined
  if (typeof cryptoValue.randomUUID === 'function') {
    try {
      const value = cryptoValue.randomUUID()
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  if (typeof cryptoValue.getRandomValues !== 'function') return undefined
  const bytes = new Uint8Array(16)
  try { cryptoValue.getRandomValues(bytes) } catch { return undefined }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export function isUnknownWriteError(error: unknown): boolean {
  const status = (error as ApiClientError).status
  return status === 503 || (error instanceof Error && error.name === 'ApiClientUnknownOutcomeError')
}

export function unknownTargetState(action: PlatformAdministrationAction): PlatformTargetWriteState {
  return action === 'revoke-sessions' ? 'sessions-unknown'
    : action === 'soft-delete' || action === 'restore' ? 'account-unknown'
      : 'role-unknown'
}
