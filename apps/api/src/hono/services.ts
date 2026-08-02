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
  type MySqlConnectionConfig,
} from '@knowledge-base/storage-mysql'
import type { Pool } from 'mysql2/promise'

export function createRootHonoServices(config: MySqlConnectionConfig) {
  const pool = createMySqlPool(config)
  return {
    pool,
    config,
    auth: new AuthenticationApplicationService(new MySqlAuthRepository(pool)),
    platformAdministration: new PlatformAdministrationApplicationService(new MySqlPlatformAdministrationRepository(pool)),
    ...createScopedHonoServices(pool),
  }
}

export function createScopedHonoServices(pool: Pool, userId?: string) {
  const scope = userId ? { userId } : undefined
  const items = new MySqlItemRepository(pool, undefined, scope)
  const methods = new MySqlMethodRepository(pool, undefined, scope)
  const reviews = new MySqlReviewRepository(pool, scope)
  const methodApplications = new MySqlMethodApplicationRepository(pool, undefined, scope)
  const explorationTracks = new MySqlExplorationTrackRepository(pool, undefined, scope)
  return {
    items: new ItemApplicationService(items, explorationTracks),
    explorationTracks: new ExplorationTrackApplicationService(explorationTracks, explorationTracks),
    reviews: new ReviewApplicationService(reviews, methods, new MySqlReviewWorkflowRepository(pool, undefined, scope)),
    methods: new MethodLifecycleApplicationService(methods),
    methodApplications: new MethodApplicationService(methodApplications),
    trash: new TrashApplicationService(items, methods, explorationTracks),
    search: new SearchApplicationService(new MySqlSearchRepository(pool, undefined, scope)),
    dashboard: new DashboardApplicationService(new MySqlDashboardRepository(pool, scope)),
    backup: new BackupApplicationService(new MySqlBackupRepository(pool, undefined, scope)),
  }
}

export type RootHonoServices = ReturnType<typeof createRootHonoServices>
export type ScopedHonoServices = ReturnType<typeof createScopedHonoServices>
/** @deprecated 使用 RootHonoServices；保留别名避免旧 import 断裂 */
export type HonoServices = RootHonoServices

export function createHonoServices(config: MySqlConnectionConfig) {
  return createRootHonoServices(config)
}
