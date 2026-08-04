import { describe, expect, it } from 'vitest'
import {
  businessErrorCategoryByCode,
  isPublicBusinessErrorCode,
  publicBusinessErrorCodes,
  type BusinessErrorCode,
} from '@knowledge-base/contracts'
import { BusinessError, businessFailure, fail } from '@knowledge-base/domain'
import { mapFailure } from '../apps/api/src/api-errors'

describe('统一错误契约', () => {
  it('既有事项类错误码仍在对外白名单中', () => {
    expect(isPublicBusinessErrorCode('ITEM_NOT_FOUND')).toBe(true)
    expect(isPublicBusinessErrorCode('INVALID_BACKUP')).toBe(true)
    expect(publicBusinessErrorCodes).toContain('EXPLORATION_TRACK_NOT_FOUND')
  })

  it('认证与平台管理统一码默认不外泄，仅公开当前密码错误', () => {
    const authCode: BusinessErrorCode = 'AUTH_INVALID_CREDENTIALS'
    const adminCode: BusinessErrorCode = 'PLATFORM_ADMIN_SELF_ROLE_CHANGE'
    expect(isPublicBusinessErrorCode(authCode)).toBe(false)
    expect(isPublicBusinessErrorCode(adminCode)).toBe(false)
    expect(isPublicBusinessErrorCode('AUTH_USERNAME_TAKEN')).toBe(false)
    expect(isPublicBusinessErrorCode('AUTH_CURRENT_PASSWORD_INVALID')).toBe(true)
    expect(isPublicBusinessErrorCode('BACKUP_OWNERSHIP_CONFLICT')).toBe(false)
  })

  it('fail/businessFailure 使用统一 category 表，API 只按 category 映射', () => {
    expect(businessErrorCategoryByCode.AUTH_INVALID_CREDENTIALS).toBe('unauthorized')
    expect(businessErrorCategoryByCode.PLATFORM_ADMIN_SELF_ROLE_CHANGE).toBe('forbidden')
    expect(mapFailure(businessFailure('AUTH_INVALID_CREDENTIALS', 'invalid username or password'))).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    })
    expect(mapFailure(businessFailure('AUTH_USERNAME_TAKEN', 'username already exists'))).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    })
    expect(() => fail('PLATFORM_ADMIN_INVALID_PAGE', '页码无效')).toThrowError(expect.objectContaining({ code: 'PLATFORM_ADMIN_INVALID_PAGE' }))
  })

  it('BusinessError 的 category 只能由中央码表派生', () => {
    expect(new BusinessError('AUTH_INVALID_CREDENTIALS', '认证失败')).toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      category: 'unauthorized',
    })
    expect(businessErrorCategoryByCode.EXPLORATION_TRACK_ASSOCIATION_READ_ONLY).toBe('validation')
    expect(businessErrorCategoryByCode.EXPLORATION_TRACK_ASSOCIATION_UNAVAILABLE).toBe('validation')
    expect(businessErrorCategoryByCode.EXPLORATION_TRACK_NORMALIZED_NAME_MISSING).toBe('internal')
    expect(businessErrorCategoryByCode.METHOD_VERSION_HISTORY_UNPROVABLE).toBe('internal')
    expect(businessErrorCategoryByCode.REVIEW_METHOD_MODE_CONFLICT).toBe('validation')
  })

  it('统一错误可以携带 CLI 所需的结构化详情，但 API 不会自动外泄', () => {
    const error = businessFailure('INITIAL_OWNER_MIXED_OWNERSHIP', '当前数据归属状态不允许初始认领', {
      userId: 'user-1',
      before: { items: { total: 1, unowned: 0, targetOwned: 0, otherOwned: 1 } },
    })
    expect(error.details).toMatchObject({ userId: 'user-1' })
    expect(mapFailure(error)).toEqual({
      status: 409,
      code: 'CONFLICT',
      message: '当前数据归属状态不允许初始认领',
    })
  })
})
