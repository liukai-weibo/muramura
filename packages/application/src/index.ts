/**
 * Application 包的稳定公共入口。
 *
 * 具体服务按业务能力组织；包外消费者继续从
 * `@knowledge-base/application` 导入，不依赖内部物理路径。
 */
export {
  AUTH_SESSION_DURATION_MS,
  AuthenticationApplicationService,
  InitialOwnerClaimApplicationService,
  InitialPlatformAdminApplicationService,
  PlatformAdministrationApplicationService,
} from './access'
export { BackupApplicationService, parseAndValidateBackup } from './backup'
export {
  ExplorationTrackApplicationService,
  ItemApplicationService,
  type CaptureIdeaInput,
  type ItemAction,
} from './items-and-tracks'
export {
  MethodApplicationService,
  MethodLifecycleApplicationService,
  ReviewApplicationService,
} from './reviews-and-methods'
export { buildDashboardReport, DashboardApplicationService, SearchApplicationService } from './read-models'
export { sortTrashEntries, TRASH_RETENTION_DAYS, TrashApplicationService } from './trash'
export {
  AiChatApplicationService,
  AiConfigError,
  AiConfigManager,
  AiConversationApplicationService,
  buildAiSystemMessage,
  type AiLatencyDiagnostic,
  type AiProvider,
  aiChatCompletionsUrl,
} from './experimental-ai'
export { AiKnowledgeOverviewApplicationService, formatKnowledgeContext } from './ai-context'
export { AiPreferenceApplicationService } from './ai-preferences'
export { DailyNoteApplicationService } from './daily-notes'
export { MealEntryApplicationService } from './meals'
export { MoodEntryApplicationService } from './mood'
export { DailySummaryApplicationService } from './daily-summaries'
export { DailyDietRecommendationApplicationService } from './daily-diet'
export { HomeAiCardApplicationService } from './home-ai-cards'
export { ScopedActivityAuditRecorder, safeAuditRecord } from './audit'
