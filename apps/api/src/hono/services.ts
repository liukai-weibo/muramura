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
  MySqlPlatformAdministrationRepository,
  MySqlReviewRepository,
  MySqlReviewWorkflowRepository,
  MySqlSearchRepository,
  MySqlAiConversationRepository,
  MySqlAiPreferenceRepository,
  type MySqlConnectionConfig,
} from '@knowledge-base/storage-mysql'
import { createFileSecretStore, createProtectedSecretStore, SecretStoreUnavailableError, type SecretStore } from '../../../../packages/storage-secrets/src/index'
import { LoopbackProviderAdapter } from '../experimental-ai/provider'
import type { Pool } from 'mysql2/promise'

export function createRootHonoServices(config: MySqlConnectionConfig) {
  const pool = createMySqlPool(config)
  let secretStore: SecretStore
  try {
    const mode = process.env.AI_SECRET_STORE ?? 'keytar'
    if (mode === 'file') secretStore = createFileSecretStore(process.env.AI_SECRET_STORE_PATH)
    else if (mode === 'keytar') secretStore = createProtectedSecretStore('kb_ai_00000000-0000-4000-8000-000000000001')
    else throw new SecretStoreUnavailableError()
  }
  catch { secretStore = { get: async () => { throw new SecretStoreUnavailableError() }, set: async () => { throw new SecretStoreUnavailableError() }, clear: async () => { throw new SecretStoreUnavailableError() } } }
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

export function createScopedHonoServices(pool: Pool, userId?: string, aiConfig?: AiConfigManager) {
  const scope = userId ? { userId } : undefined
  const items = new MySqlItemRepository(pool, undefined, scope)
  const methods = new MySqlMethodRepository(pool, undefined, scope)
  const reviews = new MySqlReviewRepository(pool, scope)
  const methodApplications = new MySqlMethodApplicationRepository(pool, undefined, scope)
  const explorationTracks = new MySqlExplorationTrackRepository(pool, undefined, scope)
  const aiConversationRepository = userId ? new MySqlAiConversationRepository(pool, { userId }) : undefined
  const aiPreferenceRepository = userId ? new MySqlAiPreferenceRepository(pool, { userId }) : undefined
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
      new AiKnowledgeOverviewApplicationService(aiDashboard, aiExplorations, items, methods),
      aiConversationRepository,
      diagnostic => console.info('[knowledge-base-ai-latency]', diagnostic),
      aiPreferences,
    )
    : undefined
  return {
    items: new ItemApplicationService(items, explorationTracks),
    explorationTracks: new ExplorationTrackApplicationService(explorationTracks, explorationTracks),
    reviews: new ReviewApplicationService(reviews, methods, new MySqlReviewWorkflowRepository(pool, undefined, scope)),
    methods: new MethodLifecycleApplicationService(methods),
    methodApplications: new MethodApplicationService(methodApplications),
    trash: new TrashApplicationService(items, methods, explorationTracks),
    search: new SearchApplicationService(new MySqlSearchRepository(pool, undefined, scope)),
    dashboard: new DashboardApplicationService(new MySqlDashboardRepository(pool, scope)),
    backup: new BackupApplicationService(new MySqlBackupRepository(pool, undefined, scope), aiConversationRepository, aiPreferenceRepository),
    aiConfig,
    aiConversation: aiConversationRepository ? new AiConversationApplicationService(aiConversationRepository) : undefined,
    aiPreferences,
    ai,
  }
}

export type RootHonoServices = ReturnType<typeof createRootHonoServices>
export type ScopedHonoServices = ReturnType<typeof createScopedHonoServices>
