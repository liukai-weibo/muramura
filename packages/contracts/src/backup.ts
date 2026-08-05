import type {
  ExplorationTrack,
  Item,
  ItemLink,
  ItemStatusEvent,
} from './items-and-tracks'
import type {
  Method,
  MethodApplication,
  MethodEvidence,
  MethodTombstone,
  MethodVersion,
  Review,
} from './reviews-and-methods'
import type { AiConversationSnapshot, AiPreference } from './ai'
/**
 * 备份文档是跨版本的持久化契约。旧版本继续保留原始形状，新增版本只能通过
 * 新的判别值扩展，恢复方不得根据展示文本推断缺失的可信字段。
 * 失败使用统一 BusinessErrorCode（如 BACKUP_OWNERSHIP_CONFLICT）。
 */

export interface BackupData {
  items: Item[]
  reviews: Review[]
  methods: Method[]
  methodEvidence: MethodEvidence[]
  methodVersions: MethodVersion[]
  methodApplications: MethodApplication[]
  itemStatusEvents: ItemStatusEvent[]
  itemLinks: ItemLink[]
  methodTombstones: MethodTombstone[]
  aiConversations?: AiConversationSnapshot[]
  aiPreferences?: AiPreference[]
}

/**
 * V3 持久化规范名，恢复时直接采用可信键，不再从展示名称重新推断。
 */
export interface BackupExplorationTrack extends ExplorationTrack {
  normalizedName: string
}

export interface BackupDataV3 extends BackupData {
  explorationTracks: BackupExplorationTrack[]
}

export interface BackupDocumentV1 {
  format: 'knowledge-base-backup'
  version: 1
  exportedAt: string
  appVersion: string
  data: Omit<BackupData, 'methodTombstones'> & { methodTombstones?: MethodTombstone[] }
}

export interface BackupDocumentV2 {
  format: 'knowledge-base-backup'
  version: 2
  exportedAt: string
  appVersion: string
  data: BackupData
}

export interface BackupDocumentV3 {
  format: 'knowledge-base-backup'
  version: 3
  exportedAt: string
  appVersion: string
  data: BackupDataV3
}

export type BackupDocument = BackupDocumentV1 | BackupDocumentV2 | BackupDocumentV3

export interface BackupRepository {
  exportData(): Promise<BackupData | BackupDataV3>
  replaceData(data: BackupData | BackupDataV3): Promise<void>
}
