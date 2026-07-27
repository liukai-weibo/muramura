export { openKnowledgeDatabase, probeDatabaseWritable } from './database'
export type { OpenKnowledgeDatabaseOptions, SqliteKnowledgeDatabase } from './database'
export { SqliteStorageOpenError } from './errors'
export type { SqliteStorageOpenErrorCode } from './errors'
export { SQLITE_SCHEMA_VERSION } from './schema'
export { SqliteItemRepository } from './item-repository'
export { SqliteReviewRepository } from './review-repository'
export { SqliteBackupRepository } from './backup-repository'

export { SqliteMethodRepository } from './method-repository'
export { SqliteMethodApplicationRepository } from './method-application-repository'
export { SqliteReviewWorkflowRepository } from './review-workflow-repository'
export { SqliteSearchRepository } from './search-repository'
export { SqliteDashboardRepository } from './dashboard-repository'

import type { BackupRepository, DashboardRepository, ItemRepository, MethodApplicationRepository, MethodRepository, ReviewRepository, ReviewWorkflowRepository, SearchRepository } from '@knowledge-base/contracts'
import { openKnowledgeDatabase, type SqliteKnowledgeDatabase } from './database'
import { SqliteBackupRepository } from './backup-repository'
import { SqliteItemRepository } from './item-repository'
import { SqliteReviewRepository } from './review-repository'
import { SqliteMethodRepository } from './method-repository'
import { SqliteMethodApplicationRepository } from './method-application-repository'
import { SqliteReviewWorkflowRepository } from './review-workflow-repository'
import { SqliteSearchRepository } from './search-repository'
import { SqliteDashboardRepository } from './dashboard-repository'

export interface SqliteS2RepositoryBundle {
  database: SqliteKnowledgeDatabase
  itemRepository: ItemRepository
  reviewRepository: ReviewRepository
  backupRepository: BackupRepository
}

export interface SqliteS3RepositoryBundle extends SqliteS2RepositoryBundle {
  methodRepository: MethodRepository
  methodApplicationRepository: MethodApplicationRepository
}

export interface SqliteS4RepositoryBundle extends SqliteS3RepositoryBundle {
  reviewWorkflowRepository: ReviewWorkflowRepository
  searchRepository: SearchRepository
  dashboardRepository: DashboardRepository
}

export function createSqliteS4Repository(databasePath: string): SqliteS4RepositoryBundle {
  const database = openKnowledgeDatabase({ databasePath })
  return {
    database,
    itemRepository: new SqliteItemRepository(database),
    reviewRepository: new SqliteReviewRepository(database),
    backupRepository: new SqliteBackupRepository(database),
    methodRepository: new SqliteMethodRepository(database),
    methodApplicationRepository: new SqliteMethodApplicationRepository(database),
    reviewWorkflowRepository: new SqliteReviewWorkflowRepository(database),
    searchRepository: new SqliteSearchRepository(database),
    dashboardRepository: new SqliteDashboardRepository(database),
  }
}

export function createSqliteS2Repository(databasePath: string): SqliteS2RepositoryBundle {
  const database = openKnowledgeDatabase({ databasePath })
  return {
    database,
    itemRepository: new SqliteItemRepository(database),
    reviewRepository: new SqliteReviewRepository(database),
    backupRepository: new SqliteBackupRepository(database),
  }
}

export function createSqliteS3Repository(databasePath: string): SqliteS3RepositoryBundle {
  const database = openKnowledgeDatabase({ databasePath })
  return {
    database,
    itemRepository: new SqliteItemRepository(database),
    reviewRepository: new SqliteReviewRepository(database),
    backupRepository: new SqliteBackupRepository(database),
    methodRepository: new SqliteMethodRepository(database),
    methodApplicationRepository: new SqliteMethodApplicationRepository(database),
  }
}
