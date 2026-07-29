import type { BusinessErrorCode } from './business'

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

/**
 * businessCode 只在失败来源于领域业务规则时出现；传输层与基础设施故障没有业务语义，不带该字段。
 */
export interface ApiErrorPayload {
  code: ApiErrorCode
  message: string
  requestId: string
  businessCode?: BusinessErrorCode
}

export interface ApiErrorBody {
  error: ApiErrorPayload
}
