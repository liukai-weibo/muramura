import type {
  AdminResetPasswordResponse,
  AdminRevokeUserSessionsResponse,
  AuthRepository,
  AuthSession,
  AuthUser,
  InitialOwnerClaimRepository,
  InitialOwnerClaimResult,
  InitialPlatformAdminGrantResult,
  InitialPlatformAdminRepository,
  LoginInput,
  PlatformAdministrationRepository,
  PlatformRole,
  PlatformUserPage,
  PlatformUserSummary,
  RegisterInput,
} from '@knowledge-base/contracts'
import {
  assertAuthCredentials,
  assertPassword,
  assertUsername,
  createId,
  createSessionSecret,
  fail,
  hashPassword,
  hashSessionSecret,
  normalizeUsername,
  verifyPassword,
} from '@knowledge-base/domain'

export const AUTH_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000

/** 注册、登录和 Cookie 会话编排；凭据规则与密码学细节由 Domain 提供。 */
export class AuthenticationApplicationService {
  constructor(private readonly repository: AuthRepository, private readonly now: () => Date = () => new Date()) {}

  async register(input: RegisterInput): Promise<{ session: AuthSession; secret: Buffer; expiresAt: string }> {
    const username = normalizeUsername(input.username)
    assertAuthCredentials(username, input.password)
    if (await this.repository.findUserByUsername(username)) fail('AUTH_USERNAME_TAKEN', 'username already exists')
    const createdAt = this.now().toISOString()
    const user = await this.repository.createUser({ id: createId(), username, passwordHash: await hashPassword(input.password), createdAt })
    return this.startSession(user)
  }

  async login(input: LoginInput): Promise<{ session: AuthSession; secret: Buffer; expiresAt: string }> {
    const username = normalizeUsername(input.username)
    assertAuthCredentials(username, input.password)
    const record = await this.repository.findUserByUsername(username)
    if (!record || !(await verifyPassword(input.password, record.passwordHash))) fail('AUTH_INVALID_CREDENTIALS', 'invalid username or password')
    return this.startSession(record.user)
  }

  async current(secret: Uint8Array | undefined): Promise<AuthSession | undefined> {
    if (!secret) return undefined
    const user = await this.repository.getSessionBySecretHash(hashSessionSecret(secret), this.now().toISOString())
    return user ? { user } : undefined
  }

  async logout(secret: Uint8Array | undefined): Promise<void> {
    if (secret) await this.repository.revokeSessionBySecretHash(hashSessionSecret(secret), this.now().toISOString())
  }

  async changeUsername(actor: AuthUser, username: string): Promise<AuthUser> {
    const normalized = normalizeUsername(username)
    assertUsername(normalized)
    return this.repository.updateUsername({
      userId: actor.id,
      username: normalized,
      updatedAt: this.now().toISOString(),
    })
  }

  async changePassword(actor: AuthUser, input: { currentPassword: string; newPassword: string }): Promise<void> {
    assertPassword(input.currentPassword)
    assertPassword(input.newPassword)
    const record = await this.repository.findCredentialByUserId(actor.id)
    if (!record) fail('AUTH_ACCOUNT_UNAVAILABLE', 'account unavailable')
    if (!(await verifyPassword(input.currentPassword, record.passwordHash))) {
      fail('AUTH_CURRENT_PASSWORD_INVALID', 'current password is invalid')
    }
    const revokedAt = this.now().toISOString()
    await this.repository.updatePasswordHashAndRevokeSessions({
      userId: actor.id,
      expectedPasswordHash: record.passwordHash,
      passwordHash: await hashPassword(input.newPassword),
      revokedAt,
    })
  }

  private async startSession(user: AuthUser): Promise<{ session: AuthSession; secret: Buffer; expiresAt: string }> {
    const secret = createSessionSecret()
    const now = this.now()
    const expiresAt = new Date(now.getTime() + AUTH_SESSION_DURATION_MS).toISOString()
    const result = await this.repository.createSession({ id: createId(), userId: user.id, secretHash: hashSessionSecret(secret), expiresAt, createdAt: now.toISOString() })
    if (result === 'account-unavailable') fail('AUTH_INVALID_CREDENTIALS', 'invalid username or password')
    return { session: { user }, secret, expiresAt }
  }
}

export class InitialPlatformAdminApplicationService {
  constructor(
    private readonly repository: InitialPlatformAdminRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = createId,
  ) {}

  async initialize(targetUserId: string): Promise<{ targetUserId: string; status: InitialPlatformAdminGrantResult; operationId?: string }> {
    const target = targetUserId.trim()
    if (!target || target.length > 128) fail('PLATFORM_ADMIN_VALIDATION_FAILED', '平台管理请求参数无效')
    const operationId = this.newId()
    const status = await this.repository.initializePlatformAdmin({
      targetUserId: target,
      auditEventId: this.newId(),
      operationId,
      createdAt: this.now().toISOString(),
    })
    return status === 'granted' ? { targetUserId: target, status, operationId } : { targetUserId: target, status }
  }
}

export class PlatformAdministrationApplicationService {
  constructor(
    private readonly repository: PlatformAdministrationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = createId,
  ) {}

  async listUsers(actor: AuthUser, input: { page: number; query?: string; status?: 'active' | 'deleted' }): Promise<PlatformUserPage> {
    this.assertAdministrator(actor)
    return this.repository.listUsers({ ...input, actorUserId: actor.id })
  }

  async getUser(actor: AuthUser, targetUserId: string): Promise<PlatformUserSummary> {
    this.assertAdministrator(actor)
    const user = await this.repository.getUserById(targetUserId, actor.id)
    if (!user) fail('PLATFORM_ADMIN_USER_NOT_FOUND', '目标用户不存在')
    return user
  }

  async setUserRoles(actor: AuthUser, input: { targetUserId: string; roles: PlatformRole[]; operationId: string }): Promise<PlatformUserSummary> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    if (!isCanonicalRoleRequest(input.roles)) fail('PLATFORM_ADMIN_VALIDATION_FAILED', '平台管理请求参数无效')
    const createdAt = this.now().toISOString()
    const change = {
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
    }
    if (!actor.roles.includes('platform_admin')) fail('PLATFORM_ADMIN_FORBIDDEN', '普通管理员不能调整管理员角色')
    if (input.roles.length === 2) await this.repository.grantOrdinaryAdmin(change)
    else await this.repository.revokeOrdinaryAdmin(change)
    const user = await this.repository.getUserById(input.targetUserId, actor.id)
    if (!user) fail('PLATFORM_ADMIN_USER_READ_FAILED', '读取目标用户失败')
    return user
  }

  async revokeAllUserSessions(actor: AuthUser, input: { targetUserId: string; operationId: string }): Promise<AdminRevokeUserSessionsResponse> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    const createdAt = this.now().toISOString()
    return this.repository.revokeAllSessions({
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
      revokedAt: createdAt,
    })
  }

  async softDeleteUser(actor: AuthUser, input: { targetUserId: string; operationId: string }): Promise<PlatformUserSummary> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    const createdAt = this.now().toISOString()
    return this.repository.softDeleteUser({
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
    })
  }

  async restoreUser(actor: AuthUser, input: { targetUserId: string; operationId: string }): Promise<PlatformUserSummary> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    const createdAt = this.now().toISOString()
    return this.repository.restoreUser({
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
    })
  }

  async updateUsername(actor: AuthUser, input: { targetUserId: string; username: string; operationId: string }): Promise<PlatformUserSummary> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    const username = normalizeUsername(input.username)
    assertUsername(username)
    const createdAt = this.now().toISOString()
    return this.repository.updateUsername({
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      username,
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
    })
  }

  async resetPassword(actor: AuthUser, input: { targetUserId: string; newPassword: string; operationId: string }): Promise<AdminResetPasswordResponse> {
    this.assertAdministrator(actor)
    assertCanonicalOperationId(input.operationId)
    assertPassword(input.newPassword)
    const createdAt = this.now().toISOString()
    return this.repository.resetPassword({
      actorUserId: actor.id,
      targetUserId: input.targetUserId,
      passwordHash: await hashPassword(input.newPassword),
      auditEventId: this.newId(),
      operationId: input.operationId,
      createdAt,
      revokedAt: createdAt,
    })
  }

  private assertAdministrator(actor: AuthUser): void {
    if (!actor.roles.includes('platform_admin') && !actor.roles.includes('ordinary_admin')) fail('PLATFORM_ADMIN_FORBIDDEN', '无权执行管理员操作')
  }
}

function assertCanonicalOperationId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    fail('PLATFORM_ADMIN_VALIDATION_FAILED', '平台管理请求参数无效')
  }
}

function isCanonicalRoleRequest(roles: PlatformRole[]): boolean {
  return roles.length === 1 && roles[0] === 'member'
    || roles.length === 2 && roles[0] === 'member' && roles[1] === 'ordinary_admin'
}

export class InitialOwnerClaimApplicationService {
  constructor(private readonly repository: InitialOwnerClaimRepository) {}

  claim(userId: string): Promise<InitialOwnerClaimResult> {
    const target = userId.trim()
    if (!target) fail('INITIAL_OWNER_INVALID_TARGET', 'target user id is required')
    return this.repository.claimInitialOwner(target)
  }
}
