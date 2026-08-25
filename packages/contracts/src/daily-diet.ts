/**
 * 今日饮食推荐契约：AI 每日生成一篇简短今日推荐（基于全局知识，不限于饮食），
 * entry_date 为本地 YYYY-MM-DD；每用户每天唯一（upsert 语义），以天为读写粒度。
 */

export const DAILY_DIET_CONTENT_MAX_LENGTH = 1200

export interface DailyDietRecommendation {
  id: string
  entryDate: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface DailyDietRecommendationInput {
  entryDate: string
  content: string
}

export interface DailyDietRecommendationRepository {
  listRange(from?: string, to?: string): Promise<DailyDietRecommendation[]>
  getByDate(entryDate: string): Promise<DailyDietRecommendation | undefined>
  upsertForDate(input: DailyDietRecommendationInput): Promise<DailyDietRecommendation>
}

export interface DailyDietRecommendationBackupStore {
  exportBackup(): Promise<DailyDietRecommendation[]>
  replaceBackup(values: DailyDietRecommendation[]): Promise<void>
}
