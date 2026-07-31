import {
  BackupApplicationService,
  DashboardApplicationService,
  ExplorationTrackApplicationService,
  ItemApplicationService,
  MethodApplicationService,
  MethodLifecycleApplicationService,
  ReviewApplicationService,
  SearchApplicationService,
  TrashApplicationService,
} from '@knowledge-base/application'
import {
  createMySqlPool,
  MySqlBackupRepository,
  MySqlDashboardRepository,
  MySqlExplorationTrackRepository,
  MySqlItemRepository,
  MySqlMethodApplicationRepository,
  MySqlMethodRepository,
  MySqlReviewRepository,
  MySqlReviewWorkflowRepository,
  MySqlSearchRepository,
  type MySqlConnectionConfig,
} from '@knowledge-base/storage-mysql'

export function createHonoServices(config: MySqlConnectionConfig) {
  const pool = createMySqlPool(config)
  const items = new MySqlItemRepository(pool)
  const methods = new MySqlMethodRepository(pool)
  const reviews = new MySqlReviewRepository(pool)
  const methodApplications = new MySqlMethodApplicationRepository(pool)
  const explorationTracks = new MySqlExplorationTrackRepository(pool)

  return {
    pool,
    items: new ItemApplicationService(items, explorationTracks),
    explorationTracks: new ExplorationTrackApplicationService(explorationTracks, explorationTracks),
    reviews: new ReviewApplicationService(reviews, methods, new MySqlReviewWorkflowRepository(pool)),
    methods: new MethodLifecycleApplicationService(methods),
    methodApplications: new MethodApplicationService(methodApplications),
    trash: new TrashApplicationService(items, methods, explorationTracks),
    search: new SearchApplicationService(new MySqlSearchRepository(pool)),
    dashboard: new DashboardApplicationService(new MySqlDashboardRepository(pool)),
    backup: new BackupApplicationService(new MySqlBackupRepository(pool)),
  }
}

export type HonoServices = ReturnType<typeof createHonoServices>
