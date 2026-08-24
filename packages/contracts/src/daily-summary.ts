/**
 * 每日状态小结契约：AI 每日生成一篇简短状态小结（手记/事项/复盘上下文），
 * entry_date 为本地 YYYY-MM-DD；每用户每天唯一（upsert 语义），以天为读写粒度。
 */

export const DAILY_SUMMARY_CONTENT_MAX_LENGTH = 4000

export interface DailySummary {
  id: string
  entryDate: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface DailySummaryInput {
  entryDate: string
  content: string
}

export interface DailySummaryRepository {
  listRange(from?: string, to?: string): Promise<DailySummary[]>
  getByDate(entryDate: string): Promise<DailySummary | undefined>
  upsertForDate(input: DailySummaryInput): Promise<DailySummary>
}

export interface DailySummaryBackupStore {
  exportBackup(): Promise<DailySummary[]>
  replaceBackup(values: DailySummary[]): Promise<void>
}
