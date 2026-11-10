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
import type { DailyNote, DailyNoteEntry } from './daily-notes'
import type { MealEntry } from './meals'
import type { MoodEntry } from './mood'
import type { DailySummary } from './daily-summary'
import type { DailyDietRecommendation } from './daily-diet'
import type { HomeAiCard, HomeAiCardCache } from './home-ai-card'
import type { SleepEntry } from './sleep'
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
export interface BackupDataV7 extends BackupDataV6 { mealEntries: MealEntry[] }
export interface BackupDataV8 extends BackupDataV7 { dailySummaries: DailySummary[] }
export interface BackupDataV9 extends BackupDataV8 { dailyDietRecommendations: DailyDietRecommendation[] }
export interface BackupDataV10 extends BackupDataV9 { homeAiCards: HomeAiCard[]; homeAiCardCaches: HomeAiCardCache[] }
/** V11：手记条目化，dailyNotes 只存日期与 AI 会话，正文改由 dailyNoteEntries 承载。 */
export interface BackupDataV11 extends BackupDataV10 { dailyNoteEntries: DailyNoteEntry[] }
/** V12：睡眠记录（起床时间可能为空，表示还没记起床）。 */
export interface BackupDataV12 extends BackupDataV11 { sleepEntries: SleepEntry[] }
/** V13：睡眠改为「当天起床 + 当天入睡」，单条记录不再跨天；旧 V12 在恢复时自动拆分。 */
export interface BackupDataV13 extends BackupDataV12 {}

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
export interface BackupDocumentV7 { format: 'knowledge-base-backup'; version: 7; exportedAt: string; appVersion: string; data: BackupDataV7 }
export interface BackupDocumentV8 { format: 'knowledge-base-backup'; version: 8; exportedAt: string; appVersion: string; data: BackupDataV8 }
export interface BackupDocumentV9 { format: 'knowledge-base-backup'; version: 9; exportedAt: string; appVersion: string; data: BackupDataV9 }
export interface BackupDocumentV10 { format: 'knowledge-base-backup'; version: 10; exportedAt: string; appVersion: string; data: BackupDataV10 }
export interface BackupDocumentV11 { format: 'knowledge-base-backup'; version: 11; exportedAt: string; appVersion: string; data: BackupDataV11 }
export interface BackupDocumentV12 { format: 'knowledge-base-backup'; version: 12; exportedAt: string; appVersion: string; data: BackupDataV12 }
export interface BackupDocumentV13 { format: 'knowledge-base-backup'; version: 13; exportedAt: string; appVersion: string; data: BackupDataV13 }

export type BackupDocument = BackupDocumentV1 | BackupDocumentV2 | BackupDocumentV3 | BackupDocumentV4 | BackupDocumentV5 | BackupDocumentV6 | BackupDocumentV7 | BackupDocumentV8 | BackupDocumentV9 | BackupDocumentV10 | BackupDocumentV11 | BackupDocumentV12 | BackupDocumentV13

export interface BackupRepository {
  exportData(): Promise<BackupData | BackupDataV3 | BackupDataV4 | BackupDataV5 | BackupDataV6 | BackupDataV7 | BackupDataV8 | BackupDataV9 | BackupDataV10 | BackupDataV11 | BackupDataV12 | BackupDataV13>
  replaceData(data: BackupData | BackupDataV3 | BackupDataV4 | BackupDataV5 | BackupDataV6 | BackupDataV7 | BackupDataV8 | BackupDataV9 | BackupDataV10 | BackupDataV11 | BackupDataV12 | BackupDataV13): Promise<void>
}
