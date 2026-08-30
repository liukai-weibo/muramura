import type { AuthUser } from './access'
import type { MealEntry } from './meals'
import type { MoodEntry } from './mood'
import type { Item } from './items-and-tracks'
import type { Review } from './reviews-and-methods'
import type { Method } from './reviews-and-methods'
import type { DashboardReport, TrashEntry } from './read-models'

export interface AiConfigMetadata {
  serviceName: string
  modelName: string
  baseUrl: string
  apiKeyConfigured: boolean
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
}

export interface AiConfigInput {
  serviceName: string
  modelName: string
  baseUrl: string
  apiKey: string
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
}

export interface AiChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export type AiPersonalityMode = 'warm_coach' | 'strong_strategist'
export interface AiChatRequest { messages: AiChatMessage[]; conversationId?: string; personalityMode?: AiPersonalityMode }
export type AiConversationMessageStatus = 'completed' | 'incomplete' | 'aborted' | 'error'
export type AiConversationKind = 'general' | 'daily_note'
export interface AiConversation { id: string; title: string; kind?: AiConversationKind; createdAt: string; updatedAt: string; archivedAt?: string; deletedAt?: string; summary?: AiConversationSummary }
export interface AiConversationSummary { content: string; version: number; throughSequence: number; updatedAt: string }
export interface AiConversationMessage { id: string; conversationId: string; sequence: number; role: 'user' | 'assistant'; status: AiConversationMessageStatus; content: string; createdAt: string }
export interface AiConversationSnapshot { conversation: AiConversation; messages: AiConversationMessage[]; hasMoreBefore?: boolean; beforeSequence?: number }
export interface AiConversationBackupStore {
  exportBackup(): Promise<AiConversationSnapshot[]>
  replaceBackup(value: AiConversationSnapshot[]): Promise<void>
}
export interface AiConversationRepository {
  getOrCreateDefault(): Promise<AiConversation>
  getDefault(): Promise<AiConversation | undefined>
  listConversations?(includeDeleted?: boolean): Promise<AiConversation[]>
  createConversation?(title: string, kind?: AiConversationKind): Promise<AiConversation>
  getConversation?(id: string, includeDeleted?: boolean): Promise<AiConversation | undefined>
  updateConversationTitle?(id: string, title: string): Promise<AiConversation | undefined>
  archiveConversation?(id: string): Promise<AiConversation | undefined>
  restoreConversation?(id: string): Promise<AiConversation | undefined>
  deleteConversation?(id: string): Promise<AiConversation | undefined>
  purgeConversation?(id: string): Promise<boolean>
  listMessages(conversationId: string): Promise<AiConversationMessage[]>
  listMessagesPage?(conversationId: string, input: { limit: number; beforeSequence?: number }): Promise<{ messages: AiConversationMessage[]; hasMoreBefore: boolean }>
  appendMessage(input: { conversationId: string; role: 'user' | 'assistant'; status: AiConversationMessageStatus; content: string; createdAt?: string }): Promise<AiConversationMessage>
  updateSummary(conversationId: string, summary: AiConversationSummary): Promise<void>
}
export interface AiKnowledgeOverview {
  profile: Pick<AuthUser, 'username' | 'roles' | 'createdAt'>
  itemStatusCounts: Record<string, number>
  items: Array<Pick<Item, 'id' | 'title' | 'content' | 'status' | 'createdAt' | 'updatedAt' | 'explorationTrackId'> & { lastDoingAt?: string; recentDoingCount30d?: number; lastReviewedAt?: string }>
  explorations: Array<{ id: string; name: string; latestItem?: Pick<Item, 'id' | 'title' | 'status' | 'createdAt'>; itemCount: number; doingCount: number; recentActivityCount30d: number; lastActivityAt?: string; reviewedCount30d: number; derivedMethodCount: number }>
  reviews: Array<Pick<Review, 'id' | 'itemId' | 'result' | 'createdAt'>>
  methods: Array<Pick<Method, 'id' | 'title' | 'steps' | 'version' | 'validationCount' | 'createdAt' | 'updatedAt'>>
  trash?: Array<Pick<TrashEntry, 'type' | 'title' | 'deletedAt'>>
  moodEntries: Array<Pick<MoodEntry, 'entryDate' | 'moodLevel' | 'content' | 'createdAt'>>
  mealEntries: Array<Pick<MealEntry, 'entryDate' | 'mealType' | 'content' | 'feeling' | 'createdAt'>>
  dashboard: Pick<DashboardReport, 'metrics' | 'backlog' | 'unreviewedMethodActions' | 'facts'>
}
export interface AiKnowledgeOverviewReader { read(user: AuthUser): Promise<AiKnowledgeOverview> }
export const aiPreferenceKeys = ['response_style', 'response_length', 'working_style', 'custom_rule'] as const
export type AiPreferenceKey = (typeof aiPreferenceKeys)[number]
export interface AiPreference { id: string; key: AiPreferenceKey; value: string; source: 'user_confirmed'; createdAt: string; updatedAt: string }
export interface AiPreferenceInput { key: AiPreferenceKey; value: string }
export interface AiPreferenceRepository {
  listMine(): Promise<AiPreference[]>
  create(input: { id: string; key: AiPreferenceKey; value: string; source: 'user_confirmed'; createdAt: string; updatedAt: string }): Promise<AiPreference>
  updateMine(id: string, input: { key: AiPreferenceKey; value: string; updatedAt: string }): Promise<AiPreference | undefined>
  deleteMine(id: string): Promise<boolean>
}
export interface AiPreferenceBackupStore {
  exportBackup(): Promise<AiPreference[]>
  replaceBackup(value: AiPreference[]): Promise<void>
}
export type AiStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'done' }
  | { type: 'incomplete'; reason: 'length' | 'stream-ended' }
  | { type: 'error'; code: 'AI_CONFIG_UNAVAILABLE' | 'AI_PROVIDER_TIMEOUT' | 'AI_STREAM_FAILED'; message: string; requestId?: string }
