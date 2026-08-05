import type {
  DashboardReport,
  DashboardRepository,
  DashboardSnapshot,
  DashboardWindow,
  SearchRepository,
  SearchResult,
} from '@knowledge-base/contracts'

export class DashboardApplicationService {
  constructor(private readonly repository: DashboardRepository) {}

  getSnapshot(): Promise<DashboardSnapshot> {
    return this.repository.getSnapshot()
  }

  async getReport(window: DashboardWindow, now = new Date()): Promise<DashboardReport> {
    const snapshot = await this.repository.getSnapshot()
    return buildDashboardReport(snapshot, window, now)
  }
}

/** 只根据快照、窗口和显式时间计算读模型，不访问 Repository。 */
export function buildDashboardReport(snapshot: DashboardSnapshot, window: DashboardWindow, now: Date): DashboardReport {
  const cutoff = window === 'all' ? undefined : new Date(now.getTime() - (window === '7d' ? 7 : 30) * 86400000).toISOString()
  const inWindow = (createdAt: string) => !cutoff || createdAt >= cutoff
  const activeItems = snapshot.items
  const versionEvidenceIds = new Set(snapshot.methodVersions.map((version) => version.sourceReviewId).filter(Boolean))
  const periodEvidence = snapshot.methodEvidence.filter((entry) => inWindow(entry.createdAt))
  const periodApplications = snapshot.methodApplications.filter((entry) => inWindow(entry.createdAt))
  const periodRevisions = snapshot.methodVersions.filter((version) => version.version > 1 && inWindow(version.createdAt))
  const periodStarts = snapshot.itemStatusEvents.filter((event) => event.fromStatus && event.toStatus === 'doing' && inWindow(event.createdAt))
  const periodItems = activeItems.filter((item) => inWindow(item.createdAt))
  const periodReviews = snapshot.reviews.filter((review) => inWindow(review.createdAt))
  const periodMethods = snapshot.methods.filter((method) => inWindow(method.createdAt))
  const periodValidations = periodEvidence.filter((entry) => !versionEvidenceIds.has(entry.reviewId))
  const metrics = {
    newItems: periodItems.length,
    startedExecutions: periodStarts.length,
    completedReviews: periodReviews.length,
    newMethods: periodMethods.length,
    methodValidations: periodValidations.length,
    methodRevisions: periodRevisions.length,
    methodApplications: periodApplications.length,
  }
  const backlog = {
    ideaToTry: activeItems.filter((item) => item.status === 'idea_to_try').length,
    doing: activeItems.filter((item) => item.status === 'doing').length,
    waitingReview: activeItems.filter((item) => item.status === 'waiting_review').length,
    paused: activeItems.filter((item) => item.status === 'paused').length,
    ideaLater: activeItems.filter((item) => item.status === 'idea_later').length,
  }
  const methodById = new Map(snapshot.methods.map((method) => [method.id, method]))
  const itemById = new Map(activeItems.map((item) => [item.id, item]))
  const reviewById = new Map(snapshot.reviews.map((review) => [review.id, review]))
  const metricRecords = {
    newItems: periodItems.map((item) => ({ id: item.id, title: item.title, detail: `创建时状态：${item.status}`, itemId: item.id })),
    startedExecutions: periodStarts.map((event) => {
      const item = itemById.get(event.itemId)
      return { id: event.id, title: item?.title ?? '已删除事项', detail: `${event.fromStatus} → ${event.toStatus}`, itemId: item?.id }
    }),
    completedReviews: periodReviews.map((review) => {
      const item = itemById.get(review.itemId)
      return { id: review.id, title: item?.title ?? '已删除事项', detail: review.result || '已完成复盘', itemId: item?.id }
    }),
    newMethods: periodMethods.map((method) => ({ id: method.id, title: method.title, detail: `形成 v${method.version}`, methodId: method.id })),
    methodValidations: periodValidations.map((evidence) => {
      const method = methodById.get(evidence.methodId)
      const review = reviewById.get(evidence.reviewId)
      return { id: evidence.id, title: method?.title ?? '已删除方法', detail: '通过复盘完成仅验证', itemId: review?.itemId, methodId: method?.id }
    }),
    methodRevisions: periodRevisions.map((version) => ({ id: version.id, title: version.title, detail: `修订至 v${version.version}`, methodId: version.methodId })),
    methodApplications: periodApplications.map((application) => {
      const method = methodById.get(application.methodId)
      const item = itemById.get(application.itemId)
      return { id: application.id, title: item?.title ?? '已删除事项', detail: `使用“${method?.title ?? '已删除方法'}”v${application.methodVersion}`, itemId: item?.id, methodId: method?.id }
    }),
  }
  const topInsight = (entries: Array<{ methodId: string }>, detail: (count: number) => string) => {
    const counts = new Map<string, number>()
    entries.forEach((entry) => counts.set(entry.methodId, (counts.get(entry.methodId) ?? 0) + 1))
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
    const method = top ? methodById.get(top[0]) : undefined
    return top && method ? { methodId: method.id, title: method.title, count: top[1], detail: detail(top[1]) } : undefined
  }
  const mostValidated = topInsight(periodEvidence, (count) => `窗口内关联 ${count} 条复盘证据`)
  const mostApplied = topInsight(periodApplications, (count) => `窗口内发起 ${count} 次行动`)
  const latestRevision = [...periodRevisions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const revisedMethod = latestRevision ? methodById.get(latestRevision.methodId) : undefined
  const recentlyRevised = latestRevision && revisedMethod
    ? { methodId: revisedMethod.id, title: revisedMethod.title, count: latestRevision.version, detail: `最近修订至 v${latestRevision.version}` }
    : undefined
  const reviewedItemIds = new Set(snapshot.reviews.map((review) => review.itemId))
  const unreviewedMethodActions = snapshot.methodApplications.filter((entry) => !reviewedItemIds.has(entry.itemId)).length
  const label = window === '7d' ? '过去 7 天' : window === '30d' ? '过去 30 天' : '全部时间'
  const facts = [
    `${label}新增 ${metrics.newItems} 条事项，进入执行 ${metrics.startedExecutions} 次，完成 ${metrics.completedReviews} 条复盘。`,
    backlog.waitingReview ? `当前有 ${backlog.waitingReview} 条事项等待复盘。` : '当前没有等待复盘的事项。',
    mostValidated ? `“${mostValidated.title}”在该窗口内证据最多，共 ${mostValidated.count} 条。` : '该窗口内还没有方法验证证据。',
    unreviewedMethodActions ? `有 ${unreviewedMethodActions} 条方法行动尚未完成复盘。` : '所有方法行动都已完成复盘。',
  ]
  return { window, metrics, metricRecords, backlog, mostValidated, mostApplied, recentlyRevised, unreviewedMethodActions, facts }
}

export class SearchApplicationService {
  constructor(private readonly repository: SearchRepository) {}

  search(query: string): Promise<SearchResult[]> {
    const normalized = query.trim()
    return normalized ? this.repository.search(normalized) : Promise.resolve([])
  }
}
