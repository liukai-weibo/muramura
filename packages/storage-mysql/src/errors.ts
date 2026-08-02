import {
  BusinessError,
  type BusinessErrorCode,
} from '@knowledge-base/domain'

export function businessError(
  code: BusinessErrorCode,
  message: string,
): BusinessError {
  return new BusinessError(code, message)
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
    throw businessError(code, message)
  }
  throw error
}
