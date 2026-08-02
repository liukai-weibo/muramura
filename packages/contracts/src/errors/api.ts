import type { PublicBusinessErrorCode } from './business'

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND_ROUTE'
  | 'MYSQL_SCHEMA_NOT_READY'
  | 'MYSQL_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 500 | 503

/**
 * businessCode 只允许白名单内的统一业务码；
 * 传输层、基础设施故障，以及未入白名单的内部码（如 AUTH_INVALID_CREDENTIALS）不得出现。
 */
export interface ApiErrorPayload {
  code: ApiErrorCode
  message: string
  requestId: string
  businessCode?: PublicBusinessErrorCode
}

export interface ApiErrorBody {
  error: ApiErrorPayload
}
