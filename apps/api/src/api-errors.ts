import { BusinessError } from '@knowledge-base/domain'
import { MySqlSchemaNotReadyError } from '@knowledge-base/storage-mysql'

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND_ROUTE'
  | 'MYSQL_SCHEMA_NOT_READY'
  | 'MYSQL_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type ApiErrorStatus = 400 | 403 | 404 | 405 | 409 | 413 | 415 | 500 | 503

export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    readonly status: ApiErrorStatus,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function isMySqlUnavailable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('code' in value)) return false
  return [
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ER_ACCESS_DENIED_ERROR',
    'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  ].includes(String(value.code))
}

export function mapFailure(value: unknown): [ApiErrorStatus, ApiErrorCode, string] {
  if (value instanceof ApiError) return [value.status, value.code, value.message]
  if (value instanceof BusinessError) {
    if (value.category === 'validation') return [400, 'VALIDATION_FAILED', value.message]
    if (value.category === 'not-found') return [404, 'NOT_FOUND', value.message]
    if (value.category === 'conflict') return [409, 'CONFLICT', value.message]
    return [500, 'INTERNAL_ERROR', '本地服务当前发生未分类错误']
  }
  if (value instanceof MySqlSchemaNotReadyError) {
    return [503, 'MYSQL_SCHEMA_NOT_READY', '本地 MySQL 候选环境当前不可用']
  }
  if (isMySqlUnavailable(value)) {
    return [503, 'MYSQL_UNAVAILABLE', '本地 MySQL 候选环境当前不可用']
  }
  return [500, 'INTERNAL_ERROR', '本地服务当前发生未分类错误']
}

function shouldReportFailure(value: unknown): boolean {
  if (value instanceof ApiError) return value.status === 500
  if (value instanceof BusinessError) return value.category === 'internal'
  if (value instanceof MySqlSchemaNotReadyError) return false
  if (isMySqlUnavailable(value)) return false
  return true
}

export function reportUnexpectedFailure(requestId: string, value: unknown): void {
  if (!shouldReportFailure(value)) return
  const error = value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : { name: 'NonErrorThrown', message: String(value) }
  console.error('[knowledge-base-api] unexpected failure', { requestId, error })
}
