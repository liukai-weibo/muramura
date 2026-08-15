export interface DailyNote {
  id: string
  entryDate: string
  content: string
  aiConversationId?: string
  createdAt: string
  updatedAt: string
}

export const dailyNoteAiCommands = ['emotion', 'daily_actions', 'improve_writing', 'extract_todos', 'resistance'] as const
export type DailyNoteAiCommand = (typeof dailyNoteAiCommands)[number]
export interface DailyNoteTodoCandidate { id: string; title: string; content?: string }
export interface DailyNoteActionFact { id: string; title: string; content: string; createdAt: string; statusEvents: Array<{ toStatus: string; createdAt: string }> }

export interface DailyNoteRepository {
  getToday(): Promise<DailyNote | undefined>
  getOrCreateToday(): Promise<DailyNote>
  listMine(): Promise<DailyNote[]>
  updateMine(id: string, content: string): Promise<DailyNote | undefined>
  appendToday(content: string): Promise<DailyNote>
  getMine(id: string): Promise<DailyNote | undefined>
  setAiConversationId(id: string, conversationId?: string): Promise<DailyNote | undefined>
  listActionFactsForDate(entryDate: string): Promise<DailyNoteActionFact[]>
}

export interface DailyNoteBackupStore {
  exportBackup(): Promise<DailyNote[]>
  replaceBackup(values: DailyNote[]): Promise<void>
}
