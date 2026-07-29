import type { BackupErrorCode } from './backup'
import type { ExplorationTrackErrorCode } from './exploration-track'
import type { ItemErrorCode } from './item'
import type { MethodErrorCode } from './method'
import type { ReviewErrorCode } from './review'

export type BusinessErrorCode =
  | BackupErrorCode
  | ExplorationTrackErrorCode
  | ItemErrorCode
  | MethodErrorCode
  | ReviewErrorCode
