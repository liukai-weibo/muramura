import type { AiConversationSummary, AiKnowledgeOverview, AiKnowledgeOverviewReader, AiPreference, AuthUser, DailyNote, DashboardSnapshot, ItemRepository, ItemStatus, MealEntryRepository, MethodRepository, MoodEntryRepository } from '@knowledge-base/contracts'
import { itemStatuses } from '@knowledge-base/contracts'
import type { DashboardApplicationService, ExplorationTrackApplicationService } from './index'
import { formatInTimeZone } from './date-utils'

export class AiKnowledgeOverviewApplicationService implements AiKnowledgeOverviewReader {
  constructor(
    private readonly dashboard: DashboardApplicationService,
    private readonly explorations: ExplorationTrackApplicationService,
    private readonly items?: ItemRepository,
    private readonly methods?: MethodRepository,
    private readonly moodEntries?: MoodEntryRepository,
    private readonly mealEntries?: MealEntryRepository,
  ) {}

  async read(user: AuthUser): Promise<AiKnowledgeOverview> {
    const [snapshot, activeTracks, deletedItems, deletedMethods, deletedTracks, moodEntries, mealEntries] = await Promise.all([
      this.dashboard.getSnapshot(),
      this.explorations.listActiveExplorationTracks(),
      this.items?.listDeleted() ?? Promise.resolve([]),
      this.methods?.listDeleted() ?? Promise.resolve([]),
      this.explorations.listDeletedExplorationTracks(),
      this.moodEntries?.listRange() ?? Promise.resolve([]),
      this.mealEntries?.listRange() ?? Promise.resolve([]),
    ])
    const itemStatusCounts = Object.fromEntries(itemStatuses.map((status) => [status, 0])) as Record<ItemStatus, number>
    snapshot.items.forEach((item) => { itemStatusCounts[item.status] += 1 })
    const recentReviews = [...snapshot.reviews].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)).slice(0, 30)
    const report = await this.dashboard.getReport('all')
    return {
      profile: { username: user.username, roles: [...user.roles], createdAt: user.createdAt },
      itemStatusCounts,
      items: snapshot.items.map(({ id, title, content, status, createdAt, updatedAt }) => ({ id, title, content, status, createdAt, updatedAt })),
      explorations: activeTracks.map(({ track, latestAssociatedItem }) => ({ id: track.id, name: track.name, ...(latestAssociatedItem ? { latestItem: latestAssociatedItem } : {}) })),
      reviews: recentReviews.map(({ id, itemId, result, createdAt }) => ({ id, itemId, result, createdAt })),
      methods: snapshot.methods.map(({ id, title, steps, version, validationCount, createdAt, updatedAt }) => ({ id, title, steps, version, validationCount, createdAt, updatedAt })),
      moodEntries: moodEntries.map(({ entryDate, moodLevel, content, createdAt }) => ({ entryDate, moodLevel, content, createdAt })),
      mealEntries: mealEntries.map(({ entryDate, mealType, content, feeling, createdAt }) => ({ entryDate, mealType, content, feeling, createdAt })),
      trash: [
        ...deletedItems.map(({ title, deletedAt }) => ({ type: 'item' as const, title, deletedAt: deletedAt! })),
        ...deletedMethods.map(({ title, deletedAt }) => ({ type: 'method' as const, title, deletedAt: deletedAt! })),
        ...deletedTracks.map(({ track }) => ({ type: 'exploration-track' as const, title: track.name, deletedAt: track.deletedAt! })),
      ].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)),
      dashboard: { metrics: report.metrics, backlog: report.backlog, unreviewedMethodActions: report.unreviewedMethodActions, facts: report.facts },
    }
  }
}

export function formatKnowledgeContext(overview: AiKnowledgeOverview | undefined, searchContext: string, summary: AiConversationSummary | undefined, preferences: AiPreference[], maxChars: number, dailyNotes: DailyNote[] = [], timeZone?: string): string {
  const clock = (iso: string | undefined): string => {
    const at = formatInTimeZone(iso, timeZone)
    return at ? ` ${at}` : ''
  }
  const sections = [
    'Server-verified read-only personal knowledge context (user data):',
    'Use only this context as user data. Do not claim to modify it.',
  ]
  if (dailyNotes.length) {
    const notes = [...dailyNotes].sort((left, right) => right.entryDate.localeCompare(left.entryDate) || right.updatedAt.localeCompare(left.updatedAt))
    sections.push(`Historical daily notes (all available dates, use only when relevant to the question; the date is authoritative):\n${notes.map((note) => `- ${note.entryDate}${clock(note.updatedAt)} | ${note.content || '(empty)'}`).join('\n')}`)
  }
  if (overview && (overview.moodEntries.length || overview.mealEntries.length)) {
    if (overview.moodEntries.length) {
      const moods = [...overview.moodEntries].sort((left, right) => left.entryDate.localeCompare(right.entryDate) || left.moodLevel - right.moodLevel)
      sections.push(`Mood entries (all available dates, date is authoritative):\n${moods.map((entry) => `- ${entry.entryDate}${clock(entry.createdAt)} | level ${entry.moodLevel} | ${entry.content.slice(0, 120)}`).join('\n')}`)
    }
    if (overview.mealEntries.length) {
      const meals = [...overview.mealEntries].sort((left, right) => left.entryDate.localeCompare(right.entryDate) || left.mealType.localeCompare(right.mealType))
      sections.push(`Meal entries (all available dates, date is authoritative):\n${meals.map((entry) => `- ${entry.entryDate}${clock(entry.createdAt)} | ${mealTypeLabel(entry.mealType)} | ${entry.content.slice(0, 80)} | feeling ${entry.feeling}`).join('\n')}`)
    }

  }
  if (overview) {
    sections.push(`Profile: username=${overview.profile.username}; accountCreatedAt=${overview.profile.createdAt}; roles=${overview.profile.roles.join(',') || 'none'}`)
    sections.push(`Authoritative knowledge base summary for numeric questions: 事项总数=${overview.items.length}; 方法总数=${overview.methods.length}; 复盘总数=${overview.reviews.length}; 探索主线总数=${overview.explorations.length}`)
    const currentStatusCodes = new Set(['doing', 'reviewed'])
    sections.push(`Authoritative current item status counts: ${Object.entries(overview.itemStatusCounts).filter(([status]) => currentStatusCodes.has(status)).map(([status, count]) => `${statusLabel(status)}=${count}`).join(', ')}`)
    sections.push(`Items (cite by title; internal IDs and machine status codes are unavailable to the assistant):\n${[...overview.items].sort((a, b) => (a.status === 'doing' ? 0 : 1) - (b.status === 'doing' ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 80).map((item) => `- ${item.title} | 状态=${statusLabel(item.status)} | updatedAt=${item.updatedAt} | ${item.content.slice(0, 240)}`).join('\n') || '- none'}`)
    sections.push(`Explorations (cite by name; internal IDs and machine status codes are unavailable to the assistant):\n${overview.explorations.slice(0, 40).map((track) => `- ${track.name}${track.latestItem ? ` | latest=${track.latestItem.title}（${statusLabel(track.latestItem.status)}）` : ''}`).join('\n') || '- none'}`)
    sections.push(`Recent reviews (cite by subject; internal IDs are unavailable to the assistant):\n${overview.reviews.slice(0, 30).map((review) => `- review record | ${review.result.slice(0, 240)}`).join('\n') || '- none'}`)
    sections.push(`Methods (cite by title; internal IDs are unavailable to the assistant):\n${overview.methods.slice(0, 40).map((method) => `- ${method.title} v${method.version} | validations=${method.validationCount} | ${method.steps.slice(0, 240)}`).join('\n') || '- none'}`)
    sections.push(`Dashboard: ${overview.dashboard.facts.map(replaceStatusCodes).join(' ')}; current status summary=进行中${overview.dashboard.backlog.doing}，已复盘${overview.itemStatusCounts.reviewed ?? 0}; homepage quick actions=快速记录（追加一条内容到当天手记）、继续推进（定位当前事项并进入下一步）、快速捕获（直接创建进行中事项）; unreviewedMethodActions=${overview.dashboard.unreviewedMethodActions}`)
    if (overview.trash) {
      const trashCounts = overview.trash.reduce((counts, entry) => { counts[entry.type] += 1; return counts }, { item: 0, method: 0, 'exploration-track': 0 } as Record<'item' | 'method' | 'exploration-track', number>)
      sections.push(`Authoritative recycle bin counts (server-calculated): 事项=${trashCounts.item}，方法=${trashCounts.method}，探索主线=${trashCounts['exploration-track']}，合计=${overview.trash.length}。Only these counts may be used for numeric answers. Do not calculate counts from titles.`)
      sections.push(`Recycle bin titles (labels only, not counts; a numeric-looking title such as “111” or “1” is still just a title):\n${overview.trash.slice(0, 80).map((entry) => `- ${trashTypeLabel(entry.type)}：标题“${entry.title}” | deletedAt=${entry.deletedAt}`).join('\n') || '- none'}`)
    }
  }
  if (summary?.content) sections.push(`Server-owned derived conversation summary (not a business record; original messages remain authoritative):\n${summary.content}`)
  if (preferences.length) sections.push(`Confirmed user preferences (explicitly saved by the user; not business facts):\n${preferences.map((preference) => `- ${preference.key}: ${preference.value}`).join('\n')}`)
  if (searchContext) sections.push(`Search matches for the latest question:\n${searchContext}`)
  const output: string[] = []
  let remaining = maxChars
  for (const section of sections) {
    if (remaining <= 0) break
    const separator = output.length ? '\n\n' : ''
    const available = remaining - separator.length
    if (available <= 0) break
    const content = section.length > available ? `${section.slice(0, Math.max(0, available - 32))}\n[…knowledge context truncated…]` : section
    output.push(`${separator}${content}`)
    remaining -= separator.length + content.length
  }
  return `${output.join('')}\n\n`
}


function mealTypeLabel(type: string): string {
  return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as Record<string, string>)[type] ?? type
}

function statusLabel(status: string): string {
  return ({ doing: '进行中', reviewed: '已复盘' } as Record<string, string>)[status] ?? '历史状态'
}

function replaceStatusCodes(value: string): string {
  return value.replace(/\bdoing\b/g, '进行中').replace(/\breviewed\b/g, '已复盘')
}

function trashTypeLabel(type: string): string {
  return ({ item: '事项', method: '方法', 'exploration-track': '探索主线' } as Record<string, string>)[type] ?? '记录'
}
