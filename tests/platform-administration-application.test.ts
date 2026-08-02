import { describe, expect, it, vi } from 'vitest'
import {
  InitialPlatformAdminApplicationService,
  PlatformAdministrationApplicationService,
} from '../packages/application/src/index'
import { mapFailure } from '../apps/api/src/api-errors'
import type { AuthUser, InitialPlatformAdminRepository, PlatformAdministrationRepository, PlatformUserSummary } from '../packages/contracts/src/index'
import { BusinessError, fail } from '../packages/domain/src/index'

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
    await expect(service.listUsers(actor(['member']), { page: 1 })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_FORBIDDEN' })
    await expect(service.setUserRoles(actor(['member']), { targetUserId: 'target', roles: ['member'], operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_FORBIDDEN' })
    await expect(service.revokeAllUserSessions(actor(['member']), { targetUserId: 'target', operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_FORBIDDEN' })
    expect(Object.values(repo).every(method => !vi.mocked(method).mock.calls.length)).toBe(true)
  })

  it('accepts only canonical roles and UUID operation IDs', async () => {
    const repo = repository()
    const service = new PlatformAdministrationApplicationService(repo)
    for (const roles of [[], ['platform_admin'], ['platform_admin', 'member'], ['member', 'member']] as AuthUser['roles'][]) {
      await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'target', roles, operationId: crypto.randomUUID() })).rejects.toBeInstanceOf(BusinessError)
    }
    await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'target', roles: ['member'], operationId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_VALIDATION_FAILED' })
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
    await expect(service.setUserRoles(actor(['member', 'platform_admin']), { targetUserId: 'missing', roles: ['member'], operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_USER_READ_FAILED' })
  })

  it('propagates repository BusinessError unchanged and preserves unknown infrastructure failures', async () => {
    const repo = repository()
    const service = new PlatformAdministrationApplicationService(repo)
    const admin = actor(['member', 'platform_admin'])

    vi.mocked(repo.listUsers).mockImplementationOnce(() => fail('PLATFORM_ADMIN_INVALID_PAGE', '页码无效'))
    await expect(service.listUsers(admin, { page: 0 })).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'PLATFORM_ADMIN_INVALID_PAGE',
    })

    vi.mocked(repo.revokePlatformAdmin).mockImplementationOnce(() => fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行平台管理操作'))
    await expect(service.setUserRoles(admin, {
      targetUserId: 'target',
      roles: ['member'],
      operationId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_FORBIDDEN' })

    const unavailable = Object.assign(new Error('connection unavailable'), { code: 'ECONNREFUSED' })
    vi.mocked(repo.revokeAllSessions).mockRejectedValueOnce(unavailable)
    await expect(service.revokeAllUserSessions(admin, {
      targetUserId: 'target',
      operationId: crypto.randomUUID(),
    })).rejects.toBe(unavailable)
  })

  it('lets the API map unified BusinessError by category', () => {
    expect(mapFailure(new BusinessError('PLATFORM_ADMIN_FORBIDDEN', '无权执行平台管理操作'))).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(mapFailure(new BusinessError('PLATFORM_ADMIN_INVALID_PAGE', '页码无效'))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', message: '页码无效' })
    expect(mapFailure(new BusinessError('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在'))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(mapFailure(new BusinessError('PLATFORM_ADMIN_OPERATION_CONFLICT', 'operationId 已被使用，不能推断本次成功'))).toMatchObject({ status: 409, code: 'CONFLICT' })
    expect(mapFailure(new BusinessError('PLATFORM_ADMIN_USER_READ_FAILED', '读取目标用户失败'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' })
  })

  it('propagates bootstrap BusinessError to the CLI without translation', async () => {
    const repo: InitialPlatformAdminRepository = {
      initializePlatformAdmin: vi.fn(async () => {
        fail('PLATFORM_ADMIN_ALREADY_INITIALIZED', '平台管理员已经初始化')
      }),
    }
    const service = new InitialPlatformAdminApplicationService(repo)
    await expect(service.initialize('target')).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'PLATFORM_ADMIN_ALREADY_INITIALIZED',
    })
  })
})
