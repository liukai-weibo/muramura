import { describe, expect, it, vi } from 'vitest'
import type { PlatformUserPage, PlatformUserSummary } from '@knowledge-base/contracts'
import {
  acceptPlatformUserQueryDraft,
  canResolveRoleUnknown,
  createRoleUnknownFact,
  createOperationId,
  hasPlatformAdminRole,
  isConfirmationCompatible,
  isUnknownWriteError,
  platformPageCount,
  PlatformReadCoordinator,
  reconcileRoleUnknownRead,
  replacePlatformUser,
  shouldApplyPlatformRead,
  unknownTargetState,
  type PlatformAdministrationConfirmation,
} from '../apps/client/src/pages/index/platform-administration-state'

const target: PlatformUserSummary = { id: 'target-1', username: 'target', roles: ['member'], isInitialPlatformAdmin: false, createdAt: '2026-07-30T00:00:00.000Z', deletedAt: null }
const snapshot: PlatformUserPage = { items: [target], page: 1, pageSize: 20, total: 1 }

describe('platform administration H5 state boundary', () => {
  it('pre-gates only the platform administrator role and keeps query draft within 80 code units', () => {
    expect(hasPlatformAdminRole(['member'])).toBe(false)
    expect(hasPlatformAdminRole(['member', 'platform_admin'])).toBe(true)
    expect(acceptPlatformUserQueryDraft('kept', 'x'.repeat(81))).toBe('kept')
    expect(acceptPlatformUserQueryDraft('', '王'.repeat(80))).toHaveLength(80)
    expect(platformPageCount(0)).toBe(1)
    expect(platformPageCount(41)).toBe(3)
  })

  it('revalidates the frozen target, current user and expected roles before writing', () => {
    const confirmation: PlatformAdministrationConfirmation = { targetId: target.id, targetUsername: target.username, expectedRoles: ['member'], expectedDeletedAt: null, action: 'grant-role' }
    expect(isConfirmationCompatible(confirmation, snapshot, 'actor-1')).toBe(true)
    expect(isConfirmationCompatible(confirmation, snapshot, target.id)).toBe(false)
    expect(isConfirmationCompatible({ ...confirmation, targetUsername: 'changed' }, snapshot, 'actor-1')).toBe(false)
    expect(isConfirmationCompatible({ ...confirmation, expectedRoles: ['member', 'platform_admin'] }, snapshot, 'actor-1')).toBe(false)
    expect(isConfirmationCompatible({ ...confirmation, action: 'soft-delete' }, snapshot, 'actor-1')).toBe(true)
    const deleted = { ...target, deletedAt: '2026-07-30T01:00:00.000Z' }
    expect(isConfirmationCompatible({ ...confirmation, action: 'restore', expectedDeletedAt: deleted.deletedAt }, { ...snapshot, items: [deleted] }, 'actor-1')).toBe(true)
  })

  it('uses response summaries rather than the requested role to replace a row', () => {
    const response: PlatformUserSummary = { ...target, username: 'server-name', roles: ['member', 'platform_admin'] }
    expect(replacePlatformUser(snapshot, response).items[0]).toEqual(response)
    expect(snapshot.items[0]).toEqual(target)
  })

  it('generates one randomUUID only when requested and supports RFC4122 CSPRNG fallback', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111' as `${string}-${string}-${string}-${string}-${string}`)
    expect(createOperationId({ randomUUID, getRandomValues: vi.fn() as never })).toBe('11111111-1111-4111-8111-111111111111')
    expect(randomUUID).toHaveBeenCalledTimes(1)

    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(0xab); return bytes })
    const fallback = createOperationId({ randomUUID: undefined as never, getRandomValues } as unknown as Crypto)
    expect(fallback).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(createOperationId({ randomUUID: undefined, getRandomValues: undefined } as unknown as Crypto)).toBeUndefined()
  })

  it('classifies only transport-shaped and 503 writes as unknown', () => {
    expect(isUnknownWriteError(Object.assign(new Error('lost'), { name: 'ApiClientUnknownOutcomeError' }))).toBe(true)
    expect(isUnknownWriteError(Object.assign(new Error('unavailable'), { status: 503 }))).toBe(true)
    expect(isUnknownWriteError(Object.assign(new Error('conflict'), { status: 409 }))).toBe(false)
    expect(unknownTargetState('grant-role')).toBe('role-unknown')
    expect(unknownTargetState('revoke-role')).toBe('role-unknown')
    expect(unknownTargetState('revoke-sessions')).toBe('sessions-unknown')
    expect(unknownTargetState('soft-delete')).toBe('account-unknown')
    expect(unknownTargetState('restore')).toBe('account-unknown')
  })

  it('rejects aborted, stale-fact, stale-generation and stale-auth reads and only unlocks a matching post-unknown target', () => {
    const current = {
      mounted: true, aborted: false,
      requestGeneration: 3, currentGeneration: 3,
      authenticationContext: 'auth-2', currentAuthenticationContext: 'auth-2',
      factGeneration: 5, currentFactGeneration: 5,
    }
    expect(shouldApplyPlatformRead(current)).toBe(true)
    expect(shouldApplyPlatformRead({ ...current, aborted: true })).toBe(false)
    expect(shouldApplyPlatformRead({ ...current, requestGeneration: 2 })).toBe(false)
    expect(shouldApplyPlatformRead({ ...current, authenticationContext: 'auth-1' })).toBe(false)
    expect(shouldApplyPlatformRead({ ...current, factGeneration: 4 })).toBe(false)
    const unknownFact = createRoleUnknownFact(target, 5)
    expect(canResolveRoleUnknown(target.id, unknownFact, 5, [target])).toBe(true)
    expect(canResolveRoleUnknown(target.id, unknownFact, 4, [target])).toBe(false)
    expect(canResolveRoleUnknown(target.id, unknownFact, 5, [])).toBe(false)
  })

  it('ends only the refreshing read superseded by a write and never ends a newer interleaved read', () => {
    const coordinator = new PlatformReadCoordinator()
    let listState: 'ready' | 'refreshing' = 'refreshing'
    let visibleSnapshot = snapshot
    coordinator.begin({ generation: 1, authenticationContext: 'auth-1', factGeneration: 0 })

    const writtenTarget: PlatformUserSummary = { ...target, roles: ['member', 'platform_admin'] }
    visibleSnapshot = replacePlatformUser(visibleSnapshot, writtenTarget)
    if (coordinator.supersedeByWrite('auth-1', 1)) listState = 'ready'
    expect(listState).toBe('ready')
    const staleReadCanApply = shouldApplyPlatformRead({
      mounted: true, aborted: false,
      requestGeneration: 1, currentGeneration: 1,
      authenticationContext: 'auth-1', currentAuthenticationContext: 'auth-1',
      factGeneration: 0, currentFactGeneration: 1,
    })
    if (staleReadCanApply) visibleSnapshot = snapshot
    expect(visibleSnapshot.items[0]).toEqual(writtenTarget)
    expect(coordinator.complete(1, 'auth-1')).toBe(false)
    expect(listState).toBe('ready')

    coordinator.begin({ generation: 2, authenticationContext: 'auth-1', factGeneration: 1 })
    listState = 'refreshing'
    expect(coordinator.complete(1, 'auth-1')).toBe(false)
    expect(listState).toBe('refreshing')
    if (coordinator.complete(2, 'auth-1')) listState = 'ready'
    expect(listState).toBe('ready')
  })

  it('keeps failed, aborted, expired and authentication-stale reads from ending a newer read owner', () => {
    const coordinator = new PlatformReadCoordinator()
    coordinator.begin({ generation: 3, authenticationContext: 'auth-2', factGeneration: 2 })
    coordinator.begin({ generation: 4, authenticationContext: 'auth-2', factGeneration: 2 })
    expect(coordinator.complete(3, 'auth-2')).toBe(false)
    expect(coordinator.complete(4, 'auth-1')).toBe(false)
    expect(coordinator.supersedeByWrite('auth-1', 3)).toBe(false)
    expect(coordinator.complete(4, 'auth-2')).toBe(true)
    expect(coordinator.complete(4, 'auth-2')).toBe(false)
  })

  it('reconciles A and B role unknown independently across separate factual reads', () => {
    const targetA: PlatformUserSummary = { ...target, id: 'target-a', username: 'A' }
    const targetB: PlatformUserSummary = { ...target, id: 'target-b', username: 'B' }
    const unknownFacts = new Map([
      ['target-a', createRoleUnknownFact(targetA, 7)],
      ['target-b', createRoleUnknownFact(targetB, 7)],
    ])
    const serverA: PlatformUserSummary = { ...targetA, roles: ['member', 'platform_admin'] }
    const serverAResult: PlatformUserPage = { items: [serverA], page: 2, pageSize: 20, total: 24 }

    const first = reconcileRoleUnknownRead(serverAResult, unknownFacts, 7)
    expect(first.resolved.map((entry) => entry.targetId)).toEqual(['target-a'])
    expect(first.unresolvedTargetIds).toEqual(['target-b'])
    expect(first.snapshot).toBe(serverAResult)
    expect(first.snapshot).toEqual({ items: [serverA], page: 2, pageSize: 20, total: 24 })
    expect(unknownFacts.size).toBe(2)

    unknownFacts.delete('target-a')
    const serverB: PlatformUserSummary = { ...targetB, roles: ['member', 'platform_admin'] }
    const serverBResult: PlatformUserPage = { items: [serverB], page: 1, pageSize: 20, total: 1 }
    const second = reconcileRoleUnknownRead(serverBResult, unknownFacts, 8)
    expect(second.resolved.map((entry) => entry.targetId)).toEqual(['target-b'])
    expect(second.unresolvedTargetIds).toEqual([])
    expect(second.snapshot).toBe(serverBResult)
    expect(unknownFacts.has('target-b')).toBe(true)
  })

  it('shows a legal empty server result while a missing role target and session unknown remain unresolved', () => {
    const unknownFacts = new Map([[target.id, createRoleUnknownFact(target, 9)]])
    const emptyResult: PlatformUserPage = { items: [], page: 1, pageSize: 20, total: 0 }
    const result = reconcileRoleUnknownRead(emptyResult, unknownFacts, 9)
    expect(result.resolved).toEqual([])
    expect(result.unresolvedTargetIds).toEqual([target.id])
    expect(result.snapshot).toBe(emptyResult)
    expect(unknownFacts.get(target.id)?.lastConfirmedSummary).toEqual(target)
    expect(unknownTargetState('revoke-sessions')).toBe('sessions-unknown')
  })

  it('preserves the filtered server page metadata and item order without injecting a missing unknown target', () => {
    const missing: PlatformUserSummary = { ...target, id: 'missing', username: 'missing' }
    const first: PlatformUserSummary = { ...target, id: 'first', username: 'first' }
    const second: PlatformUserSummary = { ...target, id: 'second', username: 'second' }
    const unknownFacts = new Map([[missing.id, createRoleUnknownFact(missing, 12)]])
    const serverResult: PlatformUserPage = { items: [second, first], page: 3, pageSize: 20, total: 45 }

    const reconciliation = reconcileRoleUnknownRead(serverResult, unknownFacts, 12)

    expect(reconciliation.snapshot).toBe(serverResult)
    expect(reconciliation.snapshot).toEqual({ items: [second, first], page: 3, pageSize: 20, total: 45 })
    expect(reconciliation.unresolvedTargetIds).toEqual([missing.id])
    expect(reconciliation.snapshot.items).not.toContain(missing)
  })

  it('freezes the last server-confirmed summary without deriving the requested role', () => {
    const serverSummary: PlatformUserSummary = { ...target, roles: ['member'] }
    const fact = createRoleUnknownFact(serverSummary, 11)
    serverSummary.roles.push('platform_admin')

    expect(fact).toEqual({ formedAtFactGeneration: 11, lastConfirmedSummary: target })
    expect(fact.lastConfirmedSummary).not.toBe(serverSummary)
  })

  it('does not apply failed, aborted or stale reads to visible facts or unknown records', () => {
    const fact = createRoleUnknownFact(target, 5)
    const unknownFacts = new Map([[target.id, fact]])
    let visible = snapshot
    const result: PlatformUserPage = { items: [], page: 1, pageSize: 20, total: 0 }
    const current = {
      mounted: true, aborted: false,
      requestGeneration: 3, currentGeneration: 3,
      authenticationContext: 'auth-2', currentAuthenticationContext: 'auth-2',
      factGeneration: 5, currentFactGeneration: 5,
    }
    const rejected = [
      { ...current, aborted: true },
      { ...current, requestGeneration: 2 },
      { ...current, authenticationContext: 'auth-1' },
      { ...current, factGeneration: 4 },
    ]
    for (const identity of rejected) {
      if (shouldApplyPlatformRead(identity)) visible = reconcileRoleUnknownRead(result, unknownFacts, identity.factGeneration).snapshot
    }
    // A failed GET never reaches reconciliation.
    expect(visible).toBe(snapshot)
    expect(unknownFacts).toEqual(new Map([[target.id, fact]]))
  })
})
