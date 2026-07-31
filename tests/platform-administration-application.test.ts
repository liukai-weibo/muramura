import { describe, expect, it, vi } from 'vitest'
import {
  PlatformAdministrationApplicationError,
  PlatformAdministrationApplicationService,
} from '../packages/application/src/index'
import type { AuthUser, PlatformAdministrationRepository, PlatformUserSummary } from '../packages/contracts/src/index'

const at = '2026-07-30T08:00:00.000Z'
const actor = (roles: AuthUser['roles']): AuthUser => ({ id: 'actor', username: 'actor', roles, createdAt: at })
const target: PlatformUserSummary = { id: 'target', username: 'target', roles: ['member'], createdAt: at }

function repository(): PlatformAdministrationRepository {
  return {
    listUsers: vi.fn(async input => ({ items: [target], page: input.page, pageSize: 20 as const, total: 1 })),
    getUserById: vi.fn(async id => id === target.id ? target : undefined),
    grantPlatformAdmin: vi.fn(async () => 'granted' as const),
    revokePlatformAdmin: vi.fn(async () => 'revoked' as const),
    revokeAllSessions: vi.fn(async () => ({ revokedSessionCount: 2 })),
    findAuditEventByOperationId: vi.fn(async () => undefined),
  }
}

describe('platform administration application', () => {
  it('rejects members before any repository call', async () => {
    const repo = repository()
    const service = new PlatformAdministrationApplicationService(repo)
    await expect(service.listUsers(actor(['member']), { page: 1 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.setUserRoles(actor(['member']), { targetUserId: 'target', roles: ['member'], operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.revokeAllUserSessions(actor(['member']), { targetUserId: 'target', operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'forbidden' })
    expect(Object.values(repo).every(method => !vi.mocked(method).mock.calls.length)).toBe(true)
  })

  it('accepts only canonical roles and UUID operation IDs', async () => {
    const repo = repository()
    const service = new PlatformAdministrationApplicationService(repo)
    for (const roles of [[], ['platform_admin'], ['platform_admin', 'member'], ['member', 'member']] as AuthUser['roles'][]) {
      await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'target', roles, operationId: crypto.randomUUID() })).rejects.toBeInstanceOf(PlatformAdministrationApplicationError)
    }
    await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'target', roles: ['member'], operationId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'validation-failed' })
    expect(repo.grantPlatformAdmin).not.toHaveBeenCalled()
    expect(repo.revokePlatformAdmin).not.toHaveBeenCalled()
  })

  it('uses the actor, one clock value and server IDs, then returns a real repository reread', async () => {
    const repo = repository()
    const ids = ['audit-grant', 'audit-revoke', 'audit-sessions']
    const service = new PlatformAdministrationApplicationService(repo, () => new Date(at), () => ids.shift()!)
    const admin = actor(['member', 'platform_admin'])
    const grantOperation = crypto.randomUUID()
    expect(await service.setUserRoles(admin, { targetUserId: 'target', roles: ['member', 'platform_admin'], operationId: grantOperation })).toBe(target)
    expect(repo.grantPlatformAdmin).toHaveBeenCalledWith({ actorUserId: 'actor', targetUserId: 'target', auditEventId: 'audit-grant', operationId: grantOperation, createdAt: at })
    expect(repo.getUserById).toHaveBeenCalledWith('target')

    const revokeOperation = crypto.randomUUID()
    await service.setUserRoles(admin, { targetUserId: 'target', roles: ['member'], operationId: revokeOperation })
    expect(repo.revokePlatformAdmin).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'actor', auditEventId: 'audit-revoke', operationId: revokeOperation }))

    const sessionOperation = crypto.randomUUID()
    expect(await service.revokeAllUserSessions(admin, { targetUserId: 'target', operationId: sessionOperation })).toEqual({ revokedSessionCount: 2 })
    expect(repo.revokeAllSessions).toHaveBeenCalledWith({ actorUserId: 'actor', targetUserId: 'target', auditEventId: 'audit-sessions', operationId: sessionOperation, createdAt: at, revokedAt: at })
  })

  it('fails closed when the post-write user reread is unavailable', async () => {
    const repo = repository()
    vi.mocked(repo.getUserById).mockResolvedValue(undefined)
    const service = new PlatformAdministrationApplicationService(repo)
    await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'missing', roles: ['member'], operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'user-read-failed' })
  })
})
