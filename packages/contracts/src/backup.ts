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
import type { DailyNote } from './daily-notes'
import type { MoodEntry } from './mood'
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
export interface BackupDataV4 extends BackupDataV3 { dailyNotes: DailyNote[] }
export interface BackupDataV5 extends BackupDataV4 {}
export interface BackupDataV6 extends BackupDataV5 { moodEntries: MoodEntry[] }

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
export interface BackupDocumentV4 { format: 'knowledge-base-backup'; version: 4; exportedAt: string; appVersion: string; data: BackupDataV4 }
export interface BackupDocumentV5 { format: 'knowledge-base-backup'; version: 5; exportedAt: string; appVersion: string; data: BackupDataV5 }
export interface BackupDocumentV6 { format: 'knowledge-base-backup'; version: 6; exportedAt: string; appVersion: string; data: BackupDataV6 }

export type BackupDocument = BackupDocumentV1 | BackupDocumentV2 | BackupDocumentV3 | BackupDocumentV4 | BackupDocumentV5 | BackupDocumentV6

export interface BackupRepository {
  exportData(): Promise<BackupData | BackupDataV3 | BackupDataV4 | BackupDataV5 | BackupDataV6>
  replaceData(data: BackupData | BackupDataV3 | BackupDataV4 | BackupDataV5 | BackupDataV6): Promise<void>
}
