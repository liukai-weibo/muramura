import type { Context } from 'hono'
export { ApiError } from '../api-errors'
export { mapFailure } from '../api-errors'
import type { ApiEnv, ApiErrorBody, ApiErrorCode, ApiErrorStatus } from './types'

export function errorResponse(
  context: Context<ApiEnv>,
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: context.get('requestId'),
    },
  }
  return context.json(body, status)
}
