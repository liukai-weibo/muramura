import { describe, expect, it } from 'vitest'
import {
  AiConversationApplicationService,
  AiPreferenceApplicationService,
  DailyDietRecommendationApplicationService,
  DailyNoteApplicationService,
  DailySummaryApplicationService,
  ExplorationTrackApplicationService,
  HomeAiCardApplicationService,
  MealEntryApplicationService,
  MethodApplicationService,
  MethodLifecycleApplicationService,
  MoodEntryApplicationService,
  ReviewApplicationService,
  ScopedActivityAuditRecorder,
  SearchApplicationService,
  TrashApplicationService,
} from '@knowledge-base/application'
import type { ActivityAuditEventInput, ActivityAuditRepository, MealDayInput, MoodEntry, MoodEntryInput, MoodEntryRepository, SearchRepository, SearchResult } from '@knowledge-base/contracts'

function createRecorder(): { repository: ActivityAuditRepository; recorded: ActivityAuditEventInput[] } {
  const recorded: ActivityAuditEventInput[] = []
  const repository: ActivityAuditRepository = {
    record: async input => { recorded.push(input) },
    list: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    listAllMatches: async () => [],
  }
  return { repository, recorded }
}

const moodEntry: MoodEntry = {
  id: 'mood-1', entryDate: '2026-08-20', content: '完成了一个长期拖延的事项', moodLevel: 5, tags: ['成就感'], response: '今晚早点休息', createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
}

describe('activity audit application capture', () => {
  it('records a mood create with a post-write snapshot and the bound actor identity', async () => {
    const { repository, recorded } = createRecorder()
    const moodRepository: MoodEntryRepository = {
      listRange: async () => [moodEntry],
      create: async () => moodEntry,
      updateMine: async () => moodEntry,
      deleteMine: async () => true,
    }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-1', username: '张三' })
    const service = new MoodEntryApplicationService(moodRepository, recorder)
    await service.create({ content: '事件', moodLevel: 3, tags: ['工作'] })
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ actorUserId: 'actor-1', actorUsername: '张三', module: 'mood', action: 'create', entityId: 'mood-1' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ content: '完成了一个长期拖延的事项', moodLevel: 5 })
  })

  it('records a mood delete with the pre-read content snapshot', async () => {
    const { repository, recorded } = createRecorder()
    const moodRepository: MoodEntryRepository = {
      listRange: async () => [moodEntry],
      create: async () => moodEntry,
      updateMine: async () => moodEntry,
      deleteMine: async () => true,
    }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-2' })
    const service = new MoodEntryApplicationService(moodRepository, recorder)
    await service.deleteMine('mood-1')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ module: 'mood', action: 'delete', entityId: 'mood-1' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ content: '完成了一个长期拖延的事项' })
  })

  it('does not record a search when the query is blank', async () => {
    const { repository, recorded } = createRecorder()
    const searchRepository: SearchRepository = { search: async (): Promise<SearchResult[]> => [] }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-3' })
    const service = new SearchApplicationService(searchRepository, recorder)
    await service.search('   ')
    expect(recorded).toHaveLength(0)
  })

  it('records a non-blank search with the query in the snapshot', async () => {
    const { repository, recorded } = createRecorder()
    const searchRepository: SearchRepository = { search: async (): Promise<SearchResult[]> => [] }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-3' })
    const service = new SearchApplicationService(searchRepository, recorder)
    await service.search('  方法  ')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ module: 'search', action: 'search' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toEqual({ query: '方法' })
  })

  it('does not block the business write when the recorder throws', async () => {
    const repository: ActivityAuditRepository = {
      record: async () => { throw new Error('audit down') },
      list: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      listAllMatches: async () => [],
    }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-4' })
    const moodRepository: MoodEntryRepository = {
      listRange: async () => [],
      create: async () => moodEntry,
      updateMine: async () => moodEntry,
      deleteMine: async () => true,
    }
    const service = new MoodEntryApplicationService(moodRepository, recorder)
    await expect(service.create({ content: '事件', moodLevel: 3 })).resolves.toMatchObject({ id: 'mood-1' })
  })

  it('records a meal saveDay with a post-write summary snapshot', async () => {
    const { repository, recorded } = createRecorder()
    const mealRepository = { listRange: async () => [], saveDay: async (input: MealDayInput) => input.meals }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-5' })
    const service = new MealEntryApplicationService(mealRepository as never, recorder)
    await service.saveDay({ entryDate: '2026-08-20', meals: [{ mealType: 'breakfast', content: '鸡蛋牛奶', feeling: 4 }] })
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ module: 'meal', action: 'update', actorUserId: 'actor-5' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ entryDate: '2026-08-20' })
  })
})

describe('activity audit extended capture (phase 2)', () => {
  it('records exploration track create/rename/restore with name snapshots', async () => {
    const { repository, recorded } = createRecorder()
    const track = { id: 'track-1', name: '长期探索', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' }
    const trackRepository = {
      create: async () => ({ ...track, name: '长期探索' }),
      getById: async () => track,
      rename: async () => ({ ...track, name: '新名称' }),
      updateDescription: async () => ({ ...track, description: '描述' }),
      softDelete: async () => undefined,
      restore: async () => ({ ...track, name: '恢复名' }),
      listActive: async () => [], listSelectable: async () => [], listDeleted: async () => [], getHistory: async () => undefined, getItemContext: async () => undefined, listItemsByTrackAndStatus: async () => [],
    }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-track' })
    const service = new ExplorationTrackApplicationService(trackRepository as never, trackRepository as never, recorder)
    await service.createExplorationTrack('长期探索')
    expect(recorded[0]).toMatchObject({ module: 'exploration_track', action: 'create', entityId: 'track-1' })
    await service.renameExplorationTrack('track-1', '新名称')
    expect(recorded[1]).toMatchObject({ module: 'exploration_track', action: 'update' })
    expect(JSON.parse(recorded[1]!.snapshot!)).toMatchObject({ name: '新名称' })
    await service.restoreExplorationTrack('track-1')
    expect(recorded[2]).toMatchObject({ module: 'exploration_track', action: 'restore' })
  })

  it('records item assign/remove exploration track under item module', async () => {
    const { repository, recorded } = createRecorder()
    const trackRepository = {
      getItemContext: async () => ({ status: 'available', itemId: 'item-1', track: { id: 'track-1' } }),
      assignItemToExplorationTrack: async () => ({ status: 'available', itemId: 'item-1', track: { id: 'track-1' } }),
      removeItemFromExplorationTrack: async () => undefined,
    }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-item' })
    const service = new ExplorationTrackApplicationService(trackRepository as never, trackRepository as never, recorder)
    await service.assignItemToExplorationTrack('item-1', 'track-1')
    expect(recorded[0]).toMatchObject({ module: 'item', action: 'assign', entityId: 'item-1' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ itemId: 'item-1', trackId: 'track-1' })
    await service.removeItemFromExplorationTrack('item-1')
    expect(recorded[1]).toMatchObject({ module: 'item', action: 'remove', entityId: 'item-1' })
  })

  it('records review complete, method create and method lifecycle actions', async () => {
    const { repository, recorded } = createRecorder()
    const review = { id: 'review-1', itemId: 'item-1', actualAction: '执行', result: '成功', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' }
    const workflow = { complete: async () => ({ item: { id: 'item-1' }, review, method: undefined, createdIdea: undefined }) }
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-review' })
    const service = new ReviewApplicationService({} as never, {} as never, workflow as never, recorder)
    await service.completeReview({ itemId: 'item-1', actualAction: '执行', result: '成功' } as never)
    expect(recorded[0]).toMatchObject({ module: 'review', action: 'complete', entityId: 'review-1' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ itemId: 'item-1', actualAction: '执行', result: '成功' })

    const methodAppRepo = { createItem: async () => ({ id: 'new-item', title: '方法事项', content: '' }) }
    const methodService = new MethodApplicationService(methodAppRepo as never, recorder)
    await methodService.createItem('method-1', '方法事项')
    expect(recorded[1]).toMatchObject({ module: 'method', action: 'create', entityId: 'new-item' })
    expect(JSON.parse(recorded[1]!.snapshot!)).toMatchObject({ methodId: 'method-1', title: '方法事项' })

    const methodRepo = {
      moveToTrash: async () => undefined,
      restore: async () => ({ id: 'method-1', title: '方法一', version: 1, createdAt: 'x', updatedAt: 'x' }),
      listDeleted: async () => [], purgeDeletedBefore: async () => undefined,
    }
    const lifecycle = new MethodLifecycleApplicationService(methodRepo as never, recorder)
    await lifecycle.moveToTrash('method-1')
    expect(recorded[2]).toMatchObject({ module: 'method', action: 'delete', entityId: 'method-1' })
    await lifecycle.restore('method-1')
    expect(recorded[3]).toMatchObject({ module: 'method', action: 'restore' })
  })

  it('records trash purge per entry type', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-purge' })
    const service = new TrashApplicationService({} as never, {} as never, {} as never, { purge: async () => undefined } as never, recorder)
    await service.purge([{ type: 'item', id: 'i1' }, { type: 'method', id: 'm1' }, { type: 'exploration-track', id: 't1' }])
    expect(recorded.map((event) => [event.module, event.action, event.entityId])).toEqual([
      ['item', 'purge', 'i1'],
      ['method', 'purge', 'm1'],
      ['exploration_track', 'purge', 't1'],
    ])
  })

  it('records daily summary and daily diet upserts', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-daily' })
    const summaryRepo = { listRange: async () => [], getByDate: async () => undefined, upsertForDate: async () => ({ id: 's1', entryDate: '2026-08-25', content: '小结', createdAt: 'x' }) }
    const summaryService = new DailySummaryApplicationService(summaryRepo as never, recorder)
    await summaryService.upsertForDate({ entryDate: '2026-08-25', content: '小结' })
    expect(recorded[0]).toMatchObject({ module: 'daily_summary', action: 'update' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ entryDate: '2026-08-25' })
    const dietRepo = { listRange: async () => [], getByDate: async () => undefined, upsertForDate: async () => ({ id: 'd1', entryDate: '2026-08-25', content: '推荐', createdAt: 'x' }) }
    const dietService = new DailyDietRecommendationApplicationService(dietRepo as never, recorder)
    await dietService.upsertForDate({ entryDate: '2026-08-25', content: '推荐' })
    expect(recorded[1]).toMatchObject({ module: 'daily_diet', action: 'update' })
  })

  it('records home AI card create/update/delete and cache upsert', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-card' })
    const cardRepo = {
      list: async () => [],
      get: async () => undefined,
      create: async () => ({ id: 'card-1', cardTitle: '健身', cardTheme: 'green', cardSize: 'medium', cardPrompt: '', isHidden: false, sortIndex: 0 }),
      update: async () => ({ id: 'card-1', cardTitle: '健身2', cardTheme: 'green', cardSize: 'medium', cardPrompt: '', isHidden: false, sortIndex: 0 }),
      delete: async () => true,
      listCaches: async () => [], getCache: async () => undefined,
      upsertCache: async () => ({ id: 'cache-1', cardId: 'card-1', cacheDate: '2026-08-25', aiOutput: 'x' }),
    }
    const service = new HomeAiCardApplicationService(cardRepo as never, recorder)
    await service.create({ cardTitle: '健身', aiPrompt: '提示', cardSize: 'medium', cardTheme: 'green', refreshMode: 'daily' } as never)
    expect(recorded[0]).toMatchObject({ module: 'home_ai_card', action: 'create' })
    await service.update('card-1', { cardTitle: '健身2', aiPrompt: '提示', cardSize: 'medium', cardTheme: 'green', refreshMode: 'daily' } as never)
    expect(recorded[1]).toMatchObject({ module: 'home_ai_card', action: 'update' })
    await service.upsertCache('card-1', '2026-08-25', '输出')
    expect(recorded[2]).toMatchObject({ module: 'home_ai_card', action: 'update', entityId: 'card-1' })
    await service.delete('card-1')
    expect(recorded[3]).toMatchObject({ module: 'home_ai_card', action: 'delete' })
  })

  it('records ai preference create/update/delete without the value', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-pref' })
    const prefRepo = {
      listMine: async () => [],
      create: async () => ({ id: 'p1', key: 'response_style', value: 'v', source: 'user_confirmed', createdAt: 'x', updatedAt: 'x' }),
      updateMine: async () => ({ id: 'p1', key: 'response_style', value: 'v2', source: 'user_confirmed', createdAt: 'x', updatedAt: 'x' }),
      deleteMine: async () => true,
    }
    const service = new AiPreferenceApplicationService(prefRepo as never, recorder)
    await service.createConfirmed({ key: 'response_style', value: 'v' } as never)
    expect(recorded[0]).toMatchObject({ module: 'ai_preference', action: 'create' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ key: 'response_style' })
    await service.updateMine('p1', { key: 'response_style', value: 'v2' } as never)
    expect(recorded[1]).toMatchObject({ module: 'ai_preference', action: 'update' })
    await service.deleteMine('p1')
    expect(recorded[2]).toMatchObject({ module: 'ai_preference', action: 'delete', entityId: 'p1' })
  })

  it('records ai conversation append/create/archive/restore/delete/purge', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-ai' })
    const constr = {
      appendMessage: async () => ({ id: 'msg-1', conversationId: 'conv-1', role: 'user', content: '你好', sequence: 1, createdAt: 'x' }),
      getConversation: async () => ({ id: 'conv-1', title: '新会话', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      createConversation: async () => ({ id: 'conv-1', title: '新会话', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      updateConversationTitle: async () => ({ id: 'conv-1', title: '改标题', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      archiveConversation: async () => ({ id: 'conv-1', title: '归档', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      restoreConversation: async () => ({ id: 'conv-1', title: '恢复', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      deleteConversation: async () => ({ id: 'conv-1', title: '删除', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
      purgeConversation: async () => true,
      listConversations: async () => [], listMessages: async () => [], listMessagesPage: async () => ({ messages: [], hasMoreBefore: false }),
      getOrCreateDefault: async () => ({ id: 'conv-1', title: '默认', kind: 'general', createdAt: 'x', updatedAt: 'x' }),
    }
    const service = new AiConversationApplicationService(constr as never, recorder)
    await service.append({ conversationId: 'conv-1', role: 'user', content: '你好' } as never)
    expect(recorded[0]).toMatchObject({ module: 'ai_conversation', action: 'append', entityId: 'conv-1' })
    await service.createConversation('新会话')
    expect(recorded[1]).toMatchObject({ module: 'ai_conversation', action: 'create' })
    await service.updateConversationTitle('conv-1', '改标题')
    expect(recorded[2]).toMatchObject({ module: 'ai_conversation', action: 'update' })
    await service.archiveConversation('conv-1')
    expect(recorded[3]).toMatchObject({ module: 'ai_conversation', action: 'archive' })
    await service.restoreConversation('conv-1')
    expect(recorded[4]).toMatchObject({ module: 'ai_conversation', action: 'restore' })
    await service.deleteConversation('conv-1')
    expect(recorded[5]).toMatchObject({ module: 'ai_conversation', action: 'delete' })
    await service.purgeConversation('conv-1')
    expect(recorded[6]).toMatchObject({ module: 'ai_conversation', action: 'purge' })
  })

  it('records daily note setAiConversationId as an update', async () => {
    const { repository, recorded } = createRecorder()
    const recorder = new ScopedActivityAuditRecorder(repository, { userId: 'actor-note' })
    const noteRepo = {
      getToday: async () => undefined, listMine: async () => [], getMine: async () => undefined, listActionFactsForDate: async () => [], getOrCreateToday: async () => ({ id: 'n1', entryDate: 'x', content: '' }),
      updateMine: async () => ({ id: 'n1', entryDate: 'x', content: 'c' }), appendToday: async () => ({ id: 'n1', entryDate: 'x', content: 'c' }),
      setAiConversationId: async () => ({ id: 'n1', entryDate: 'x', content: 'c', aiConversationId: 'conv-1' }),
    }
    const service = new DailyNoteApplicationService(noteRepo as never, recorder)
    await service.setAiConversationId('n1', 'conv-1')
    expect(recorded[0]).toMatchObject({ module: 'daily_note', action: 'update', entityId: 'n1' })
    expect(JSON.parse(recorded[0]!.snapshot!)).toMatchObject({ conversationId: 'conv-1' })
  })
})

