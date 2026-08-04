import type { AuthRepository, AuthUser, InitialPlatformAdminRepository } from '@knowledge-base/contracts'
import { AuthenticationApplicationService, InitialPlatformAdminApplicationService } from '../packages/application/src/index'
import { hashPassword } from '../packages/domain/src/index'
import { describe, expect, it, vi } from 'vitest'

const member: AuthUser = { id: 'user-1', username: 'alice', roles: ['member'], createdAt: '2026-07-30T00:00:00.000Z' }

function repository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    createUser: vi.fn(async input => ({ id: input.id, username: input.username, roles: ['member'], createdAt: input.createdAt } as AuthUser)),
    findUserByUsername: vi.fn(async () => undefined),
    findCredentialByUserId: vi.fn(async () => undefined),
    updateUsername: vi.fn(async input => ({ id: input.userId, username: input.username, roles: ['member'], createdAt: member.createdAt } as AuthUser)),
    updatePasswordHashAndRevokeSessions: vi.fn(async () => ({ revokedSessionCount: 1 })),
    createSession: vi.fn(async () => 'created' as const),
    getSessionBySecretHash: vi.fn(async () => undefined),
    revokeSessionBySecretHash: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('authentication role application boundary', () => {
  it('passes only credential.user into AuthSession and never exposes passwordHash', async () => {
    const passwordHash = await hashPassword('password-123')
    const auth = repository({ findUserByUsername: vi.fn(async () => ({ user: member, passwordHash })) })
    const result = await new AuthenticationApplicationService(auth, () => new Date('2026-07-30T00:00:00.000Z')).login({ username: 'alice', password: 'password-123' })
    expect(result.session).toEqual({ user: member })
    expect(JSON.stringify(result.session)).not.toMatch(/password|hash|token|secret/i)
    expect(auth.createSession).toHaveBeenCalledTimes(1)
  })

  it('reads every old-cookie session again and never falls back after a role read failure', async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce({ ...member, roles: ['member', 'platform_admin'] })
      .mockRejectedValueOnce(new Error('role invariant failed'))
    const service = new AuthenticationApplicationService(repository({ getSessionBySecretHash: getSession }))
    const secret = Buffer.alloc(32, 1)
    expect((await service.current(secret))?.user.roles).toEqual(['member'])
    expect((await service.current(secret))?.user.roles).toEqual(['member', 'platform_admin'])
    await expect(service.current(secret)).rejects.toThrow('role invariant failed')
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it('creates one explicit bootstrap operation without retrying or guessing a target', async () => {
    const initializePlatformAdmin = vi.fn(async () => 'granted' as const)
    const initial: InitialPlatformAdminRepository = { initializePlatformAdmin }
    const ids = ['operation-1', 'audit-1']
    const service = new InitialPlatformAdminApplicationService(initial, () => new Date('2026-07-30T01:02:03.000Z'), () => ids.shift()!)
    expect(await service.initialize(' target-user ')).toEqual({ targetUserId: 'target-user', status: 'granted', operationId: 'operation-1' })
    expect(initializePlatformAdmin).toHaveBeenCalledWith({ targetUserId: 'target-user', operationId: 'operation-1', auditEventId: 'audit-1', createdAt: '2026-07-30T01:02:03.000Z' })
    expect(initializePlatformAdmin).toHaveBeenCalledTimes(1)
    await expect(service.initialize(' '.repeat(2))).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_VALIDATION_FAILED' })
  })

  it('uses the same BusinessError contract for authentication failures', async () => {
    const service = new AuthenticationApplicationService(repository())
    await expect(service.login({ username: 'alice', password: 'password-123' })).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'AUTH_INVALID_CREDENTIALS',
      category: 'unauthorized',
    })
    await expect(service.register({ username: '', password: 'password-123' })).rejects.toMatchObject({
      name: 'BusinessError',
      code: 'AUTH_CREDENTIALS_FORMAT_INVALID',
      category: 'validation',
    })
  })

  it('fails login without returning a session when the account is deleted during login', async () => {
    const passwordHash = await hashPassword('password-123')
    const auth = repository({
      findUserByUsername: vi.fn(async () => ({ user: member, passwordHash })),
      createSession: vi.fn(async () => 'account-unavailable' as const),
    })
    await expect(new AuthenticationApplicationService(auth).login({ username: 'alice', password: 'password-123' }))
      .rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' })
  })

  it('changes own username after normalization and rejects blank names', async () => {
    const auth = repository()
    const service = new AuthenticationApplicationService(auth, () => new Date('2026-07-30T00:00:00.000Z'))
    expect(await service.changeUsername(member, ' bob ')).toEqual({
      id: 'user-1',
      username: 'bob',
      roles: ['member'],
      createdAt: member.createdAt,
    })
    expect(auth.updateUsername).toHaveBeenCalledWith({
      userId: 'user-1',
      username: 'bob',
      updatedAt: '2026-07-30T00:00:00.000Z',
    })
    await expect(service.changeUsername(member, '   ')).rejects.toMatchObject({ code: 'AUTH_CREDENTIALS_FORMAT_INVALID' })
  })

  it('rejects invalid current passwords and revokes sessions after a successful change', async () => {
    const passwordHash = await hashPassword('password-123')
    const auth = repository({
      findCredentialByUserId: vi.fn(async () => ({ user: member, passwordHash })),
    })
    const service = new AuthenticationApplicationService(auth, () => new Date('2026-07-30T00:00:00.000Z'))
    await expect(service.changePassword(member, {
      currentPassword: 'wrong-password',
      newPassword: 'password-456',
    })).rejects.toMatchObject({ code: 'AUTH_CURRENT_PASSWORD_INVALID' })
    expect(auth.updatePasswordHashAndRevokeSessions).not.toHaveBeenCalled()

    await service.changePassword(member, {
      currentPassword: 'password-123',
      newPassword: 'password-456',
    })
    expect(auth.updatePasswordHashAndRevokeSessions).toHaveBeenCalledWith({
      userId: 'user-1',
      expectedPasswordHash: passwordHash,
      passwordHash: expect.stringMatching(/^scrypt\$/),
      revokedAt: '2026-07-30T00:00:00.000Z',
    })
  })
})
