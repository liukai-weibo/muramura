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

export type ApiEnv = {
  Variables: {
    requestId: string
  }
}

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    requestId: string
  }
}
