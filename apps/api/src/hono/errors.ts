import type { BusinessErrorCode } from '@knowledge-base/contracts'
import type { Context } from 'hono'
import { ApiError } from '../api-errors'
import type { ApiEnv, ApiErrorBody, ApiErrorCode, ApiErrorStatus } from './types'

export { ApiError }
export { mapFailure } from '../api-errors'

export function validationError(message: string): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', message)
}

export function errorResponse(
  context: Context<ApiEnv>,
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
  businessCode?: BusinessErrorCode,
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: context.get('requestId'),
      ...(businessCode ? { businessCode } : {}),
    },
  }
  return context.json(body, status)
}
