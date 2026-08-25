import {
  AuthenticationApplicationService,
  BackupApplicationService,
  DashboardApplicationService,
  ExplorationTrackApplicationService,
  ItemApplicationService,
  MethodApplicationService,
  MethodLifecycleApplicationService,
  PlatformAdministrationApplicationService,
  ReviewApplicationService,
  SearchApplicationService,
  TrashApplicationService,
  AiChatApplicationService,
  AiConfigManager,
  AiConversationApplicationService,
  AiKnowledgeOverviewApplicationService,
  AiPreferenceApplicationService,
  DailyNoteApplicationService,
  MealEntryApplicationService,
  MoodEntryApplicationService,
  DailySummaryApplicationService,
  DailyDietRecommendationApplicationService,
} from '@knowledge-base/application'
import {
  createMySqlPool,
  MySqlAuthRepository,
  MySqlBackupRepository,
  MySqlDashboardRepository,
  MySqlExplorationTrackRepository,
  MySqlItemRepository,
  MySqlMethodApplicationRepository,
  MySqlMethodRepository,
  MySqlTrashPurgeRepository,
  MySqlPlatformAdministrationRepository,
  MySqlReviewRepository,
  MySqlReviewWorkflowRepository,
  MySqlSearchRepository,
  MySqlAiConversationRepository,
  MySqlAiPreferenceRepository,
  MySqlDailyNoteRepository,
  MySqlMealEntryRepository,
  MySqlMoodEntryRepository,
  MySqlDailySummaryRepository,
  MySqlDailyDietRecommendationRepository,
  type MySqlConnectionConfig,
} from '@knowledge-base/storage-mysql'
import { createFileSecretStore, createProtectedSecretStore, SecretStoreUnavailableError, type SecretStore } from '../../../../packages/storage-secrets/src/index'
import { LoopbackProviderAdapter } from '../experimental-ai/provider'
import type { Pool } from 'mysql2/promise'

export function createRootHonoServices(config: MySqlConnectionConfig) {
  const pool = createMySqlPool(config)
  const secretStore = createSecretStore('kb_ai_00000000-0000-4000-8000-000000000001', process.env.AI_SECRET_STORE_PATH)
  const aiConfig = new AiConfigManager(secretStore)
  return {
    pool,
    config,
    auth: new AuthenticationApplicationService(new MySqlAuthRepository(pool)),
    platformAdministration: new PlatformAdministrationApplicationService(new MySqlPlatformAdministrationRepository(pool)),
    ...createScopedHonoServices(pool, undefined, aiConfig),
    aiConfig,
  }
}

function createSecretStore(name: string, filePath?: string): SecretStore {
  try {
    const mode = process.env.AI_SECRET_STORE ?? 'keytar'
    if (mode === 'file') return createFileSecretStore(filePath ?? `.secrets/${name}.json`)
    if (mode === 'keytar') return createProtectedSecretStore(name)
    throw new SecretStoreUnavailableError()
  } catch {
    return { get: async () => { throw new SecretStoreUnavailableError() }, set: async () => { throw new SecretStoreUnavailableError() }, clear: async () => { throw new SecretStoreUnavailableError() } }
  }
}

export function createScopedHonoServices(pool: Pool, userId?: string, aiConfig?: AiConfigManager) {
  const scope = userId ? { userId } : undefined
  const items = new MySqlItemRepository(pool, undefined, scope)
  const methods = new MySqlMethodRepository(pool, undefined, scope)
  const reviews = new MySqlReviewRepository(pool, scope)
  const methodApplications = new MySqlMethodApplicationRepository(pool, undefined, scope)
  const explorationTracks = new MySqlExplorationTrackRepository(pool, undefined, scope)
  const trashPurge = new MySqlTrashPurgeRepository(pool, scope)
  const aiConversationRepository = userId ? new MySqlAiConversationRepository(pool, { userId }) : undefined
  const aiPreferenceRepository = userId ? new MySqlAiPreferenceRepository(pool, { userId }) : undefined
  const dailyNoteRepository = userId ? new MySqlDailyNoteRepository(pool, { userId }) : undefined
  const moodEntryRepository = userId ? new MySqlMoodEntryRepository(pool, { userId }) : undefined
  const mealEntryRepository = userId ? new MySqlMealEntryRepository(pool, { userId }) : undefined
  const dailySummaryRepository = userId ? new MySqlDailySummaryRepository(pool, { userId }) : undefined
  const dailyDietRepository = userId ? new MySqlDailyDietRecommendationRepository(pool, { userId }) : undefined
  const aiDashboard = new DashboardApplicationService(new MySqlDashboardRepository(pool, scope))
  const aiExplorations = new ExplorationTrackApplicationService(explorationTracks, explorationTracks)
  const aiItems = new ItemApplicationService(items, explorationTracks)
  const aiMethods = new MethodLifecycleApplicationService(methods)
  const aiPreferences = aiPreferenceRepository ? new AiPreferenceApplicationService(aiPreferenceRepository) : undefined
  const ai = userId && aiConfig && aiConversationRepository && aiPreferenceRepository
    ? new AiChatApplicationService(
      aiConfig,
      new SearchApplicationService(new MySqlSearchRepository(pool, undefined, scope)),
      new LoopbackProviderAdapter(),
      new AiKnowledgeOverviewApplicationService(aiDashboard, aiExplorations, items, methods, moodEntryRepository, mealEntryRepository),
      aiConversationRepository,
      diagnostic => console.info('[knowledge-base-ai-latency]', diagnostic),
      aiPreferences,
      dailyNoteRepository,
    )
    : undefined
  return {
    items: new ItemApplicationService(items, explorationTracks),
    explorationTracks: new ExplorationTrackApplicationService(explorationTracks, explorationTracks),
    reviews: new ReviewApplicationService(reviews, methods, new MySqlReviewWorkflowRepository(pool, undefined, scope)),
    methods: new MethodLifecycleApplicationService(methods),
    methodApplications: new MethodApplicationService(methodApplications),
    trash: new TrashApplicationService(items, methods, explorationTracks, trashPurge),
    search: new SearchApplicationService(new MySqlSearchRepository(pool, undefined, scope)),
    dashboard: new DashboardApplicationService(new MySqlDashboardRepository(pool, scope)),
    backup: new BackupApplicationService(new MySqlBackupRepository(pool, undefined, scope), aiConversationRepository, aiPreferenceRepository, dailyNoteRepository, moodEntryRepository, mealEntryRepository, dailySummaryRepository, dailyDietRepository),
    dailyNotes: dailyNoteRepository ? new DailyNoteApplicationService(dailyNoteRepository) : undefined,
    moodEntries: moodEntryRepository ? new MoodEntryApplicationService(moodEntryRepository) : undefined,
    meals: mealEntryRepository ? new MealEntryApplicationService(mealEntryRepository) : undefined,
    dailySummaries: dailySummaryRepository ? new DailySummaryApplicationService(dailySummaryRepository) : undefined,
    dailyDiet: dailyDietRepository ? new DailyDietRecommendationApplicationService(dailyDietRepository) : undefined,
    aiConfig,
    aiConversation: aiConversationRepository ? new AiConversationApplicationService(aiConversationRepository) : undefined,
    aiPreferences,
    ai,
  }
}

export type RootHonoServices = ReturnType<typeof createRootHonoServices>
export type ScopedHonoServices = ReturnType<typeof createScopedHonoServices>
