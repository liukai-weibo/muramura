/**
 * 账户、数据归属与平台管理共享契约。
 *
 * 这些类型围绕“谁在使用系统、数据属于谁、谁可以执行平台管理”组织在
 * 同一模块中；具体认证编排仍属于 Application，持久化实现仍属于 Repository。
 * 失败一律使用 errors 中的统一 BusinessErrorCode，本文件不维护平行错误码。
 */

// --- Authentication / 认证与会话 ---

export interface AuthUser { id: string; username: string; roles: PlatformRole[]; createdAt: string }
export interface RegisterInput { username: string; password: string }
export interface LoginInput { username: string; password: string }
export interface AuthSession { user: AuthUser }
export interface CurrentUserScope { userId: string }
export interface CreateAuthUserInput { id: string; username: string; passwordHash: string; createdAt: string }
export interface AuthCredentialRecord { user: AuthUser; passwordHash: string }

export interface ChangeOwnUsernameInput { username: string }
export interface ChangeOwnPasswordInput { currentPassword: string; newPassword: string }

export interface AuthRepository {
  createUser(input: CreateAuthUserInput): Promise<AuthUser>
  findUserByUsername(username: string): Promise<AuthCredentialRecord | undefined>
  findCredentialByUserId(userId: string): Promise<AuthCredentialRecord | undefined>
  updateUsername(input: { userId: string; username: string; updatedAt: string }): Promise<AuthUser>
  updatePasswordHashAndRevokeSessions(input: { userId: string; expectedPasswordHash: string; passwordHash: string; revokedAt: string }): Promise<{ revokedSessionCount: number }>
  createSession(input: { id: string; userId: string; secretHash: Uint8Array; expiresAt: string; createdAt: string }): Promise<'created' | 'account-unavailable'>
  getSessionBySecretHash(secretHash: Uint8Array, now: string): Promise<AuthUser | undefined>
  revokeSessionBySecretHash(secretHash: Uint8Array, revokedAt: string): Promise<void>
}

// --- Initial ownership / 初始数据归属 ---

export const ownedBusinessCollections = ['items', 'reviews', 'methods', 'methodEvidence', 'methodVersions', 'methodApplications', 'itemStatusEvents', 'itemLinks', 'methodTombstones', 'explorationTracks'] as const
export type OwnedBusinessCollection = typeof ownedBusinessCollections[number]
export type OwnerClaimCollectionSummary = { total: number; unowned: number; targetOwned: number; otherOwned: number }
export type OwnerClaimSummary = Record<OwnedBusinessCollection, OwnerClaimCollectionSummary>

export interface InitialOwnerClaimResult {
  status: 'claimed' | 'already-claimed'
  userId: string
  before: OwnerClaimSummary
  after: OwnerClaimSummary
}

export interface InitialOwnerClaimErrorDetails {
  userId: string
  before?: OwnerClaimSummary
}

export interface InitialOwnerClaimRepository {
  claimInitialOwner(userId: string): Promise<InitialOwnerClaimResult>
}

// --- Platform administration / 平台角色与管理 ---

export const platformRoles = ['member', 'ordinary_admin', 'platform_admin'] as const
export type PlatformRole = (typeof platformRoles)[number]

export const securityAuditActions = [
  'platform_admin_granted',
  'platform_admin_revoked',
  'ordinary_admin_granted',
  'ordinary_admin_revoked',
  'user_sessions_revoked',
  'user_soft_deleted',
  'user_restored',
  'user_username_changed',
  'user_password_reset',
] as const
export type SecurityAuditAction = (typeof securityAuditActions)[number]

export interface PlatformUserSummary {
  id: string
  username: string
  roles: PlatformRole[]
  isInitialPlatformAdmin: boolean
  createdAt: string
  deletedAt: string | null
}

export interface PlatformUserPage {
  items: PlatformUserSummary[]
  page: number
  pageSize: 20
  total: number
}

export interface AdminSetUserRolesRequest {
  roles: PlatformRole[]
  operationId: string
}

export interface AdminRevokeUserSessionsRequest {
  operationId: string
}

export interface AdminRevokeUserSessionsResponse {
  revokedSessionCount: number
}

export interface AdminChangeUserAccountStateRequest {
  operationId: string
}

export interface AdminUpdateUsernameRequest {
  username: string
  operationId: string
}

export interface AdminResetPasswordRequest {
  newPassword: string
  operationId: string
}

export interface AdminResetPasswordResponse {
  revokedSessionCount: number
}

export interface PlatformRoleChangeInput {
  actorUserId: string
  targetUserId: string
  auditEventId: string
  operationId: string
  createdAt: string
}

export interface RevokeAllUserSessionsInput extends PlatformRoleChangeInput {
  revokedAt: string
}

export interface AdminUpdateUsernameInput extends PlatformRoleChangeInput {
  username: string
}

export interface AdminResetPasswordInput extends PlatformRoleChangeInput {
  passwordHash: string
  revokedAt: string
}

export interface SecurityAuditEvent {
  id: string
  actorUserId?: string
  targetUserId: string
  action: SecurityAuditAction
  operationId: string
  createdAt: string
}

export interface PlatformAdministrationRepository {
  listUsers(input: { page: number; query?: string; status?: 'active' | 'deleted'; actorUserId?: string }): Promise<PlatformUserPage>
  getUserById(userId: string, actorUserId?: string): Promise<PlatformUserSummary | undefined>
  grantOrdinaryAdmin(input: PlatformRoleChangeInput): Promise<'granted' | 'already-granted'>
  revokeOrdinaryAdmin(input: PlatformRoleChangeInput): Promise<'revoked' | 'already-revoked'>
  revokeAllSessions(input: RevokeAllUserSessionsInput): Promise<{ revokedSessionCount: number }>
  softDeleteUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary>
  restoreUser(input: PlatformRoleChangeInput): Promise<PlatformUserSummary>
  updateUsername(input: AdminUpdateUsernameInput): Promise<PlatformUserSummary>
  resetPassword(input: AdminResetPasswordInput): Promise<AdminResetPasswordResponse>
  findAuditEventByOperationId(operationId: string): Promise<SecurityAuditEvent | undefined>
}

export interface InitialPlatformAdminGrantInput {
  targetUserId: string
  auditEventId: string
  operationId: string
  createdAt: string
}

export type InitialPlatformAdminGrantResult = 'granted' | 'already-initialized'

export interface InitialPlatformAdminRepository {
  initializePlatformAdmin(input: InitialPlatformAdminGrantInput): Promise<InitialPlatformAdminGrantResult>
}
