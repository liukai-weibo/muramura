export type SqliteStorageOpenErrorCode =
  | 'directory-unavailable'
  | 'database-open-failed'
  | 'schema-migration-failed'
  | 'integrity-check-failed'

export class SqliteStorageOpenError extends Error {
  constructor(
    readonly code: SqliteStorageOpenErrorCode,
    readonly databasePath: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SqliteStorageOpenError'
  }
}
