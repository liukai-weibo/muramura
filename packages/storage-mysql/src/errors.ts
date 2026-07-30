import {
  BusinessError,
  type BusinessErrorCategory,
  type BusinessErrorCode,
} from '@knowledge-base/domain'

export function businessError(
  code: BusinessErrorCode,
  category: BusinessErrorCategory,
  message: string,
): BusinessError {
  return new BusinessError(code, category, message)
}

export function rethrowDuplicateAsBusinessError(
  error: unknown,
  code: BusinessErrorCode,
  message: string,
): never {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ER_DUP_ENTRY'
  ) {
    throw businessError(code, 'conflict', message)
  }
  throw error
}
