import type { AuthUser } from '@knowledge-base/contracts'
import type { ScopedHonoServices } from './services'

export type {
  ApiErrorBody,
  ApiErrorCode,
  ApiErrorPayload,
  ApiErrorStatus,
} from '@knowledge-base/contracts'

export type ApiEnv = {
  Variables: {
    requestId: string
    actor?: AuthUser
    services?: ScopedHonoServices
  }
}
