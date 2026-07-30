import type { ApiErrorCode, ApiErrorStatus } from '../api-errors'

export type { ApiErrorCode, ApiErrorStatus } from '../api-errors'

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
