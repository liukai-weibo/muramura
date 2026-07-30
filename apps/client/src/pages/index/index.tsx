import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { AuthSession, BackupDocument, DashboardMetricKey, DashboardReport, DashboardWindow, ExplorationTrack, Item, ItemExplorationTrackContext, ItemMethodSourceDisplay, ItemStatus, ItemStatusEvent, Method, MethodApplicationContextResult, MethodEvidenceDetail, MethodEvidenceRelation, MethodVersion, Review, SearchResult, TrashEntry, TrashFilter } from '@knowledge-base/contracts'
import { advanceApiClientAuthenticationContext, apiClient, actionsFor, isApiClientAbort, isApiClientUnknownOutcome, setApiClientUnauthorizedHandler, type ApiClientError, type ApiItemAction } from './api-client'
import { ExplorationPrototype } from './exploration-prototype'
import { searchCollapseState, searchExitState, searchResultSelectionState, shouldOpenSearchResults } from './search-session-state'
import { canModifyItemExplorationContext } from './item-exploration-state'
import { mergeUpdatedItemContentIntoList } from './item-content-state'
import { canOpenStartConfirm, shouldDisplayStartAction, shouldInterceptStartAction, startFeedbackVisible } from './start-confirm-state'
import './index.scss'
type ItemAction = ApiItemAction

interface ReviewTextareaProps {
  value: string
  placeholder: string
  onValueChange: (value: string) => void
  observation?: boolean
}

function ReviewTextarea({ value, placeholder, onValueChange, observation = false }: ReviewTextareaProps) {
  return <textarea
    className={`review-input${observation ? ' review-observation-input' : ''}`}
    value={value}
    maxLength={1200}
    placeholder={placeholder}
    rows={3}
    onInput={(event) => onValueChange(event.currentTarget.value)}
  />
}

const statusLabels: Record<ItemStatus, string> = {
  idea_to_try: '想试试', idea_later: '以后再说', doing: '已开始', paused: '已暂停',
  waiting_review: '待完成复盘（历史）', reviewed: '已复盘', archived_no_review: '不复盘归档', abandoned: '已放弃',
}

const statusNavigation: Array<{ label: string; status: ItemStatus }> = [
  { label: '想试试', status: 'idea_to_try' },
  { label: '已开始', status: 'doing' },
  { label: '已复盘', status: 'reviewed' },
  { label: '以后再说', status: 'idea_later' },
  { label: '已暂停', status: 'paused' },
]

type MethodMode = 'none' | 'create' | 'validate'
type PrimaryModule = 'actions' | 'explorations' | 'methods' | 'insights' | 'settings'
type GlobalTool = 'search' | 'capture'
type NavigationTarget =
  | { type: 'item'; itemId: string }
  | { type: 'review'; itemId: string }
  | { type: 'method'; methodId: string; methodVersion?: number }
  | { type: 'backlog'; status: ItemStatus }

const moduleLabels: Record<PrimaryModule, string> = {
  actions: '行动',
  explorations: '长期探索',
  methods: '方法',
  insights: '观察',
  settings: '数据管理',
}

const evidenceRelationLabels: Record<MethodEvidenceRelation, string> = {
  formation: '形成方法',
  validation: '验证方法',
  revision: '修订方法',
  unknown: '历史证据',
}

const ITEMS_PER_PAGE = 5
const TRASH_ENTRIES_PER_PAGE = 8
const ITEM_TITLE_MAX_GRAPHEMES = 20
const itemTitleSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function itemTitleGraphemeCount(value: string): number {
  return [...itemTitleSegmenter.segment(value.trim())].length
}

function acceptsItemTitleInput(value: string): boolean {
  return itemTitleGraphemeCount(value) <= ITEM_TITLE_MAX_GRAPHEMES
}

function captureTitleCandidate(title: string, content: string): string {
  return title.trim() || content.split(/\r?\n/, 1)[0]?.trim() || ''
}



const defaultEffective = '暂未标记有效或舒服之处'
const selectedEffective = '本次存在有效或舒服之处'
const defaultIncompatible = '暂未标记阻力或不舒服'
const selectedIncompatible = '本次存在阻力或不舒服'
const emptyReview = {
  actualAction: '',
  result: '已完成本次行动。',
  effective: defaultEffective,
  incompatible: defaultIncompatible,
  reason: '',
  adjustment: '',
  newIdeas: '',
}
const emptyMethod = { title: '', applicable: '', unsuitable: '', steps: '' }

function resizeContentEditor(input: HTMLTextAreaElement | null) {
  if (!input) return
  input.style.height = 'auto'
  const borderHeight = input.offsetHeight - input.clientHeight
  input.style.height = `${input.scrollHeight + borderHeight}px`
}


function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatEvidenceSummary(summary: string): string {
  return summary.split(' · ').filter((part, index, parts) => index === 0 || part !== parts[index - 1]).join(' · ')
}

function compactStartAction(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value
}

function compactMethodSourceTitle(value: string): string {
  const characters = Array.from(value)
  return characters.length > 10 ? `${characters.slice(0, 10).join('')}…` : value
}

function sourceDisplayText(display: ItemMethodSourceDisplay | undefined): string | undefined {
  if (!display || display.status === 'no-association') return undefined
  if (display.status === 'available') return `方法：${compactMethodSourceTitle(display.title)}`
  if (display.status === 'method-in-trash') return `方法：${compactMethodSourceTitle(display.title)}（已移入回收站）`
  if (display.status === 'method-purged') return `方法：${compactMethodSourceTitle(display.title)}（已永久清理）`
  return display.title ? `方法：${compactMethodSourceTitle(display.title)}（已不可用）` : '关联方法已不可用'
}

function remainingTrashDays(deletedAt: string): number {
  return Math.max(1, 30 - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000))
}

interface AuthenticatedWorkspaceProps {
  session: AuthSession
  logoutBusy: boolean
  logoutUnknownOutcome: boolean
  logoutError: string
  onLogout: () => void
  onConfirmLogoutOutcome: () => void
}

function AuthenticatedWorkspace({ session, logoutBusy, logoutUnknownOutcome, logoutError, onLogout, onConfirmLogoutOutcome }: AuthenticatedWorkspaceProps) {
  const application = apiClient
  const reviewApplication = apiClient
  const searchApplication = apiClient
  const methodApplication = apiClient
  const methodLifecycleApplication = apiClient
  const trashApplication = apiClient
  const backupApplication = apiClient
  const dashboardApplication = apiClient
  const [searchQuery, setSearchQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchResultsOpen, setSearchResultsOpen] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTriggerRef = useRef<HTMLElement>()
  const searchControlRef = useRef<HTMLDivElement>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>()
  const [activeModule, setActiveModule] = useState<PrimaryModule>('actions')
  const [explorationMounted, setExplorationMounted] = useState(false)
  const [explorationFactsVersion, setExplorationFactsVersion] = useState(0)
  useEffect(() => {
    if (activeModule === 'explorations') setExplorationMounted(true)
  }, [activeModule])
  const [activeGlobalTool, setActiveGlobalTool] = useState<GlobalTool>()
  const captureOriginModuleRef = useRef<PrimaryModule>('actions')
  const captureInputRef = useRef<HTMLInputElement>(null)
  const [captureDiscardConfirm, setCaptureDiscardConfirm] = useState(false)
  const [captureCreatedItemId, setCaptureCreatedItemId] = useState<string>()
  const [captureUnknownOutcome, setCaptureUnknownOutcome] = useState(false)
  const [dashboardWindow, setDashboardWindow] = useState<DashboardWindow>('7d')
  const [dashboardReport, setDashboardReport] = useState<DashboardReport>()
  const [dashboardMetric, setDashboardMetric] = useState<DashboardMetricKey>()
  const [rhythmNow, setRhythmNow] = useState(() => new Date())
  const [title, setTitle] = useState('')
  const [captureTitleLimitReached, setCaptureTitleLimitReached] = useState(false)
  const [content, setContent] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [trashItems, setTrashItems] = useState<Item[]>([])
  const [methods, setMethods] = useState<Method[]>([])
  const [methodSearchQuery, setMethodSearchQuery] = useState('')
  const [selectedWorkspaceMethodId, setSelectedWorkspaceMethodId] = useState('')
  const [expandedMethodId, setExpandedMethodId] = useState<string>()
  const [expandedEvidenceMethodId, setExpandedEvidenceMethodId] = useState<string>()
  const [methodEvidenceDetails, setMethodEvidenceDetails] = useState<MethodEvidenceDetail[]>([])
  const [methodEvidenceLoading, setMethodEvidenceLoading] = useState(false)
  const [methodEvidenceError, setMethodEvidenceError] = useState('')
  const evidenceRequestId = useRef(0)
  const [methodHistories, setMethodHistories] = useState<Record<string, MethodVersion[]>>({})
  const [historyReviews, setHistoryReviews] = useState<Record<string, Review>>({})
  const [trashFilter, setTrashFilter] = useState<TrashFilter>('all')
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([])
  const [trashPage, setTrashPage] = useState(1)
  const [trashLoading, setTrashLoading] = useState(false)
  const [pendingTrashRestore, setPendingTrashRestore] = useState<TrashEntry>()
  const [methodTrashConfirmId, setMethodTrashConfirmId] = useState<string>()
  const [methodMoreMenuId, setMethodMoreMenuId] = useState<string>()
  const [moreStatusMenuOpen, setMoreStatusMenuOpen] = useState(false)
  const moreStatusMenuRef = useRef<HTMLDivElement>()
  const methodMoreMenuRef = useRef<HTMLDivElement>()
  const methodMoreTriggerRef = useRef<HTMLButtonElement>(null)
  const [filter, setFilter] = useState<ItemStatus | undefined>('idea_to_try')
  const [showTrash, setShowTrash] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pendingBackup, setPendingBackup] = useState<BackupDocument>()
  const [backupMessage, setBackupMessage] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const selectedIdRef = useRef<string>()
  const contentDraftsRef = useRef<Record<string, string>>({})
  const [contentEditingItemId, setContentEditingItemId] = useState<string>()
  const [contentDraft, setContentDraft] = useState('')
  const [contentSavingItemId, setContentSavingItemId] = useState<string>()
  const contentSavingItemIdRef = useRef<string>()
  const refreshRequestRef = useRef(0)
  const refreshAbortRef = useRef<AbortController>()
  const methodSourceDisplayAbortRef = useRef<AbortController>()
  const methodContextAbortRef = useRef<AbortController>()
  const explorationContextAbortRef = useRef<AbortController>()
  const evidenceAbortRef = useRef<AbortController>()
  const historyRequestRef = useRef(0)
  const [contentSaveError, setContentSaveError] = useState('')
  const [contentSaveUnknownOutcome, setContentSaveUnknownOutcome] = useState(false)
  const [contentSaveNotice, setContentSaveNotice] = useState('')
  const contentEditorRef = useRef<HTMLDivElement>(null)
  const contentInputRef = useRef<HTMLTextAreaElement>(null)
  const [selectedReview, setSelectedReview] = useState<Review>()
  const [reviewEditorItemId, setReviewEditorItemId] = useState<string>()
  const [statusEvents, setStatusEvents] = useState<ItemStatusEvent[]>([])
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [startConfirmItemId, setStartConfirmItemId] = useState<string>()
  const [startPrompt, setStartPrompt] = useState('')
  const [startSubmitting, setStartSubmitting] = useState(false)
  const [startConfirmError, setStartConfirmError] = useState('')
  const [startSaveFailed, setStartSaveFailed] = useState(false)
  const [startOverwriteConfirm, setStartOverwriteConfirm] = useState(false)
  const [startUnknownOutcome, setStartUnknownOutcome] = useState(false)
  const [startActionPreview, setStartActionPreview] = useState<string>()
  const startPromptRef = useRef<HTMLTextAreaElement>(null)
  const [startedFeedbackItemId, setStartedFeedbackItemId] = useState<string>()
  const startConfirmRef = useRef<HTMLDivElement>(null)
  const startTriggerRef = useRef<HTMLElement>()
  const [pendingReviewLocation, setPendingReviewLocation] = useState(false)
  const [pendingMethodLocation, setPendingMethodLocation] = useState<string>()
  const [pendingMethodVersionLocation, setPendingMethodVersionLocation] = useState<number>()
  const [reviewForm, setReviewForm] = useState(emptyReview)
  const reviewFormRef = useRef({ ...emptyReview })
  const [hasNewIdea, setHasNewIdea] = useState(false)
  const hasNewIdeaRef = useRef(false)
  const updateReviewForm = (update: (current: typeof emptyReview) => typeof emptyReview) => {
    const next = update(reviewFormRef.current)
    reviewFormRef.current = next
    setReviewForm(next)
  }
  const resetReviewForm = () => {
    reviewFormRef.current = { ...emptyReview }
    setReviewForm(emptyReview)
  }
  const updateHasNewIdea = (value: boolean) => {
    hasNewIdeaRef.current = value
    setHasNewIdea(value)
  }
  const [methodForm, setMethodForm] = useState(emptyMethod)
  const [methodMode, setMethodMode] = useState<MethodMode>('none')
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [reviseMethod, setReviseMethod] = useState(false)
  const methodTouchedRef = useRef<Record<string, true>>({})
  const methodDraftsRef = useRef<Record<string, Partial<Record<'create' | 'validate', typeof emptyMethod>>>>({})
  const reviewMethodSelectionsRef = useRef<Record<string, string>>({})
  const [methodApplicationContextResult, setMethodApplicationContextResult] = useState<MethodApplicationContextResult>()
  const [methodSourceDisplays, setMethodSourceDisplays] = useState<Record<string, ItemMethodSourceDisplay>>({})
  const methodSourceDisplayRequestId = useRef(0)
  const [methodApplicationContextError, setMethodApplicationContextError] = useState('')
  const [itemExplorationContext, setItemExplorationContext] = useState<ItemExplorationTrackContext>()
  const [itemExplorationLoading, setItemExplorationLoading] = useState(false)
  const [itemExplorationError, setItemExplorationError] = useState('')
  const [explorationSelectorOpen, setExplorationSelectorOpen] = useState(false)
  const itemExplorationContextRef = useRef<HTMLDivElement>(null)
  const [selectableExplorationTracks, setSelectableExplorationTracks] = useState<ExplorationTrack[]>([])
  const [itemExplorationSaving, setItemExplorationSaving] = useState(false)
  const [itemExplorationUnknownOutcome, setItemExplorationUnknownOutcome] = useState(false)
  const [applyingMethodId, setApplyingMethodId] = useState<string>()
  const [methodActionTitle, setMethodActionTitle] = useState('')
  const [methodActionTitleLimitReached, setMethodActionTitleLimitReached] = useState(false)
  const [methodActionContent, setMethodActionContent] = useState('')
  const [message, setMessage] = useState('正在读取本地事项…')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const selectedItem = (showTrash ? trashItems : items).find((item) => item.id === selectedId)
  const canModifySelectedItemExploration = canModifyItemExplorationContext(itemExplorationContext, selectedItem?.status)
  const startConfirmItem = items.find((item) => item.id === startConfirmItemId)
  const visibleItems = showTrash ? trashItems : filter ? items.filter((item) => item.status === filter) : items
  const itemUpdatedAtById = useMemo(() => new Map(items.map((item) => [item.id, item.updatedAt])), [items])
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / ITEMS_PER_PAGE))
  const pagedItems = visibleItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const trashPageCount = Math.max(1, Math.ceil(trashEntries.length / TRASH_ENTRIES_PER_PAGE))
  const visibleTrashEntries = trashEntries.slice((trashPage - 1) * TRASH_ENTRIES_PER_PAGE, trashPage * TRASH_ENTRIES_PER_PAGE)
  const visibleMethodSourceItemIds = useMemo(() => pagedItems.map((item) => item.id), [pagedItems])
  const visibleMethodSourceItemIdsKey = visibleMethodSourceItemIds.join('\u0000')
  const captureTitle = captureTitleCandidate(title, content)
  const captureTitleGraphemes = itemTitleGraphemeCount(captureTitle)
  const captureTitleWithinLimit = captureTitleGraphemes <= ITEM_TITLE_MAX_GRAPHEMES
  const methodActionTitleGraphemes = itemTitleGraphemeCount(methodActionTitle)
  const methodActionTitleWithinLimit = methodActionTitleGraphemes <= ITEM_TITLE_MAX_GRAPHEMES
  const hasCaptureContent = Boolean(captureTitle)
  const captureLocked = restoring || Boolean(pendingBackup)
  const contentBelowFacts = selectedItem?.status === 'waiting_review'
    || selectedItem?.status === 'reviewed'
    || selectedItem?.status === 'archived_no_review'
    || selectedItem?.status === 'abandoned'
  const methodContextAvailable = methodApplicationContextResult?.status === 'available'
  const methodContextUnavailable = methodApplicationContextResult?.status === 'unavailable'
  const methodContextLifecycleUnavailable = methodApplicationContextResult?.status === 'method-in-trash' || methodApplicationContextResult?.status === 'method-purged'
  const methodActionsAllowed = methodApplicationContextResult?.status === 'no-association' || methodContextAvailable
  const lifecycleMethodContextMessage = methodApplicationContextResult?.status === 'method-in-trash'
    ? `关联方法：${methodApplicationContextResult.method.title}（已移入回收站）`
    : methodApplicationContextResult?.status === 'method-purged'
      ? `关联方法：${methodApplicationContextResult.tombstone.title}（已永久清理）`
      : ''
  const unavailableMethodContextMessage = methodApplicationContextResult?.status === 'unavailable'
    ? `${methodApplicationContextResult.reason === 'method-missing'
      ? '关联方法已不可用。'
      : methodApplicationContextResult.reason === 'version-missing'
        ? '关联方法的历史版本已不可用。'
        : '关联方法及其历史版本均已不可用。'} 历史关联的方法暂不可用，但不影响完成事实复盘。`
    : ''
  const selectedReviewMethod = methods.find((method) => method.id === selectedMethodId)
  const abandonedItemCount = items.filter((item) => item.status === 'abandoned' && !item.deletedAt).length
  const historicalWaitingReviewCount = items.filter((item) => item.status === 'waiting_review' && !item.deletedAt).length
  const reviewEditing = reviewEditorItemId === selectedItem?.id
    && (selectedItem?.status === 'doing' || selectedItem?.status === 'waiting_review')
  const workspaceMethods = useMemo(() => {
    const query = methodSearchQuery.trim().toLocaleLowerCase()
    return [...methods].sort((left, right) => {
      const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt)
      return updatedAtOrder || left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id)
    }).filter((method) => !query || [method.title, method.steps, method.applicable, method.unsuitable].join('\n').toLocaleLowerCase().includes(query))
  }, [methodSearchQuery, methods])
  const selectedWorkspaceMethod = workspaceMethods.find((method) => method.id === selectedWorkspaceMethodId)
  const methodStarted = methodMode === 'create' || (methodMode === 'validate' && reviseMethod)
  const captureWeekDays = useMemo(() => {
    const today = new Date(rhythmNow)
    const mondayOffset = (today.getDay() + 6) % 7
    const monday = new Date(today)
    monday.setDate(today.getDate() - mondayOffset)
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday)
      date.setDate(monday.getDate() + index)
      return { date, isToday: date.toDateString() === today.toDateString() }
    })
  }, [rhythmNow])
  const formattedRhythmDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(rhythmNow)
  const [reviewError, setReviewError] = useState('')
  const [methodDisclosureOpen, setMethodDisclosureOpen] = useState(false)
  const [methodDiscardConfirm, setMethodDiscardConfirm] = useState(false)
  const [methodModeSwitchConfirm, setMethodModeSwitchConfirm] = useState(false)
  const [reviewLeaveConfirm, setReviewLeaveConfirm] = useState(false)
  const [pendingSignalClear, setPendingSignalClear] = useState<'effective' | 'incompatible' | 'newIdeas'>()
  const [openingSignal, setOpeningSignal] = useState<'effective' | 'incompatible' | 'newIdeas'>()
  const [closingSignal, setClosingSignal] = useState<'effective' | 'incompatible' | 'newIdeas'>()
  const signalOpenFrameRef = useRef<number>()
  const signalCloseTimerRef = useRef<number>()
  const pendingReviewLeaveActionRef = useRef<(() => void) | undefined>()
  const reviewDraftDirty = reviewEditing && (
    JSON.stringify(reviewForm) !== JSON.stringify(emptyReview)
    || hasNewIdea
    || methodMode !== 'none'
    || reviseMethod
    || JSON.stringify(methodForm) !== JSON.stringify(emptyMethod)
  )

  const refresh = async (nextSelectedId = selectedId) => {
    refreshAbortRef.current?.abort()
    const controller = new AbortController()
    refreshAbortRef.current = controller
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    try {
      const [nextItems, nextTrashItems, nextMethods] = await Promise.all([
        application.listItems(controller.signal), application.listTrash(controller.signal), reviewApplication.listMethods(controller.signal),
      ])
      if (requestId !== refreshRequestRef.current) return { items: [], trashItems: [], methods: [] }
      setItems(nextItems)
      setTrashItems(nextTrashItems)
      setMethods(nextMethods)
      const selectionPool = [...nextItems, ...nextTrashItems]
      if (nextSelectedId && selectionPool.some((item) => item.id === nextSelectedId)) setSelectedId(nextSelectedId)
      else if (selectedId && !selectionPool.some((item) => item.id === selectedId)) setSelectedId(undefined)
      setMessage(`${nextItems.length} 条有效事项 · ${nextMethods.length} 条当前方法 · 回收站 ${nextTrashItems.length} 条`)
      return { items: nextItems, trashItems: nextTrashItems, methods: nextMethods }
    } catch (error) {
      if (isApiClientAbort(error) || requestId !== refreshRequestRef.current) return { items: [], trashItems: [], methods: [] }
      throw error
    }
  }

  useEffect(() => {
    refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '本地数据服务初始化失败'))
    return () => refreshAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!searchExpanded) return
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [searchExpanded])

  useEffect(() => {
    if (!explorationSelectorOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!itemExplorationContextRef.current?.contains(event.target as Node)) setExplorationSelectorOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [explorationSelectorOpen])

  useEffect(() => {
    if (!searchExpanded) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!searchControlRef.current?.contains(event.target as Node)) collapseSearch()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapseSearch()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [searchExpanded])

  useEffect(() => {
    if (activeGlobalTool !== 'capture' || captureLocked) return
    const frame = window.requestAnimationFrame(() => captureInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [activeGlobalTool, captureLocked])

  useEffect(() => {
    const refreshRhythm = () => setRhythmNow(new Date())
    const interval = window.setInterval(refreshRhythm, 60_000)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refreshRhythm() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [])
  useEffect(() => {
    if (activeModule !== 'insights') return
    const controller = new AbortController()
    dashboardApplication.getReport(dashboardWindow, controller.signal).then(setDashboardReport).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取仪表盘失败')
    })
    return () => controller.abort()
  }, [activeModule, dashboardWindow, dashboardApplication, items, methods])

  useEffect(() => {
    const controller = new AbortController()
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSearchError('')
      return () => controller.abort()
    }
    setSearchResults(undefined)
    setSearchError('')
    searchApplication.search(searchQuery, controller.signal).then((results) => setSearchResults(results)).catch((error: unknown) => {
      if (isApiClientAbort(error)) return
      setSearchResults([])
      setSearchError('搜索暂不可用，请重试。')
      setMessage(error instanceof Error ? error.message : '搜索失败')
    })
    return () => controller.abort()
  }, [searchQuery, searchApplication, items, methods])

  useEffect(() => {
    if (activeModule !== 'methods') return
    if (selectedWorkspaceMethodId && !workspaceMethods.some((method) => method.id === selectedWorkspaceMethodId)) {
      setSelectedWorkspaceMethodId('')
      return
    }
    if (!selectedWorkspaceMethodId && !methodSearchQuery.trim() && workspaceMethods[0]) {
      setSelectedWorkspaceMethodId(workspaceMethods[0].id)
    }
  }, [activeModule, methodSearchQuery, selectedWorkspaceMethodId, workspaceMethods])


  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  useEffect(() => {
    if (trashPage > trashPageCount) setTrashPage(trashPageCount)
  }, [trashPage, trashPageCount])

  useEffect(() => {
    if (activeModule !== 'settings') return
    const controller = new AbortController()
    setTrashLoading(true)
    trashApplication.listTrashEntries(trashFilter, controller.signal).then((entries) => {
      setTrashEntries(entries)
      setTrashPage((page) => Math.min(page, Math.max(1, Math.ceil(entries.length / TRASH_ENTRIES_PER_PAGE))))
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取回收站失败')
    }).finally(() => {
      if (!controller.signal.aborted) setTrashLoading(false)
    })
    return () => controller.abort()
  }, [activeModule, trashApplication, trashFilter])

  useEffect(() => {
    if (!startActionPreview) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setStartActionPreview(undefined)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [startActionPreview])

  useEffect(() => {
    if (!contentEditingItemId) return
    const frame = window.requestAnimationFrame(() => {
      const input = contentInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      resizeContentEditor(input)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [contentEditingItemId, contentDraft])

  useEffect(() => {
    if (!contentEditingItemId) return
    const requestContentLeave = () => requestLeaveContentEditor(contentEditingItemId)
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      requestContentLeave()
    }
    const cancelOnOutsideClick = (event: MouseEvent) => {
      if (contentEditorRef.current?.contains(event.target as Node)) return
      requestContentLeave()
    }
    window.addEventListener('keydown', cancelOnEscape)
    document.addEventListener('click', cancelOnOutsideClick)
    return () => {
      window.removeEventListener('keydown', cancelOnEscape)
      document.removeEventListener('click', cancelOnOutsideClick)
    }
  }, [contentEditingItemId])



  useEffect(() => {
    if (!selectedId) { setSelectedReview(undefined); return }
    const controller = new AbortController()
    reviewApplication.getReviewForItem(selectedId, controller.signal).then(setSelectedReview).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取复盘失败')
    })
    return () => controller.abort()
  }, [selectedId, reviewApplication, items])

  useEffect(() => {
    if (!selectedId) { setStatusEvents([]); return }
    const controller = new AbortController()
    application.listStatusEvents(selectedId, controller.signal).then(setStatusEvents).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取流转历史失败')
    })
    return () => controller.abort()
  }, [selectedId, application, items])

  useEffect(() => {
    if (!startConfirmItemId) return
    if (!canOpenStartConfirm(startConfirmItem)) {
      setStartConfirmItemId(undefined)
      setStartPrompt('')
      setStartConfirmError('')
      setStartOverwriteConfirm(false)
      setStartUnknownOutcome(false)
    }
  }, [startConfirmItem, startConfirmItemId])

  useEffect(() => {
    if (!startConfirmItemId) return
    const frame = window.requestAnimationFrame(() => startPromptRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !startSubmitting) {
        event.preventDefault()
        closeStartConfirm()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = startConfirmRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [startConfirmItemId, startSubmitting])

  useEffect(() => {
    if (!startedFeedbackItemId) return
    const timer = window.setTimeout(() => setStartedFeedbackItemId(undefined), 3000)
    return () => window.clearTimeout(timer)
  }, [startedFeedbackItemId])

  useEffect(() => {
    if (!selectedId || selectedId === startConfirmItemId) return
    if (!startSubmitting) closeStartConfirm()
  }, [selectedId])

  useEffect(() => {
    if (!timelineOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setTimelineOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [timelineOpen])

  useEffect(() => {
    if (!reviewEditing) return
    document.getElementById('review-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [reviewEditing])

  useEffect(() => {
    if (!pendingReviewLocation || activeModule !== 'actions' || !selectedReview) return
    document.getElementById('review-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPendingReviewLocation(false)
  }, [activeModule, pendingReviewLocation, selectedReview])

  useEffect(() => {
    if (!pendingMethodLocation || activeModule !== 'methods') return
    const targetId = pendingMethodVersionLocation === undefined
      ? `method-${pendingMethodLocation}`
      : `method-${pendingMethodLocation}-version-${pendingMethodVersionLocation}`
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPendingMethodLocation(undefined)
    setPendingMethodVersionLocation(undefined)
  }, [activeModule, expandedMethodId, pendingMethodLocation, pendingMethodVersionLocation])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    setSearchResultsOpen(false)
    setTimelineOpen(false)
    setContentEditingItemId(undefined)
    setStartActionPreview(undefined)
    setContentDraft(selectedId ? contentDraftsRef.current[selectedId] ?? '' : '')
    setReviewEditorItemId(undefined)
    resetReviewForm()
    updateHasNewIdea(false)
    setMethodDisclosureOpen(false)
    setMethodMode('none')
    setSelectedMethodId('')
    setReviseMethod(false)
    setMethodForm(emptyMethod)
    setReviewError('')
  }, [selectedId])

  useEffect(() => {
    if (!contentSaveNotice) return
    const timer = window.setTimeout(() => setContentSaveNotice(''), 1800)
    return () => window.clearTimeout(timer)
  }, [contentSaveNotice])


  useEffect(() => {
    if (reviewLeaveConfirm) document.getElementById('review-leave-continue')?.focus()
  }, [reviewLeaveConfirm])

  useEffect(() => {
    if (methodDiscardConfirm) document.getElementById('method-discard-continue')?.focus()
  }, [methodDiscardConfirm])

  useEffect(() => {
    if (methodModeSwitchConfirm) document.getElementById('method-switch-continue')?.focus()
  }, [methodModeSwitchConfirm])

  useEffect(() => {
    if (methodDisclosureOpen && methodMode === 'create') window.setTimeout(() => document.querySelector<HTMLInputElement>('.method-title-input input')?.focus(), 0)
  }, [methodDisclosureOpen, methodMode])

  useEffect(() => {
    if (!moreStatusMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!moreStatusMenuRef.current?.contains(event.target as Node)) setMoreStatusMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreStatusMenuOpen(false) }
    document.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeMenu); window.removeEventListener('keydown', closeOnEscape) }
  }, [moreStatusMenuOpen])

  useEffect(() => {
    if (!methodMoreMenuId) return
    const closeMenu = (event: MouseEvent) => {
      if (!methodMoreMenuRef.current?.contains(event.target as Node)) setMethodMoreMenuId(undefined)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMethodMoreMenuId(undefined)
      window.setTimeout(() => methodMoreTriggerRef.current?.focus(), 0)
    }
    document.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeMenu); window.removeEventListener('keydown', closeOnEscape) }
  }, [methodMoreMenuId])

  useEffect(() => {
    if (methodTrashConfirmId) window.setTimeout(() => document.getElementById('method-trash-cancel')?.focus(), 0)
  }, [methodTrashConfirmId])


  useEffect(() => () => {
    if (signalOpenFrameRef.current) window.cancelAnimationFrame(signalOpenFrameRef.current)
    if (signalCloseTimerRef.current) window.clearTimeout(signalCloseTimerRef.current)
  }, [])

  useEffect(() => {
    const requestId = methodSourceDisplayRequestId.current + 1
    methodSourceDisplayRequestId.current = requestId
    methodSourceDisplayAbortRef.current?.abort()
    if (!visibleMethodSourceItemIds.length) {
      setMethodSourceDisplays({})
      return
    }
    const controller = new AbortController()
    methodSourceDisplayAbortRef.current = controller
    setMethodSourceDisplays({})
    methodApplication.listSourceDisplaysForItems(visibleMethodSourceItemIds, controller.signal).then((displays) => {
      if (methodSourceDisplayRequestId.current !== requestId) return
      setMethodSourceDisplays(Object.fromEntries(displays.map((display) => [display.itemId, display])))
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error) && methodSourceDisplayRequestId.current === requestId) setMessage('方法来源信息暂不可用')
    })
    return () => controller.abort()
  }, [methodApplication, visibleMethodSourceItemIdsKey])
  useEffect(() => {
    if (!selectedId || (selectedItem?.status !== 'doing' && selectedItem?.status !== 'waiting_review' && selectedItem?.status !== 'reviewed')) {
      methodContextAbortRef.current?.abort()
      setMethodApplicationContextResult(undefined)
      setMethodApplicationContextError('')
      return
    }
    methodContextAbortRef.current?.abort()
    const controller = new AbortController()
    methodContextAbortRef.current = controller
    setMethodApplicationContextResult(undefined)
    setMethodApplicationContextError('')
    methodApplication.getMethodContext(selectedId, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setMethodApplicationContextResult(result)
      if (result.status !== 'available' && result.status !== 'no-association') {
        setMethodMode('none')
        setSelectedMethodId('')
        setReviseMethod(false)
      }
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error) && !controller.signal.aborted) setMethodApplicationContextError('关联方法信息暂不可用；不影响完成事实复盘。')
    })
    return () => controller.abort()
  }, [selectedId, selectedItem?.status, methodApplication])

  useEffect(() => {
    if (!selectedId || showTrash) {
      explorationContextAbortRef.current?.abort()
      setItemExplorationContext(undefined)
      setItemExplorationLoading(false)
      setItemExplorationError('')
      setExplorationSelectorOpen(false)
      return
    }
    explorationContextAbortRef.current?.abort()
    const controller = new AbortController()
    explorationContextAbortRef.current = controller
    setItemExplorationLoading(true)
    setItemExplorationError('')
    setItemExplorationUnknownOutcome(false)
    setExplorationSelectorOpen(false)
    application.getItemExplorationTrack(selectedId, controller.signal).then((context) => {
      if (!controller.signal.aborted) setItemExplorationContext(context)
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error) && !controller.signal.aborted) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入探索主线关联。')
    }).finally(() => { if (!controller.signal.aborted) setItemExplorationLoading(false) })
    return () => controller.abort()
  }, [selectedId, showTrash, application])

  const reloadCurrentItemExplorationContext = async () => {
    const itemId = selectedIdRef.current
    if (!itemId || showTrash) return false
    explorationContextAbortRef.current?.abort()
    const controller = new AbortController()
    explorationContextAbortRef.current = controller
    setItemExplorationLoading(true)
    setItemExplorationError('')
    try {
      const context = await application.getItemExplorationTrack(itemId, controller.signal)
      if (!controller.signal.aborted && selectedIdRef.current === itemId) setItemExplorationContext(context)
      return !controller.signal.aborted && selectedIdRef.current === itemId
    } catch (error) {
      if (!isApiClientAbort(error) && !controller.signal.aborted && selectedIdRef.current === itemId) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入探索主线关联。')
      return false
    } finally { if (!controller.signal.aborted && selectedIdRef.current === itemId) setItemExplorationLoading(false) }
  }

  useEffect(() => {
    if (!selectedId) return
    resetReviewForm()
    updateHasNewIdea(false)
    setMethodDisclosureOpen(false)
    setMethodForm(emptyMethod)
    setMethodMode('none')
    setSelectedMethodId('')
    setReviseMethod(false)
    setReviewError('')
  }, [selectedId])

  const handleUnknownOutcome = () => {
    setMessage('本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。')
  }

  const openExplorationSelector = async () => {
    if (!selectedId || !canModifySelectedItemExploration || itemExplorationSaving || itemExplorationUnknownOutcome) return
    setItemExplorationError('')
    try {
      const tracks = await application.listSelectableExplorationTracks()
      setSelectableExplorationTracks(tracks)
      setExplorationSelectorOpen(true)
    } catch (error) {
      setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入可选探索主线。')
    }
  }

  const assignSelectedItemToExplorationTrack = async (trackId: string) => {
    if (!selectedId || !canModifySelectedItemExploration || itemExplorationSaving || itemExplorationUnknownOutcome) return
    setItemExplorationSaving(true)
    setItemExplorationError('')
    try {
      const context = await application.assignItemToExplorationTrack(selectedId, trackId)
      setItemExplorationContext(context)
      setExplorationFactsVersion((version) => version + 1)
      setExplorationSelectorOpen(false)
    } catch (error) {
      if (isApiClientUnknownOutcome(error)) { setItemExplorationUnknownOutcome(true); setItemExplorationError('提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。') }
      else setItemExplorationError(error instanceof Error ? error.message : '调整探索主线未完成，请重试。')
    } finally { setItemExplorationSaving(false) }
  }

  const removeSelectedItemFromExplorationTrack = async () => {
    if (!selectedId || !canModifySelectedItemExploration || itemExplorationSaving || itemExplorationUnknownOutcome) return
    setItemExplorationSaving(true)
    setItemExplorationError('')
    try {
      await application.removeItemFromExplorationTrack(selectedId)
      setItemExplorationContext({ status: 'no-association', itemId: selectedId })
      setExplorationFactsVersion((version) => version + 1)
      setExplorationSelectorOpen(false)
    } catch (error) {
      if (isApiClientUnknownOutcome(error)) { setItemExplorationUnknownOutcome(true); setItemExplorationError('提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。') }
      else setItemExplorationError(error instanceof Error ? error.message : '移除探索主线未完成，请重试。')
    } finally { setItemExplorationSaving(false) }
  }

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await operation() }
    catch (error: unknown) {
      if (isApiClientUnknownOutcome(error)) handleUnknownOutcome()
      else setMessage(error instanceof Error ? error.message : '操作失败')
    }
    finally { setBusy(false) }
  }

  const hasMethodDraft = methodMode !== 'none'
    || Boolean(selectedMethodId)
    || reviseMethod
    || JSON.stringify(methodForm) !== JSON.stringify(emptyMethod)
    || Boolean(selectedId && (methodDraftsRef.current[selectedId] || reviewMethodSelectionsRef.current[selectedId]))

  const clearMethodDraft = () => {
    setMethodMode('none')
    setMethodForm(emptyMethod)
    setSelectedMethodId('')
    setReviseMethod(false)
    setReviewError('')
    if (selectedId) {
      delete methodTouchedRef.current[selectedId]
      delete methodDraftsRef.current[selectedId]
      delete reviewMethodSelectionsRef.current[selectedId]
    }
  }

  const toggleMethodDisclosure = () => {
    if (!methodDisclosureOpen) { setMethodDisclosureOpen(true); return }
    if (!hasMethodDraft) { setMethodDisclosureOpen(false); return }
    setMethodDiscardConfirm(true)
  }

  const discardMethodDraftAndClose = () => {
    clearMethodDraft()
    setMethodDiscardConfirm(false)
    setMethodDisclosureOpen(false)
  }

  const cancelMethodDiscard = () => setMethodDiscardConfirm(false)

  const discardReviewDraft = () => {
    resetReviewForm()
    updateHasNewIdea(false)
    setMethodDisclosureOpen(false)
    clearMethodDraft()
    setReviewError('')
    if (selectedId) {
      delete methodTouchedRef.current[selectedId]
      delete methodDraftsRef.current[selectedId]
      delete reviewMethodSelectionsRef.current[selectedId]
    }
  }

  const requestLeaveReview = (action: () => void) => {
    if (!reviewDraftDirty) { action(); return }
    pendingReviewLeaveActionRef.current = action
    setReviewLeaveConfirm(true)
  }

  const confirmLeaveReview = () => {
    discardReviewDraft()
    setReviewLeaveConfirm(false)
    const action = pendingReviewLeaveActionRef.current
    pendingReviewLeaveActionRef.current = undefined
    action?.()
  }

  const cancelLeaveReview = () => {
    pendingReviewLeaveActionRef.current = undefined
    setReviewLeaveConfirm(false)
  }

  const openContentEditor = () => {
    if (!selectedItem || selectedItem.deletedAt) return
    const draft = contentDraftsRef.current[selectedItem.id] ?? selectedItem.content
    contentDraftsRef.current[selectedItem.id] = draft
    setContentSaveError('')
    setContentSaveUnknownOutcome(false)
    setContentSaveNotice('')
    setContentDraft(draft)
    setContentEditingItemId(selectedItem.id)
  }

  const updateContentDraft = (itemId: string, value: string) => {
    contentDraftsRef.current[itemId] = value
    if (selectedIdRef.current === itemId) setContentDraft(value)
  }

  const requestLeaveContentEditor = async (itemId: string, action?: () => void) => {
    const draft = contentDraftsRef.current[itemId] ?? ''
    const savedContent = items.find((item) => item.id === itemId)?.content ?? ''
    if (draft === savedContent) {
      closeContentEditor(itemId)
      action?.()
      return true
    }
    const saved = await saveItemContent(itemId)
    if (saved) action?.()
    return saved
  }

  const requestLeaveAllDrafts = (action: () => void) => {
    requestLeaveReview(() => {
      if (!contentEditingItemId) { action(); return }
      void requestLeaveContentEditor(contentEditingItemId, action)
    })
  }

  const closeContentEditor = (itemId: string) => {
    delete contentDraftsRef.current[itemId]
    if (contentEditingItemId === itemId) {
      setContentEditingItemId(undefined)
      setContentDraft('')
      setContentSaveError('')
    }
  }

  const retrySaveItemContent = () => {
    if (contentEditingItemId && !contentSaveUnknownOutcome) void saveItemContent(contentEditingItemId)
  }

  const saveItemContent = async (itemId: string): Promise<boolean> => {
    if (contentSavingItemIdRef.current === itemId) return false
    const submittedDraft = contentDraftsRef.current[itemId] ?? ''
    contentSavingItemIdRef.current = itemId
    setContentSavingItemId(itemId)
    try {
      const updatedItem = await application.updateItemContent(itemId, submittedDraft)
      setItems((current) => mergeUpdatedItemContentIntoList(current, updatedItem))
      if (contentDraftsRef.current[itemId] === submittedDraft) {
        delete contentDraftsRef.current[itemId]
        if (selectedIdRef.current === itemId) {
          setContentEditingItemId(undefined)
          setContentDraft('')
        }
      }
      setContentSaveError('')
      setContentSaveUnknownOutcome(false)
      setContentSaveNotice('已保存')
      setMessage('补充说明已保存')
      return true
    } catch (error: unknown) {
      if (isApiClientUnknownOutcome(error)) {
        setContentSaveUnknownOutcome(true)
        setContentSaveError('本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。')
        handleUnknownOutcome()
      } else {
        setContentSaveError('未能保存，请重试。')
        setMessage('未能保存，请重试。')
      }
      return false
    } finally {
      if (contentSavingItemIdRef.current === itemId) contentSavingItemIdRef.current = undefined
      setContentSavingItemId((current) => current === itemId ? undefined : current)
    }
  }

  const locateActiveItemNow = (itemId: string, sourceItems = items, review = false) => {
    const item = sourceItems.find((entry) => entry.id === itemId && !entry.deletedAt)
    setActiveModule('actions')
    setShowTrash(false)
    setDeleteConfirm(false)
    if (!item) {
      setSelectedId(undefined)
      setPendingReviewLocation(false)
      setMessage('目标记录不存在或已删除')
      return false
    }
    const statusItems = sourceItems.filter((entry) => !entry.deletedAt && entry.status === item.status)
    const itemIndex = statusItems.findIndex((entry) => entry.id === item.id)
    setFilter(item.status)
    setCurrentPage(Math.floor(itemIndex / ITEMS_PER_PAGE) + 1)
    if (review) setSelectedReview(undefined)
    setSelectedId(item.id)
    setPendingReviewLocation(review)
    return true
  }

  const locateActiveItem = (itemId: string, sourceItems = items, review = false) => {
    requestLeaveAllDrafts(() => locateActiveItemNow(itemId, sourceItems, review))
  }

  const selectWorkspaceMethod = (methodId: string) => {
    evidenceRequestId.current += 1
    setSelectedWorkspaceMethodId(methodId)
    setExpandedEvidenceMethodId(undefined)
    setMethodEvidenceDetails([])
    setMethodEvidenceLoading(false)
    setMethodEvidenceError('')
  }

  const loadAndLocateMethodNow = async (methodId: string, methodVersion?: number) => {
    const method = methods.find((entry) => entry.id === methodId)
    setActiveModule('methods')
    setMethodSearchQuery('')
    if (!method) {
      setExpandedMethodId(undefined)
      setPendingMethodLocation(undefined)
      setPendingMethodVersionLocation(undefined)
      setMessage('目标方法不存在或已删除')
      return
    }
    selectWorkspaceMethod(methodId)
    if (methodVersion) {
      const versions = methodHistories[methodId] ?? await reviewApplication.listMethodVersions(methodId)
      const reviewIds = [...new Set(versions.flatMap((version) => version.sourceReviewId ? [version.sourceReviewId] : []))]
      const loadedReviews = await Promise.all(reviewIds.filter((reviewId) => !historyReviews[reviewId]).map((reviewId) => reviewApplication.getReview(reviewId)))
      setMethodHistories((current) => ({ ...current, [methodId]: versions }))
      setHistoryReviews((current) => ({ ...current, ...Object.fromEntries(loadedReviews.filter((review): review is Review => Boolean(review)).map((review) => [review.id, review])) }))
      setExpandedMethodId(methodId)
    }
    setPendingMethodVersionLocation(methodVersion)
    setPendingMethodLocation(methodId)
  }

  const loadAndLocateMethod = (methodId: string, methodVersion?: number) => {
    requestLeaveAllDrafts(() => { void run(() => loadAndLocateMethodNow(methodId, methodVersion)) })
  }

  const navigateToNow = (target: NavigationTarget) => {
    if (target.type === 'item') {
      locateActiveItemNow(target.itemId)
      return
    }
    if (target.type === 'review') {
      locateActiveItemNow(target.itemId, items, true)
      return
    }
    if (target.type === 'backlog') {
      setActiveModule('actions')
      setShowTrash(false)
      setFilter(target.status)
      setCurrentPage(1)
      setSelectedId(undefined)
      setDeleteConfirm(false)
      setPendingReviewLocation(false)
      return
    }
    run(() => loadAndLocateMethodNow(target.methodId, target.methodVersion))
  }

  const navigateTo = (target: NavigationTarget) => {
    requestLeaveAllDrafts(() => navigateToNow(target))
  }

  const openSearch = () => {
    requestLeaveAllDrafts(() => openSearchNow())
  }

  const openSearchNow = () => {
    if (restoring) return
    searchTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setSearchExpanded(true)
    setSearchResultsOpen(shouldOpenSearchResults(searchQuery))
  }

  const collapseSearch = () => {
    const next = searchCollapseState()
    setSearchResultsOpen(next.resultsOpen)
    setSearchExpanded(next.expanded)
  }

  const exitSearch = () => {
    const next = searchExitState()
    setSearchQuery(next.query)
    setSearchResultsOpen(next.resultsOpen)
    setSearchExpanded(next.expanded)
    window.requestAnimationFrame(() => searchTriggerRef.current?.focus())
  }

  const updateSearchQuery = (value: string) => {
    setSearchQuery(value)
    setSearchError('')
    setSearchResultsOpen(shouldOpenSearchResults(value))
  }

  const locateSearchResult = (result: SearchResult) => {
    const next = searchResultSelectionState()
    setSearchResultsOpen(next.resultsOpen)
    setSearchExpanded(next.expanded)
    if (result.type === 'review' && result.itemId) {
      navigateTo({ type: 'review', itemId: result.itemId })
      return
    }
    if (result.type === 'item' && result.itemId) {
      navigateTo({ type: 'item', itemId: result.itemId })
      return
    }
    if (result.methodId) navigateTo({ type: 'method', methodId: result.methodId, methodVersion: result.methodVersion })
  }

  const locateDashboardRecord = (metric: DashboardMetricKey, record: DashboardReport['metricRecords'][DashboardMetricKey][number]) => {
    if (metric === 'newMethods' || metric === 'methodValidations' || metric === 'methodRevisions') {
      if (!record.methodId) {
        requestLeaveAllDrafts(() => {
          setActiveModule('methods')
          setExpandedMethodId(undefined)
          setPendingMethodLocation(undefined)
          setMessage('目标方法不存在或已删除')
        })
        return
      }
      navigateTo({ type: 'method', methodId: record.methodId })
      return
    }
    if (!record.itemId) {
      requestLeaveAllDrafts(() => {
        setActiveModule('actions')
        setShowTrash(false)
        setFilter(undefined)
        setSelectedId(undefined)
        setPendingReviewLocation(false)
        setMessage('目标记录不存在或已删除')
      })
      return
    }
    navigateTo({ type: metric === 'completedReviews' ? 'review' : 'item', itemId: record.itemId })
  }

  const openCapture = () => {
    requestLeaveAllDrafts(() => openCaptureNow())
  }

  const openCaptureNow = () => {
    setSearchResultsOpen(false)
    if (captureLocked) {
      setMessage(restoring ? '正在恢复数据，暂不可使用快速捕获' : '请先完成或取消当前恢复确认')
      return
    }
    captureOriginModuleRef.current = activeModule
    setActiveGlobalTool('capture')
    setCaptureDiscardConfirm(false)
  }

  const closeCapture = () => {
    if (busy || restoring) return
    if (hasCaptureContent) { setCaptureDiscardConfirm(true); return }
    setActiveGlobalTool(undefined)
  }

  const discardCapture = () => {
    setTitle('')
    setContent('')
    setCaptureTitleLimitReached(false)
    setCaptureDiscardConfirm(false)
    setActiveGlobalTool(undefined)
  }

  const createIdea = (saveForLater: boolean) => run(async () => {
    if (captureLocked) {
      setMessage(restoring ? '正在恢复数据，暂不可使用快速捕获' : '请先完成或取消当前恢复确认')
      return
    }
    let item: Item
    try { item = await application.createIdea({ title, content, saveForLater }) }
    catch (error) { if (isApiClientUnknownOutcome(error)) setCaptureUnknownOutcome(true); throw error }
    const refreshed = await refresh(item.id)
    setTitle('')
    setContent('')
    setCaptureUnknownOutcome(false)
    setCaptureDiscardConfirm(false)
    setActiveGlobalTool(undefined)
    if (captureOriginModuleRef.current === 'actions' && activeModule === 'actions') {
      locateActiveItem(item.id, refreshed.items)
      return
    }
    setCaptureCreatedItemId(item.id)
    setMessage(`已创建“${item.title}”`)
  })

  const closeStartConfirm = () => {
    if (startSubmitting) return
    setStartConfirmItemId(undefined)
    setStartPrompt('')
    setStartConfirmError('')
    setStartSaveFailed(false)
    setStartOverwriteConfirm(false)
    setStartUnknownOutcome(false)
    window.requestAnimationFrame(() => startTriggerRef.current?.focus())
  }

  const openStartConfirm = () => {
    if (!canOpenStartConfirm(selectedItem)) return
    startTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setStartConfirmItemId(selectedItem.id)
    setStartPrompt('')
    setStartConfirmError('')
    setStartSaveFailed(false)
    setStartOverwriteConfirm(false)
    setStartUnknownOutcome(false)
  }

  const requiresStartActionOverwriteConfirmation = (item: Item, prompt: string) => {
    const existingStartAction = item.startAction?.trim()
    const nextStartAction = prompt.trim()
    return item.status === 'idea_to_try' && Boolean(existingStartAction) && Boolean(nextStartAction) && existingStartAction !== nextStartAction
  }

  const confirmStart = async (withoutSaving = false, overwriteExistingStartAction = false) => {
    const item = startConfirmItem
    if (!canOpenStartConfirm(item) || startSubmitting || startUnknownOutcome) return
    const submittedPrompt = startPrompt
    const hasStartAction = Boolean(submittedPrompt.trim())
    if (!withoutSaving && requiresStartActionOverwriteConfirmation(item, submittedPrompt) && !overwriteExistingStartAction) {
      setStartOverwriteConfirm(true)
      return
    }
    if (!captureTitleWithinLimit) {
      setCaptureTitleLimitReached(true)
      return
    }
    setStartSubmitting(true)
    setStartConfirmError('')
    try {
      if (withoutSaving) await application.changeStatus(item.id, 'doing')
      else await application.startExecution(item.id, hasStartAction ? { startAction: submittedPrompt, ...(overwriteExistingStartAction ? { overwriteExistingStartAction: true } : {}) } : {})
      setFilter('doing')
      setCurrentPage(1)
      await refresh(item.id)
      setExplorationFactsVersion((version) => version + 1)
      setStartConfirmItemId(undefined)
      setStartPrompt('')
      setStartSaveFailed(false)
      setStartOverwriteConfirm(false)
      setStartUnknownOutcome(false)
      setStartedFeedbackItemId(item.id)
    } catch (error: unknown) {
      if (isApiClientUnknownOutcome(error)) {
        setStartConfirmError('本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。')
        setStartSaveFailed(false)
        setStartUnknownOutcome(true)
        handleUnknownOutcome()
      } else {
        setStartConfirmError(withoutSaving ? '未能直接开始，请重试。' : error instanceof Error ? error.message : '未能开始推进，请重试。')
        setStartSaveFailed(!withoutSaving && hasStartAction)
      }
    } finally {
      setStartSubmitting(false)
    }
  }

  const rereadStartRealFacts = async () => {
    const item = startConfirmItem
    if (!item || startSubmitting || !startUnknownOutcome) return
    setStartSubmitting(true)
    setStartConfirmError('')
    try {
      const refreshed = await refresh(item.id)
      if (![...refreshed.items, ...refreshed.trashItems].some((candidate) => candidate.id === item.id)) {
        setStartConfirmError('暂时无法确认真实事项状态，请再次重新读取。')
        return
      }
      setStartUnknownOutcome(false)
      setStartOverwriteConfirm(false)
    } catch (error) {
      setStartConfirmError(error instanceof Error ? error.message : '暂时无法重新读取真实数据。')
    } finally {
      setStartSubmitting(false)
    }
  }

  const openReviewEditor = () => {
    if (!selectedItem || (selectedItem.status !== 'doing' && selectedItem.status !== 'waiting_review')) return
    setReviewEditorItemId(selectedItem.id)
    setReviewError('')
  }

  const closeReviewEditor = () => {
    requestLeaveReview(() => {
      discardReviewDraft()
      setReviewEditorItemId(undefined)
    })
  }

  const changeStatus = (action: ItemAction) => {
    requestLeaveAllDrafts(() => run(async () => {
      if (!selectedItem) return
      const changedItemId = selectedItem.id
      const shouldRelocateAfterRefresh = (
        (selectedItem.status === 'idea_to_try' && action.status === 'idea_later')
        || (selectedItem.status === 'idea_later' && action.status === 'idea_to_try')
        || (selectedItem.status === 'doing' && action.status === 'paused')
        || (selectedItem.status === 'paused' && action.status === 'doing')
        || (selectedItem.status === 'idea_later' && action.status === 'abandoned')
        || (selectedItem.status === 'paused' && action.status === 'abandoned')
        || (selectedItem.status === 'abandoned' && action.status === 'idea_to_try')
      )
      await application.changeStatus(changedItemId, action.status)
      const refreshed = await refresh(changedItemId)
      if (shouldRelocateAfterRefresh) {
        const refreshedIndex = refreshed.items.findIndex((item) => item.id === changedItemId && item.status === action.status)
        if (refreshedIndex >= 0) {
          setMoreStatusMenuOpen(false)
          setFilter(action.status)
          setCurrentPage(Math.floor(refreshedIndex / ITEMS_PER_PAGE) + 1)
          setSelectedId(changedItemId)
        }
      }
      setExplorationFactsVersion((version) => version + 1)
    }))
  }

  const removeSelected = () => {
    requestLeaveAllDrafts(() => run(async () => {
      if (!selectedItem) return
      await application.deleteItem(selectedItem.id)
      setDeleteConfirm(false)
      setSelectedId(undefined)
      await refresh(undefined)
      setExplorationFactsVersion((version) => version + 1)
      setMessage('事项已移入回收站，30 天内可以恢复')
    }))
  }

  const restoreSelected = () => {
    requestLeaveAllDrafts(() => run(async () => {
      if (!selectedItem) return
      const restored = await application.restoreItem(selectedItem.id)
      setShowTrash(false)
      setFilter(undefined)
      await refresh(restored.id)
      setExplorationFactsVersion((version) => version + 1)
      setMessage(`“${restored.title}”已恢复`)
    }))
  }

  const restoreTrashEntry = (entry: TrashEntry) => {
    requestLeaveAllDrafts(() => run(async () => {
      if (entry.type === 'item') await application.restoreItem(entry.id)
      else if (entry.type === 'method') await methodLifecycleApplication.restoreMethod(entry.id)
      else await apiClient.restoreExplorationTrack(entry.id)
      const entries = await trashApplication.listTrashEntries(trashFilter)
      setTrashEntries(entries)
      setTrashPage((page) => Math.min(page, Math.max(1, Math.ceil(entries.length / TRASH_ENTRIES_PER_PAGE))))
      await refresh()
      setExplorationFactsVersion((version) => version + 1)
      setMessage(`“${entry.title}”已恢复`)
      setPendingTrashRestore(undefined)
    }))
  }

  const moveMethodToTrash = () => run(async () => {
    if (!methodTrashConfirmId) return
    const method = methods.find((entry) => entry.id === methodTrashConfirmId)
    await methodLifecycleApplication.moveMethodToTrash(methodTrashConfirmId)
    setMethodTrashConfirmId(undefined)
    setMethodMoreMenuId(undefined)
    setApplyingMethodId(undefined)
    setMethodActionTitle('')
    setMethodActionContent('')
    setSelectedWorkspaceMethodId('')
    setExpandedMethodId(undefined)
    setExpandedEvidenceMethodId(undefined)
    await refresh()
    setMessage(`“${method?.title ?? '该方法'}”已移入回收站，30 天内可以恢复`)
  })

  const openActiveItems = () => {
    setShowTrash(false)
    setCurrentPage(1)
    setSelectedId(undefined)
    setDeleteConfirm(false)
  }

  const openTrash = () => {
    setShowTrash(true)
    setCurrentPage(1)
    setSelectedId(undefined)
    setDeleteConfirm(false)
  }

  const downloadBackup = (backup: BackupDocument, filenamePrefix: string) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${filenamePrefix}-${backup.exportedAt.replaceAll(':', '-').slice(0, 19)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const exportBackup = () => run(async () => {
    const backup = await backupApplication.createBackup()
    downloadBackup(backup, 'knowledge-base-backup')
    setBackupMessage(`已导出 ${backup.data.items.length} 条事项、${backup.data.reviews.length} 条复盘和 ${backup.data.methods.length} 条方法`)
  })

  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const backup = JSON.parse(await file.text()) as BackupDocument
      setPendingBackup(backup)
      setBackupMessage('已选择备份文件，恢复时将由本地数据服务校验。')
    } catch (error: unknown) {
      setPendingBackup(undefined)
      setBackupMessage(error instanceof Error ? error.message : '备份文件校验失败')
    }
  }

  const restoreBackup = async () => {
    if (!pendingBackup || busy || restoring) return
    setBusy(true)
    setRestoring(true)
    setActiveGlobalTool(undefined)
    setCaptureDiscardConfirm(false)
    setTitle('')
    setContent('')
    setCaptureTitleLimitReached(false)
    setBackupMessage('正在生成恢复前安全备份…')
    try {
      const safetyBackup = await backupApplication.createBackup()
      downloadBackup(safetyBackup, 'knowledge-base-before-restore')
      setBackupMessage('安全备份已下载，正在恢复数据…')
      await backupApplication.restoreBackup(pendingBackup)
      setPendingBackup(undefined)
      setSelectedId(undefined)
      setFilter('idea_to_try')
      setShowTrash(false)
      setCurrentPage(1)
      await refresh(undefined)
      setBackupMessage('恢复完成；覆盖前的数据已自动下载为安全备份')
    } catch (error: unknown) {
      if (isApiClientUnknownOutcome(error)) {
        const notice = '本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。'
        setBackupMessage(notice)
        handleUnknownOutcome()
      } else {
        const errorMessage = error instanceof Error ? error.message : '恢复失败，原数据已保留'
        setBackupMessage(`恢复失败：${errorMessage}`)
        setMessage(errorMessage)
      }
    } finally {
      setRestoring(false)
      setBusy(false)
    }
  }

  const markMethodTouched = () => {
    if (selectedId) methodTouchedRef.current[selectedId] = true
  }

  const storeCurrentMethodDraft = () => {
    if (!selectedId || methodMode === 'none') return
    methodDraftsRef.current[selectedId] = { ...methodDraftsRef.current[selectedId], [methodMode]: methodForm }
  }

  const chooseMethodMode = (mode: MethodMode) => {
    markMethodTouched()
    if (methodMode === mode) {
      if (mode !== 'none') storeCurrentMethodDraft()
      setMethodMode('none')
      setSelectedMethodId('')
      setReviseMethod(false)
      setMethodForm(emptyMethod)
      setReviewError('')
      return
    }
    if (methodMode !== 'none') storeCurrentMethodDraft()
    setMethodMode(mode)
    setSelectedMethodId(mode === 'validate' && selectedId ? reviewMethodSelectionsRef.current[selectedId] ?? '' : '')
    setReviseMethod(false)
    setMethodForm(mode === 'none' || !selectedId ? emptyMethod : methodDraftsRef.current[selectedId]?.[mode] ?? emptyMethod)
    setReviewError('')
  }

  const chooseExistingMethod = (methodId: string) => {
    markMethodTouched()
    if (selectedId) reviewMethodSelectionsRef.current[selectedId] = methodId
    setSelectedMethodId(methodId)
    setReviseMethod(false)
    setMethodForm(emptyMethod)
    setReviewError('')
  }

  const toggleRevision = () => {
    if (!selectedReviewMethod) return
    const next = !reviseMethod
    setReviseMethod(next)
    setMethodForm(next ? {
      title: selectedReviewMethod.title,
      applicable: selectedReviewMethod.applicable,
      unsuitable: selectedReviewMethod.unsuitable,
      steps: selectedReviewMethod.steps,
    } : emptyMethod)
  }

  const switchToValidation = () => {
    const hasCreateDraft = methodMode === 'create' && Boolean(methodForm.title.trim() || methodForm.steps.trim() || methodForm.applicable.trim())
    if (hasCreateDraft) { setMethodModeSwitchConfirm(true); return }
    chooseMethodMode('validate')
  }

  const confirmSwitchToValidation = () => {
    if (selectedId) {
      delete methodDraftsRef.current[selectedId]?.create
      delete methodTouchedRef.current[selectedId]
    }
    setMethodForm(selectedId ? methodDraftsRef.current[selectedId]?.validate ?? emptyMethod : emptyMethod)
    setMethodMode('validate')
    setSelectedMethodId(selectedId ? reviewMethodSelectionsRef.current[selectedId] ?? '' : '')
    setReviseMethod(false)
    setReviewError('')
    setMethodModeSwitchConfirm(false)
  }

  const cancelMethodModeSwitch = () => setMethodModeSwitchConfirm(false)

  const openMethodApplication = (method: Method) => {
    if (applyingMethodId === method.id) {
      setApplyingMethodId(undefined)
      setMethodActionTitle('')
      setMethodActionTitleLimitReached(false)
      setMethodActionContent('')
      return
    }
    setApplyingMethodId(method.id)
    const suggestedTitle = `使用“${method.title}”完成一次行动`
    setMethodActionTitle(acceptsItemTitleInput(suggestedTitle) ? suggestedTitle : '')
    setMethodActionTitleLimitReached(false)
    setMethodActionContent('')
  }

  const createMethodAction = (method: Method) => run(async () => {
    if (!methodActionTitleWithinLimit) {
      setMethodActionTitleLimitReached(true)
      return
    }
    const item = await methodApplication.createMethodItem(method.id, methodActionTitle, methodActionContent)
    const refreshed = await refresh(item.id)
    setApplyingMethodId(undefined)
    setMethodActionTitle('')
    setMethodActionTitleLimitReached(false)
    setMethodActionContent('')
    locateActiveItem(item.id, refreshed.items)
    setMessage(`已基于“${method.title}”v${method.version} 创建行动事项`)
  })

  const toggleMethodHistory = (methodId: string) => {
    if (expandedMethodId === methodId) {
      setExpandedMethodId(undefined)
      return
    }
    run(async () => {
      const versions = methodHistories[methodId] ?? await reviewApplication.listMethodVersions(methodId)
      const reviewIds = [...new Set(versions.flatMap((version) => version.sourceReviewId ? [version.sourceReviewId] : []))]
      const missingReviewIds = reviewIds.filter((reviewId) => !historyReviews[reviewId])
      const loadedReviews = await Promise.all(missingReviewIds.map((reviewId) => reviewApplication.getReview(reviewId)))
      setMethodHistories((current) => ({ ...current, [methodId]: versions }))
      setHistoryReviews((current) => ({
        ...current,
        ...Object.fromEntries(loadedReviews.filter((review): review is Review => Boolean(review)).map((review) => [review.id, review])),
      }))
      setExpandedMethodId(methodId)
    })
  }

  const toggleMethodEvidence = (methodId: string) => {
    if (expandedEvidenceMethodId === methodId) {
      evidenceRequestId.current += 1
      setExpandedEvidenceMethodId(undefined)
      setMethodEvidenceDetails([])
      setMethodEvidenceLoading(false)
      setMethodEvidenceError('')
      return
    }

    const requestId = evidenceRequestId.current + 1
    evidenceRequestId.current = requestId
    setExpandedEvidenceMethodId(methodId)
    setMethodEvidenceDetails([])
    setMethodEvidenceLoading(true)
    setMethodEvidenceError('')

    reviewApplication.listMethodEvidenceDetails(methodId).then((details) => {
      if (evidenceRequestId.current !== requestId) return
      setMethodEvidenceDetails(details)
      setMethodEvidenceLoading(false)
    }).catch(() => {
      if (evidenceRequestId.current !== requestId) return
      setMethodEvidenceDetails([])
      setMethodEvidenceError('读取来源与验证证据失败，请稍后重试。')
      setMethodEvidenceLoading(false)
    })
  }
  const completeReview = () => run(async () => {
    if (!selectedItem) return
    const submittedReviewForm = { ...reviewFormRef.current }
    const submittedHasNewIdea = hasNewIdeaRef.current
    const missingReviewFields = ([
      ['结果', submittedReviewForm.result],
    ] satisfies Array<[string, string]>).filter(([, value]) => !value.trim()).map(([label]) => label)
    if (missingReviewFields.length) {
      setReviewError(`请填写：${missingReviewFields.join('、')}`)
      return
    }

    if (submittedReviewForm.effective !== defaultEffective && (!submittedReviewForm.effective.trim() || submittedReviewForm.effective === selectedEffective)) {
      setReviewError('已勾选“有效 / 舒服”，请填写对应内容')
      return
    }
    if (submittedReviewForm.incompatible !== defaultIncompatible && (!submittedReviewForm.incompatible.trim() || submittedReviewForm.incompatible === selectedIncompatible)) {
      setReviewError('已勾选“阻力 / 不舒服”，请填写对应内容')
      return
    }
    if (submittedHasNewIdea && !submittedReviewForm.newIdeas.trim()) {
      setReviewError('已选择产生新想法，请填写新想法内容')
      return
    }

    if (methodActionsAllowed && methodMode === 'validate' && !selectedMethodId) {
      setReviewError('请选择本次复盘验证的方法')
      return
    }

    const missingMethodFields = methodActionsAllowed && methodStarted
      ? ([
          ...(methodMode === 'create' && !methodForm.title.trim() ? ['方法名'] : []),
          ...(!methodForm.steps.trim() ? ['具体步骤'] : []),
        ])
      : []
    if (missingMethodFields.length) {
      setReviewError('请完成方法处理中的必填项')
      return
    }

    const methodTitle = methodActionsAllowed && methodMode === 'validate'
      ? selectedReviewMethod?.title ?? methodForm.title
      : methodForm.title.trim()
    const normalizedMethodForm = methodActionsAllowed && methodStarted ? {
      title: methodTitle,
      applicable: methodForm.applicable.trim() || '暂无补充说明',
      unsuitable: methodMode === 'validate' ? methodForm.unsuitable : '',
      steps: methodForm.steps,
    } : undefined

    setReviewError('')
    try {
      const result = await reviewApplication.completeReview({
        itemId: selectedItem.id,
        ...submittedReviewForm,
        actualAction: submittedReviewForm.result,
        newIdeas: submittedHasNewIdea ? submittedReviewForm.newIdeas : '',
        method: methodActionsAllowed && methodMode === 'create' ? normalizedMethodForm : undefined,
        existingMethod: methodActionsAllowed && methodMode === 'validate' && selectedMethodId ? {
          methodId: selectedMethodId,
          revision: reviseMethod ? normalizedMethodForm : undefined,
        } : undefined,
      })
      setReviewEditorItemId(undefined)
      setSelectedReview(result.review)
      resetReviewForm()
      updateHasNewIdea(false)
      setMethodForm(emptyMethod)
      setMethodMode('none')
      setSelectedMethodId('')
      setReviseMethod(false)
      await refresh(selectedItem.id)
      setExplorationFactsVersion((version) => version + 1)
      setMessage(result.createdIdea
        ? `复盘已完成，新想法“${result.createdIdea.title}”已进入想试试`
        : '复盘已完成')
    } catch (error: unknown) {
      const message = isApiClientUnknownOutcome(error)
        ? '本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。'
        : error instanceof Error ? error.message : '未能完成复盘，请稍后重试。'
      setReviewError(message)
      setMessage(message)
    }
  })

  const reviewField = (key: keyof typeof emptyReview, label: string, placeholder: string, optional = false) => (
    <View className='review-field'>
      <Text className='field-label'>{label}{optional ? '（可选）' : ''}</Text>
      <ReviewTextarea
        value={reviewForm[key]}
        placeholder={placeholder}
        onValueChange={(value) => {
          setReviewError('')
          updateReviewForm((current) => ({ ...current, [key]: value }))
        }}
      />
    </View>
  )

  const openSignalAfterMount = (key: 'effective' | 'incompatible' | 'newIdeas', select: () => void) => {
    if (signalCloseTimerRef.current) window.clearTimeout(signalCloseTimerRef.current)
    if (signalOpenFrameRef.current) window.cancelAnimationFrame(signalOpenFrameRef.current)
    setClosingSignal((current) => current === key ? undefined : current)
    setOpeningSignal(key)
    select()
    signalOpenFrameRef.current = window.requestAnimationFrame(() => {
      setOpeningSignal((current) => current === key ? undefined : current)
      signalOpenFrameRef.current = undefined
    })
  }

  const closeSignalAfterTransition = (key: 'effective' | 'incompatible' | 'newIdeas', clear: () => void) => {
    if (signalCloseTimerRef.current) window.clearTimeout(signalCloseTimerRef.current)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
    setClosingSignal(key)
    clear()
    signalCloseTimerRef.current = window.setTimeout(() => {
      setClosingSignal((current) => current === key ? undefined : current)
      signalCloseTimerRef.current = undefined
    }, 180)
  }

  const requestSignalClear = (key: 'effective' | 'incompatible' | 'newIdeas', hasContent: boolean, clear: () => void) => {
    if (!hasContent) { clear(); return }
    setPendingSignalClear(key)
  }

  const confirmSignalClear = () => {
    if (pendingSignalClear === 'newIdeas') {
      closeSignalAfterTransition('newIdeas', () => {
        updateHasNewIdea(false)
        updateReviewForm((current) => ({ ...current, newIdeas: '' }))
      })
    } else if (pendingSignalClear) {
      const key = pendingSignalClear
      closeSignalAfterTransition(key, () => updateReviewForm((current) => ({ ...current, [key]: key === 'effective' ? defaultEffective : defaultIncompatible })))
    }
    setPendingSignalClear(undefined)
  }

  const cancelSignalClear = () => setPendingSignalClear(undefined)

  const reviewCheckbox = (
    key: 'effective' | 'incompatible',
    label: string,
    emptyValue: string,
    selectedValue: string,
    placeholder: string,
  ) => {
    const checked = reviewForm[key] !== emptyValue
    return <View className='review-observation'>
      <View className='review-checkbox-option' onClick={() => {
        setReviewError('')
        if (checked) {
          const hasContent = reviewForm[key] !== selectedValue && Boolean(reviewForm[key].trim())
          requestSignalClear(key, hasContent, () => closeSignalAfterTransition(key, () => updateReviewForm((current) => ({ ...current, [key]: emptyValue }))))
          return
        }
        openSignalAfterMount(key, () => updateReviewForm((current) => ({ ...current, [key]: selectedValue })))
      }}>
        <View className={`review-checkbox ${checked ? 'active' : ''}`}><Text>{checked ? '✓' : ''}</Text></View>
        <Text>{label}</Text>
      </View>
      {(checked || openingSignal === key || closingSignal === key) && <View className={`review-signal-content ${checked && openingSignal !== key ? 'open' : ''}`}>
        <ReviewTextarea
          observation
          value={reviewForm[key] === selectedValue ? '' : reviewForm[key]}
          placeholder={placeholder}
          onValueChange={(value) => {
            setReviewError('')
            updateReviewForm((current) => ({ ...current, [key]: value }))
          }}
        />
      </View>}
    </View>
  }

  return (
    <View className='app-shell'>
      <View className='primary-navigation'>
        <View className='navigation-brand'><Text>个人系统</Text><Text>行动与方法</Text></View>
        <View className='navigation-group'>
          {(['actions', 'explorations', 'methods', 'insights'] as PrimaryModule[]).map((module) => <View
            key={module}
            className={`navigation-item ${activeModule === module ? 'active' : ''} ${restoring ? 'disabled' : ''}`}
            onClick={() => { if (!restoring) requestLeaveAllDrafts(() => setActiveModule(module)) }}
          ><Text>{moduleLabels[module]}</Text></View>)}
        </View>
        <View className='navigation-group navigation-settings'>
          <View
            className={`navigation-item ${activeModule === 'settings' ? 'active' : ''} ${restoring ? 'disabled' : ''}`}
            onClick={() => { if (!restoring) requestLeaveAllDrafts(() => setActiveModule('settings')) }}
          ><Text>数据管理</Text></View>
        </View>
        <View className='navigation-status'><View className='status-dot' /><View><Text>本地数据正常</Text><Text>{items.length} 条事项 · {methods.length} 条方法</Text></View></View>
        <View className='navigation-account'>
          <View><Text className='navigation-account-label'>当前账户</Text><Text className='navigation-account-name'>{session.user.username}</Text></View>
          <Button className='navigation-logout' disabled={logoutBusy || logoutUnknownOutcome} onClick={onLogout}>{logoutBusy ? '正在退出…' : '退出'}</Button>
          {logoutError && <Text className='navigation-account-error'>{logoutError}</Text>}
          {logoutUnknownOutcome && <Button className='navigation-session-confirm' disabled={logoutBusy} onClick={onConfirmLogoutOutcome}>重新读取当前会话</Button>}
        </View>
      </View>

      <View className='app-main'>
        <View className='global-header'>
          <View><Text className='global-module-title'>{moduleLabels[activeModule]}</Text><Text className='global-message'>{activeModule === 'explorations' ? '长期探索 · 已接入本地真实数据' : restoring ? '正在安全恢复数据，请勿离开' : message}</Text></View>
          {activeModule !== 'explorations' && <View className='global-actions'>
            <View className={`global-tool-button ${busy || restoring ? 'disabled' : ''}`} onClick={() => { if (!busy && !restoring) void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '刷新数据失败')) }}><Text>刷新数据</Text></View>
            <View className='global-search-control' ref={searchControlRef}>
              {searchExpanded ? <View className='global-search-expanded'>
                <input ref={searchInputRef} className='global-search-input' value={searchQuery} maxLength={120} placeholder='搜索事项、复盘或方法' onChange={(event) => updateSearchQuery(event.currentTarget.value)} onFocus={() => { if (searchQuery.trim()) setSearchResultsOpen(true) }} />
                <button type='button' className='global-search-exit' aria-label='退出全局搜索' onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); exitSearch() }}>×</button>
              </View> : <View className={`global-tool-button ${searchQuery.trim() ? 'has-draft' : ''}`} onClick={openSearch}><Text>全局搜索</Text></View>}
              {searchExpanded && searchResultsOpen && searchQuery.trim() && <View className='search-results-popover' role='dialog' aria-label='搜索结果'>
                {searchResults === undefined ? <Text className='search-empty'>正在搜索…</Text> : searchError ? <Text className='search-empty'>{searchError}</Text> : searchResults.length === 0 ? <Text className='search-empty'>没有找到相关记录。</Text> : (['item', 'review', 'method'] as const).map((type) => {
                  const grouped = searchResults.filter((result) => result.type === type)
                  if (!grouped.length) return null
                  return <View className='search-group' key={type}>
                    <Text className='search-group-title'>{type === 'item' ? '事项' : type === 'review' ? '复盘' : '方法'} · {grouped.length}</Text>
                    {grouped.map((result) => <View className='search-result' key={result.id} onClick={() => locateSearchResult(result)}>
                      <View><Text className='search-result-title'>{result.title}</Text><Text className='search-result-excerpt'>{result.type === 'item' && result.itemStatus ? `状态：${statusLabels[result.itemStatus]}` : result.excerpt}</Text></View>
                      <Text className='search-result-action'>{result.methodVersion ? `定位 v${result.methodVersion}` : '定位'}</Text>
                    </View>)}
                  </View>
                })}
              </View>}
            </View>
            <View className={`global-tool-button primary ${captureLocked ? 'disabled' : ''}`} onClick={openCapture}><Text>＋ 快速捕获</Text></View>
          </View>}
        </View>

        <View className='page'>

      {activeGlobalTool === 'capture' && <View className='capture-modal-backdrop'>
        <View className='capture-modal' role='dialog' aria-label='快速捕获'>
          <View className='capture-modal-heading'><View><Text className='section-kicker'>快速捕获</Text><Text>记录一个现在不想丢失的行动念头</Text></View><View className='capture-modal-close' onClick={closeCapture}><Text>关闭</Text></View></View>
          <View className='item-title-input-wrap'><Input ref={captureInputRef} className='capture-modal-input' value={title} placeholder='一句话记录你想做什么' onInput={(event) => { const next = event.detail.value; if (acceptsItemTitleInput(next)) { setTitle(next); setCaptureTitleLimitReached(false) } else setCaptureTitleLimitReached(true) }} /><Text className='item-title-counter'>{captureTitleGraphemes}/{ITEM_TITLE_MAX_GRAPHEMES}</Text></View>
          {captureTitleLimitReached && <Text className='item-title-limit-notice'>标题最多20个字符</Text>}
          <View className='capture-actions'>
            <View className={`secondary-button ${busy || captureLocked || captureUnknownOutcome || !hasCaptureContent ? 'disabled' : ''}`} onClick={() => { if (!busy && !captureLocked && !captureUnknownOutcome && hasCaptureContent) createIdea(true) }}><Text>加入以后再说</Text></View>
            <View className={`primary-button ${busy || captureLocked || captureUnknownOutcome || !hasCaptureContent ? 'disabled' : ''}`} onClick={() => { if (!busy && !captureLocked && !captureUnknownOutcome && hasCaptureContent) createIdea(false) }}><Text>{busy ? '正在创建…' : '加入想试试'}</Text></View>
          </View>
          {captureUnknownOutcome && <View className='capture-discard-confirm'><Text>提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。</Text><View><View onClick={() => { void refresh().then(() => setCaptureUnknownOutcome(false)).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '无法重新读取真实数据')) }}><Text>重新读取真实数据</Text></View></View></View>}
          {captureDiscardConfirm && <View className='capture-discard-confirm'><Text>放弃本次未保存的捕获内容？</Text><View><View onClick={() => setCaptureDiscardConfirm(false)}><Text>继续编辑</Text></View><View onClick={discardCapture}><Text>放弃</Text></View></View></View>}
        </View>
      </View>}
      {captureCreatedItemId && <View className='capture-toast'><Text>事项已创建</Text><View onClick={() => { const itemId = captureCreatedItemId; setCaptureCreatedItemId(undefined); navigateTo({ type: 'item', itemId }) }}><Text>查看事项</Text></View><View onClick={() => setCaptureCreatedItemId(undefined)}><Text>关闭</Text></View></View>}
      {contentSaveNotice && <View className='detail-content-save-toast' role='status'><Text>{contentSaveNotice}</Text></View>}
      {methodModeSwitchConfirm && <View className='review-leave-backdrop' role='dialog' aria-label='放弃本次新方法内容'>
        <View className='review-leave-confirm'>
          <Text className='section-kicker'>放弃本次新方法内容？</Text>
          <Text>切换后，本次填写的方法名、具体步骤和补充说明不会保存。</Text>
          <View className='review-leave-actions'>
            <Button id='method-switch-continue' className='action-button primary' onClick={cancelMethodModeSwitch}>继续形成新方法</Button>
            <Button className='action-button secondary' onClick={confirmSwitchToValidation}>切换并放弃</Button>
          </View>
        </View>
      </View>}
      {methodDiscardConfirm && <View className='review-leave-backdrop' role='dialog' aria-label='放弃本次方法处理'>
        <View className='review-leave-confirm'>
          <Text className='section-kicker'>放弃本次方法处理？</Text>
          <Text>收起后，本次填写的方法处理内容不会保存；你仍可完成事实复盘。</Text>
          <View className='review-leave-actions'>
            <Button id='method-discard-continue' className='action-button primary' onClick={cancelMethodDiscard}>继续处理方法</Button>
            <Button className='action-button secondary' onClick={discardMethodDraftAndClose}>收起并放弃</Button>
          </View>
        </View>
      </View>}
      {pendingSignalClear && <View className='review-signal-confirm-backdrop' role='dialog' aria-label='放弃信号补充内容'>
        <View className='review-signal-confirm'>
          <Text className='section-kicker'>放弃补充内容</Text>
          <Text>取消勾选会清除这项尚未保存的补充内容。</Text>
          <View className='review-leave-actions'>
            <Button className='action-button primary' onClick={cancelSignalClear}>继续编辑</Button>
            <Button className='action-button secondary' onClick={confirmSignalClear}>确认取消</Button>
          </View>
        </View>
      </View>}
      {reviewLeaveConfirm && <View className='review-leave-backdrop' role='dialog' aria-label='放弃未保存复盘'>
        <View className='review-leave-confirm'>
          <Text className='section-kicker'>未保存的复盘</Text>
          <Text>离开后，本次填写的事实与方法处理选择都会丢失。</Text>
          <View className='review-leave-actions'>
            <Button id='review-leave-continue' className='action-button primary' onClick={cancelLeaveReview}>继续复盘</Button>
            <Button className='action-button secondary' onClick={confirmLeaveReview}>离开并放弃</Button>
          </View>
        </View>
      </View>}

      {(activeModule === 'explorations' || explorationMounted) && <View className={activeModule === 'explorations' ? '' : 'exploration-module-retained-hidden'}><ExplorationPrototype
        explorationFactsVersion={explorationFactsVersion}
        itemUpdatedAtById={itemUpdatedAtById}
        onItemsChanged={() => refresh().then(() => reloadCurrentItemExplorationContext()).then(() => undefined)}
        onOpenItem={(locator) => {
          setActiveModule('actions')
          setFilter(locator.status)
          void refresh(locator.itemId).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '无法重新读取事项'))
        }}
        onOpenItems={(status, locatedItems) => {
          setActiveModule('actions')
          setShowTrash(false)
          setFilter(status)
          setItems(locatedItems)
          setSelectedId(undefined)
        }}
      /></View>}

      {activeModule === 'insights' && <View className='dashboard-panel module-panel'>
        <View className='dashboard-header'>
          <View>
            <Text className='section-kicker'>周期复盘</Text>
            <Text className='dashboard-title'>系统运行仪表盘</Text>
          </View>
          <Text className='module-description'>用事实观察行动闭环，并下钻到具体记录。</Text>
        </View>

        {!dashboardReport ? <View className='module-loading'><Text>正在读取周期数据…</Text></View> : <>
          <View className='dashboard-windows'>
            {([['7d', '最近 7 天'], ['30d', '最近 30 天'], ['all', '全部']] as Array<[DashboardWindow, string]>).map(([value, label]) => (
              <View key={value} className={`dashboard-window ${dashboardWindow === value ? 'active' : ''}`} onClick={() => setDashboardWindow(value)}>
                <Text>{label}</Text>
              </View>
            ))}
          </View>

          <View className='dashboard-section'>
            <Text className='dashboard-section-title'>窗口内发生</Text>
            <View className='metric-grid'>
              {([
                ['newItems', '新增事项', dashboardReport.metrics.newItems],
                ['startedExecutions', '进入执行次数', dashboardReport.metrics.startedExecutions],
                ['completedReviews', '完成复盘', dashboardReport.metrics.completedReviews],
                ['newMethods', '形成方法', dashboardReport.metrics.newMethods],
                ['methodValidations', '仅验证方法', dashboardReport.metrics.methodValidations],
                ['methodRevisions', '修订方法', dashboardReport.metrics.methodRevisions],
                ['methodApplications', '方法发起行动', dashboardReport.metrics.methodApplications],
              ] as Array<[DashboardMetricKey, string, number]>).map(([key, label, value]) => <View className={`metric-card ${dashboardMetric === key ? 'active' : ''}`} key={key} onClick={() => setDashboardMetric((current) => current === key ? undefined : key)}>
                <Text>{value}</Text><Text>{label}</Text>
              </View>)}
            </View>
            {dashboardMetric && <View className='dashboard-drilldown'>
              <View className='dashboard-drilldown-heading'><Text>对应记录 · {dashboardReport.metricRecords[dashboardMetric].length}</Text><Text onClick={() => setDashboardMetric(undefined)}>收起</Text></View>
              {dashboardReport.metricRecords[dashboardMetric].length === 0
                ? <Text className='dashboard-empty'>该窗口内没有对应记录。</Text>
                : dashboardReport.metricRecords[dashboardMetric].map((record) => <View className='dashboard-drilldown-row' key={record.id} onClick={() => locateDashboardRecord(dashboardMetric, record)}>
                  <View><Text>{record.title}</Text><Text>{record.detail}</Text></View><Text>{record.itemId || record.methodId ? '定位' : '仅记录'}</Text>
                </View>)}
            </View>}
          </View>

          <View className='dashboard-columns'>
            <View className='dashboard-section'>
              <Text className='dashboard-section-title'>当前堵塞</Text>
              {([
                ['想试试', dashboardReport.backlog.ideaToTry, 'idea_to_try'],
                ['进行中', dashboardReport.backlog.doing, 'doing'],
                ['待复盘', dashboardReport.backlog.waitingReview, 'waiting_review'],
                ['暂停', dashboardReport.backlog.paused, 'paused'],
                ['以后再说', dashboardReport.backlog.ideaLater, 'idea_later'],
              ] as Array<[string, number, ItemStatus]>).map(([label, value, status]) => <View className='backlog-row' key={status} onClick={() => navigateTo({ type: 'backlog', status })}><Text>{label}</Text><Text>{value}</Text></View>)}
            </View>

            <View className='dashboard-section'>
              <Text className='dashboard-section-title'>方法复利</Text>
              {[dashboardReport.mostValidated, dashboardReport.mostApplied, dashboardReport.recentlyRevised]
                .filter(Boolean)
                .map((insight) => <View className='insight-row' key={`${insight!.methodId}-${insight!.detail}`} onClick={() => navigateTo({ type: 'method', methodId: insight!.methodId })}>
                  <Text>{insight!.title}</Text><Text>{insight!.detail}</Text>
                </View>)}
              {!dashboardReport.mostValidated && !dashboardReport.mostApplied && !dashboardReport.recentlyRevised && (
                <Text className='dashboard-empty'>该窗口内还没有方法活动。</Text>
              )}
            </View>
          </View>

          <View className='dashboard-section dashboard-facts'>
            <Text className='dashboard-section-title'>事实提示</Text>
            {dashboardReport.facts.map((fact) => <Text key={fact}>· {fact}</Text>)}
          </View>
        </>}
      </View>}

      {activeModule === 'actions' && <>
        <View className='action-rhythm-bar'>
          <View><Text className='action-rhythm-date'>{formattedRhythmDate}</Text><Text className='action-rhythm-note'>这一周，推进一件真实的事</Text></View>
          <View className='action-rhythm-days'>{captureWeekDays.map(({ date, isToday }) => <View key={date.toISOString()} className={`action-rhythm-day ${isToday ? 'today' : ''}`}><Text>{['一', '二', '三', '四', '五', '六', '日'][(date.getDay() + 6) % 7]}</Text><Text>{date.getDate()}</Text></View>)}</View>
          <View className={`action-capture-button ${captureLocked ? 'disabled' : ''}`} onClick={openCapture}><Text>＋ 捕获</Text></View>
        </View>
        <View className={`workspace module-panel ${!showTrash && (reviewEditing || selectedItem?.status === 'reviewed') ? 'review-workspace' : ''}`} id='workspace'>
        <View className='list-panel'>
          <View className='panel-heading'><View><Text className='section-kicker'>{showTrash ? '回收站' : '事项池'}</Text><Text className='panel-title'>{visibleItems.length} 件事</Text></View></View>
          <View className='filter-header'>
            {showTrash ? <Text className='filter-guidance'>删除后保留 30 天，之后自动永久清理</Text> : filter === 'abandoned' || filter === 'waiting_review' ? <><Text className='filter-guidance'>{filter === 'abandoned' ? `已放弃 · ${abandonedItemCount} 件` : `待完成复盘（历史）· ${historicalWaitingReviewCount} 件`}</Text><View className='more-status-return' onClick={() => requestLeaveAllDrafts(() => { setFilter('idea_to_try'); setCurrentPage(1); setSelectedId(undefined) })}><Text>返回状态导航</Text></View></> : <Text className='filter-guidance'>按行动状态查看</Text>}
          </View>
          {!showTrash && filter !== 'abandoned' && filter !== 'waiting_review' && <View className='status-navigation'>
            {statusNavigation.map((entry) => <View key={entry.status} className={`filter-button ${filter === entry.status ? 'active' : ''}`} onClick={() => requestLeaveAllDrafts(() => { setFilter(entry.status); setCurrentPage(1); setSelectedId(undefined) })}><Text>{entry.label}</Text></View>)}
            <View ref={moreStatusMenuRef} className={`filter-button more-status-trigger ${moreStatusMenuOpen ? 'active' : ''}`} onClick={() => setMoreStatusMenuOpen((open) => !open)}><Text>更多状态 ▾</Text>{moreStatusMenuOpen && <View className='more-status-menu'><View onClick={() => requestLeaveAllDrafts(() => { setMoreStatusMenuOpen(false); setFilter('abandoned'); setCurrentPage(1); setSelectedId(undefined) })}><Text>已放弃（{abandonedItemCount}）</Text></View></View>}</View>
          </View>}
          <View className='list'>
            {visibleItems.length === 0 ? <View className='empty'><Text>{showTrash ? '回收站是空的。' : '这个状态下还没有事项。'}</Text><Text>{showTrash ? '删除的事项会在这里保留 30 天。' : '先捕获一个真实想法，让系统开始运转。'}</Text></View> : pagedItems.map((item) => (
              <View className={`item ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => requestLeaveAllDrafts(() => setSelectedId(item.id))}>
                <View className='item-main'><Text className='item-title'>{item.title}</Text>{sourceDisplayText(methodSourceDisplays[item.id]) && <Text className='item-method-source'>{sourceDisplayText(methodSourceDisplays[item.id])}</Text>}</View>
                <View className='item-meta'>{showTrash
                  ? <><Text className='trash-badge'>待清理</Text><Text className='time'>{Math.max(1, 30 - Math.floor((Date.now() - new Date(item.deletedAt ?? '').getTime()) / 86400000))} 天后清理</Text></>
                  : <><Text className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</Text><Text className='time'>{formatTime(item.updatedAt)}</Text></>}</View>
              </View>
            ))}
          </View>
          {visibleItems.length > ITEMS_PER_PAGE && <View className='pagination'>
            <View className={`pagination-button ${currentPage === 1 ? 'disabled' : ''}`} onClick={() => { if (currentPage > 1) requestLeaveAllDrafts(() => { setCurrentPage((page) => page - 1); setSelectedId(undefined) }) }}><Text>上一页</Text></View>
            <Text className='pagination-status'>第 {currentPage} / {totalPages} 页</Text>
            <View className={`pagination-button ${currentPage === totalPages ? 'disabled' : ''}`} onClick={() => { if (currentPage < totalPages) requestLeaveAllDrafts(() => { setCurrentPage((page) => page + 1); setSelectedId(undefined) }) }}><Text>下一页</Text></View>
          </View>}
        </View>

        <View className={`detail-panel ${!showTrash && (reviewEditing || selectedItem?.status === 'reviewed') ? 'review-mode' : ''}`}>
          {selectedItem ? <>
            <View className='detail-header'>
              <Text className='section-kicker'>{showTrash ? '回收站事项' : '当前事项'}</Text>
              <View className='detail-header-meta'>
                <Button className={`timeline-toggle ${timelineOpen ? 'active' : ''}`} onClick={() => setTimelineOpen((open) => !open)}><Text>流转历史</Text></Button>
                <View className='detail-time'><Text>创建 {formatTime(selectedItem.createdAt)}</Text><Text>更新 {formatTime(selectedItem.updatedAt)}</Text></View>
              </View>
            </View>
            {timelineOpen && <>
              <View className='status-timeline-backdrop' onClick={() => setTimelineOpen(false)} />
              <View className='status-timeline-drawer' role='dialog' aria-label='流转历史'>
              <View className='timeline-drawer-heading'><Text>流转历史</Text><View className='timeline-drawer-close' onClick={() => setTimelineOpen(false)}><Text>关闭</Text></View></View>
              <View className='status-timeline'>
              {statusEvents.length ? statusEvents.map((event) => <View className='timeline-entry' key={event.id}>
                <View className='timeline-marker' />
                <View className='timeline-content'>
                  <Text>{event.fromStatus ? `${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}` : `创建为${statusLabels[event.toStatus]}`}</Text>
                  <Text>{formatTime(event.createdAt)}</Text>
                </View>
              </View>) : <Text className='timeline-empty'>暂无流转记录。</Text>}
              </View>
            </View>
            </>}
            <View className='detail-title-row'>
              <Text className='detail-title'>{selectedItem.title}</Text>
              {!showTrash && selectedItem.startAction?.trim() && <button className='detail-start-action-chip' type='button' onClick={() => setStartActionPreview(selectedItem.startAction)}><Text>{compactStartAction(selectedItem.startAction)}</Text></button>}
            </View>
            {!showTrash && <View className='item-exploration-context' ref={itemExplorationContextRef}>
              <Text className='detail-content-label'>探索主线</Text>
              {itemExplorationLoading ? <Text className='item-exploration-copy'>正在载入探索主线关联…</Text>
                : itemExplorationError ? <View className='item-exploration-error'><Text>{itemExplorationError}</Text><Button className='exploration-inline-button' onClick={() => { if (selectedId) { explorationContextAbortRef.current?.abort(); const controller = new AbortController(); explorationContextAbortRef.current = controller; setItemExplorationLoading(true); setItemExplorationError(''); application.getItemExplorationTrack(selectedId, controller.signal).then((context) => { if (!controller.signal.aborted) { setItemExplorationContext(context); setItemExplorationUnknownOutcome(false) } }).catch((error: unknown) => { if (!isApiClientAbort(error) && !controller.signal.aborted) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入探索主线关联。') }).finally(() => { if (!controller.signal.aborted) setItemExplorationLoading(false) }) } }}>{itemExplorationUnknownOutcome ? '重新读取真实数据' : '重试读取'}</Button></View>
                : itemExplorationContext?.status === 'available' ? <View className='item-exploration-row'><Text className='item-exploration-copy'>{itemExplorationContext.track.name}</Text>{canModifySelectedItemExploration && <View className='item-exploration-actions'><Button className='exploration-inline-button' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void openExplorationSelector()}>调整</Button><Button className='exploration-inline-button danger' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void removeSelectedItemFromExplorationTrack()}>移除</Button></View>}</View>
                    : itemExplorationContext?.status === 'track-deleted' ? <Text className='item-exploration-copy'>原探索主线已删除：{itemExplorationContext.track.name}</Text>
                      : itemExplorationContext?.status === 'unavailable' ? <View><Text className='item-exploration-copy'>关联探索主线暂不可用</Text><Text className='item-exploration-copy'>请保留当前事项并等待数据修复。</Text></View>
                        : <View className='item-exploration-row'><Text className='item-exploration-copy muted'>未归入探索主线</Text>{canModifySelectedItemExploration && <Button className='exploration-inline-button' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void openExplorationSelector()}>归入</Button>}</View>}
              {explorationSelectorOpen && canModifySelectedItemExploration && <View className='item-exploration-selector'><Text className='item-exploration-selector-heading'>归入探索主线</Text><View className='item-exploration-selector-options'>{selectableExplorationTracks.map((track) => <Button key={track.id} className='exploration-inline-button' disabled={itemExplorationSaving} onClick={() => void assignSelectedItemToExplorationTrack(track.id)}>{track.name}</Button>)}{selectableExplorationTracks.length === 0 && <Text className='item-exploration-copy'>还没有可选探索主线。</Text>}</View><Button className='exploration-inline-button item-exploration-selector-cancel' disabled={itemExplorationSaving} onClick={() => setExplorationSelectorOpen(false)}>取消</Button></View>}
            </View>}
            {showTrash && <Text className='detail-status trash-badge'>将在 30 天内自动清理</Text>}
            {!showTrash && startFeedbackVisible(startedFeedbackItemId, selectedItem) && <View className='started-feedback' role='status'>
              <Text>✓ 已开始推进</Text>
              <Text>现在先从一个小动作开始。</Text>
            </View>}
            {!showTrash && (!contentBelowFacts || selectedItem.status === 'reviewed') && <View className={`action-context-summary ${contentEditingItemId === selectedItem.id ? 'editing' : ''}`}>
              <div className={`action-context-card action-context-content ${contentEditingItemId === selectedItem.id ? 'editing' : ''} ${contentEditingItemId !== selectedItem.id ? 'clickable' : ''}`} ref={contentEditingItemId === selectedItem.id ? contentEditorRef : undefined} role={contentEditingItemId !== selectedItem.id ? 'button' : undefined} tabIndex={contentEditingItemId !== selectedItem.id ? 0 : undefined} onMouseDown={(event) => { if (contentEditingItemId !== selectedItem.id) { event.preventDefault(); openContentEditor() } }} onKeyDown={(event) => { if (contentEditingItemId !== selectedItem.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openContentEditor() } }}>
                <View className='detail-content-heading'>
                  <Text className='detail-content-label'>补充：</Text>
                  {contentEditingItemId !== selectedItem.id && <Text className={`action-context-inline-value ${selectedItem.content ? '' : 'muted'}`}>{selectedItem.content || '暂无说明。'}</Text>}
                  {contentEditingItemId !== selectedItem.id && <Button className='detail-content-edit' onClick={openContentEditor}><Text>{selectedItem.content ? '编辑' : '添加说明'}</Text></Button>}
                </View>
                {contentEditingItemId === selectedItem.id && <View className='detail-content-editor'>
                  <textarea ref={contentInputRef} className='detail-content-input' value={contentDraft} maxLength={1000} placeholder='补充这件事的背景、约束或想法' onInput={(event) => { resizeContentEditor(event.currentTarget); updateContentDraft(selectedItem.id, event.currentTarget.value) }} />
                  {contentSaveError && <View className='detail-content-save-feedback error'><Text>{contentSaveError}</Text>{!contentSaveUnknownOutcome && <Button className='detail-content-retry' disabled={contentSavingItemId === selectedItem.id} onClick={retrySaveItemContent}>重试</Button>}</View>}
                </View>}
              </div>
            </View>}


            {(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review' || selectedItem.status === 'reviewed') && methodContextAvailable && <View className='method-application-context'>
              <Text className='method-label'>本次行动使用的方法</Text>
              <Text>{methodApplicationContextResult.version.title} v{methodApplicationContextResult.application.methodVersion}</Text>
              {(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <Text>你可以先完成事实复盘，再决定是否验证或修订该方法。</Text>}
            </View>}
            {(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review' || selectedItem.status === 'reviewed') && methodContextUnavailable && <View className='method-application-context unavailable'><Text>{unavailableMethodContextMessage}</Text></View>}
            {(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review' || selectedItem.status === 'reviewed') && methodContextLifecycleUnavailable && <View className='method-application-context unavailable'><Text>{lifecycleMethodContextMessage}</Text></View>}

            {!showTrash && reviewEditing && <View className='review-form' id='review-section'>
              <View className='review-heading'><View><Text className='section-kicker'>完成复盘</Text><Text className='review-title'>先写事实，再决定是否处理方法</Text></View><Button className='action-button secondary' disabled={busy} onClick={closeReviewEditor}>取消</Button></View>
              <View className='review-facts-card'>
                {reviewField('result', '结果怎样', '结果、产出或可观察变化')}
                <Text className='review-signals-label'>这次过程有什么感受或后续线索？可选，可多选。</Text>
                <View className='review-checkbox-group review-signals'>
                  {reviewCheckbox('effective', '有效 / 舒服', defaultEffective, selectedEffective, '哪些地方有效或舒服，值得保留')}
                  {reviewCheckbox('incompatible', '阻力 / 不舒服', defaultIncompatible, selectedIncompatible, '哪些地方有阻力、代价或不舒服')}
                  <View className='review-observation'>
                    <View className='review-checkbox-option' onClick={() => {
                      setReviewError('')
                      if (hasNewIdea) {
                        requestSignalClear('newIdeas', Boolean(reviewForm.newIdeas.trim()), () => closeSignalAfterTransition('newIdeas', () => {
                          updateHasNewIdea(false)
                          updateReviewForm((current) => ({ ...current, newIdeas: '' }))
                        }))
                        return
                      }
                      openSignalAfterMount('newIdeas', () => updateHasNewIdea(true))
                    }}>
                      <View className={`review-checkbox ${hasNewIdea ? 'active' : ''}`}><Text>{hasNewIdea ? '✓' : ''}</Text></View>
                      <Text>产生新想法</Text>
                    </View>
                    {(hasNewIdea || openingSignal === 'newIdeas' || closingSignal === 'newIdeas') && <View className={`review-signal-content ${hasNewIdea && openingSignal !== 'newIdeas' ? 'open' : ''}`}><ReviewTextarea observation value={reviewForm.newIdeas} placeholder='记录新想法，完成复盘后自动进入想试试' onValueChange={(value) => { setReviewError(''); updateReviewForm((current) => ({ ...current, newIdeas: value })) }} /></View>}
                  </View>
                </View>
              </View>

              <View className={`method-draft ${methodDisclosureOpen ? 'expanded' : ''}`}>
                <View className='method-disclosure-toggle' onClick={toggleMethodDisclosure}>
                  <View><Text className='section-kicker'>方法处理（可选）</Text><Text>{methodDisclosureOpen ? '收起方法处理，继续完成事实复盘' : '完成事实复盘后，如有需要再沉淀方法'}</Text></View>
                  <Text>{methodDisclosureOpen ? '收起' : '展开'}</Text>
                </View>
                {methodDisclosureOpen && <>
                  {methodContextAvailable && <View className='method-relation-summary'><Text>本事项由「{methodApplicationContextResult.version.title}」v{methodApplicationContextResult.application.methodVersion} 发起</Text><Text>这只是来源上下文；是否验证或修订由你决定。</Text></View>}
                  {methodContextUnavailable && <Text className='method-unavailable'>{unavailableMethodContextMessage}</Text>}
                  {methodContextLifecycleUnavailable && <Text className='method-unavailable'>{lifecycleMethodContextMessage}</Text>}
                  {methodApplicationContextError && <Text className='method-unavailable'>{methodApplicationContextError}</Text>}
                  {methodActionsAllowed && <>
                    <View className='method-mode-actions'>
                      <View className={`method-mode-button ${methodMode === 'create' ? 'active' : ''}`} onClick={() => chooseMethodMode('create')}><Text>形成新方法</Text></View>
                      <View className={`method-mode-button ${methodMode === 'validate' ? 'active' : ''} ${methods.length === 0 ? 'disabled' : ''}`} onClick={() => { if (methods.length > 0) switchToValidation() }}><Text>验证已有方法</Text></View>
                    </View>
                    {methods.length === 0 && <Text className='method-unavailable'>当前没有可验证的方法；不影响完成事实复盘。</Text>}
                    {methodMode === 'validate' && <View className='existing-methods'>
                      {methods.map((method) => <View key={method.id} className={`existing-method-button ${selectedMethodId === method.id ? 'active' : ''}`} onClick={() => chooseExistingMethod(method.id)}><Text className='existing-method-title'>{method.title}</Text><Text className='existing-method-meta'>v{method.version} · 已验证 {method.validationCount} 次</Text></View>)}
                      {selectedReviewMethod && <View className='selected-method-summary'><Text>当前步骤：{selectedReviewMethod.steps}</Text><View className={`method-revision-button ${reviseMethod ? 'active' : ''}`} onClick={toggleRevision}><Text>{reviseMethod ? '取消修订，仅验证' : '根据本次复盘修订方法'}</Text></View></View>}
                    </View>}
                    {(methodMode === 'create' || reviseMethod) && <View className='method-fields'>
                      {methodMode === 'create' && <>
                        <Text className='method-field-label'>方法名 *</Text>
                        <Input className='method-input method-title-input' value={methodForm.title} maxlength={120} placeholder='例如：行动结束后 10 分钟事实复盘' onInput={(event) => { setReviewError(''); setMethodForm((current) => ({ ...current, title: event.detail.value })) }} />
                        <Text className='method-field-hint'>用一句短语命名这套下次还能复用的做法。</Text>
                        {reviewError && !methodForm.title.trim() && <Text className='method-field-error'>给这套做法起一个方便以后找到的名称。</Text>}
                      </>}
                      <Text className='method-field-label'>具体步骤 *</Text>
                      <ReviewTextarea value={methodForm.steps} placeholder='记录下次可重复执行的具体步骤。' onValueChange={(value) => { setReviewError(''); setMethodForm((current) => ({ ...current, steps: value })) }} />
                      {reviewError && !methodForm.steps.trim() && <Text className='method-field-error'>请记录这套方法下次如何执行。</Text>}
                      <Text className='method-field-label'>补充：（可选）</Text>
                      <ReviewTextarea value={methodForm.applicable === '暂无补充说明' ? '' : methodForm.applicable} placeholder='补充适用情境、注意事项或边界' onValueChange={(value) => setMethodForm((current) => ({ ...current, applicable: value }))} />
                    </View>}
                  </>}
                </>}
              </View>
              {reviewError && <Text className='form-error'>{reviewError}</Text>}
              <Button className='action-button primary review-submit-button' disabled={busy} onClick={completeReview}>完成复盘{methodMode === 'create' ? '并形成方法' : methodMode === 'validate' ? reviseMethod ? '并修订方法' : '并验证方法' : ''}</Button>
            </View>}

            {!showTrash && selectedItem.status === 'reviewed' && selectedReview && <View className='review-record' id='review-section'>
              <Text className='section-kicker'>复盘证据</Text>
              {([
                ...(selectedReview.actualAction !== selectedReview.result ? [['实际行动', selectedReview.actualAction]] : []),
                ['结果', selectedReview.result],
                ...(selectedReview.effective && selectedReview.effective !== defaultEffective ? [['有效 / 舒服', selectedReview.effective]] : []),
                ...(selectedReview.incompatible && selectedReview.incompatible !== defaultIncompatible ? [['阻力 / 不舒服', selectedReview.incompatible]] : []),
                ['下次调整', selectedReview.adjustment],
                ['新想法', selectedReview.newIdeas],
              ] as Array<[string, string]>).filter(([, value]) => value).map(([label, value]) => <View className='review-record-row' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}
            </View>}

            {!showTrash && contentBelowFacts && selectedItem.status !== 'reviewed' && <View className={`action-context-summary detail-content-after-facts ${contentEditingItemId === selectedItem.id ? 'editing' : ''}`}>
              <div className={`action-context-card action-context-content ${contentEditingItemId === selectedItem.id ? 'editing' : ''} ${contentEditingItemId !== selectedItem.id ? 'clickable' : ''}`} ref={contentEditingItemId === selectedItem.id ? contentEditorRef : undefined} role={contentEditingItemId !== selectedItem.id ? 'button' : undefined} tabIndex={contentEditingItemId !== selectedItem.id ? 0 : undefined} onMouseDown={(event) => { if (contentEditingItemId !== selectedItem.id) { event.preventDefault(); openContentEditor() } }} onKeyDown={(event) => { if (contentEditingItemId !== selectedItem.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openContentEditor() } }}>
                <View className='detail-content-heading'>
                  <Text className='detail-content-label'>补充：</Text>
                  {contentEditingItemId !== selectedItem.id && <Text className={`action-context-inline-value ${selectedItem.content ? '' : 'muted'}`}>{selectedItem.content || '暂无说明。'}</Text>}
                  {contentEditingItemId !== selectedItem.id && <Button className='detail-content-edit' onClick={openContentEditor}><Text>{selectedItem.content ? '编辑' : '添加说明'}</Text></Button>}
                </View>
                {contentEditingItemId === selectedItem.id && <View className='detail-content-editor'>
                  <textarea ref={contentInputRef} className='detail-content-input' value={contentDraft} maxLength={1000} placeholder='补充这件事的背景、约束或想法' onInput={(event) => { resizeContentEditor(event.currentTarget); updateContentDraft(selectedItem.id, event.currentTarget.value) }} />
                  {contentSaveError && <View className='detail-content-save-feedback error'><Text>{contentSaveError}</Text>{!contentSaveUnknownOutcome && <Button className='detail-content-retry' disabled={contentSavingItemId === selectedItem.id} onClick={retrySaveItemContent}>重试</Button>}</View>}
                </View>}
              </div>
            </View>}


            {shouldDisplayStartAction(selectedItem) && showTrash && <View className={`start-action-record ${contentBelowFacts ? 'start-action-after-facts' : ''}`}>
              <Text className='start-action-label'>启动动作</Text>
              <Text className='start-action-value'>{selectedItem.startAction}</Text>
            </View>}

            {showTrash ? <View className='action-stack'>
              <Button className='action-button primary' disabled={busy} onClick={restoreSelected}>恢复事项</Button>
            </View> : !reviewEditing && <View className='action-stack'>
              {(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <Button className='action-button primary' disabled={busy} onClick={openReviewEditor}>开始复盘</Button>}
              {actionsFor(selectedItem).filter((action) => !(action.status === 'abandoned' && (selectedItem.status === 'idea_to_try' || selectedItem.status === 'doing'))).map((action) => <Button key={action.status} className={`action-button ${action.tone}`} disabled={busy} onClick={() => shouldInterceptStartAction(selectedItem, action) ? requestLeaveAllDrafts(openStartConfirm) : changeStatus(action)}>{action.label}</Button>)}
              {deleteConfirm ? <View className='delete-confirm'>
                <Text>确定删除“{selectedItem.title}”？删除后可在回收站保留 30 天。</Text>
                <View className='delete-confirm-actions'>
                  <Button className='action-button secondary' disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button>
                  <Button className='action-button delete-confirm-button' disabled={busy} onClick={removeSelected}>确认删除</Button>
                </View>
              </View> : <Button className='action-button delete' disabled={busy} onClick={() => requestLeaveAllDrafts(() => setDeleteConfirm(true))}>删除事项</Button>}
            </View>}
          </> : <View className='detail-empty'><Text className='detail-empty-title'>选择一件事</Text><Text>查看详情，并推动它进入下一个真实状态。</Text></View>}
        </View>
      </View></>}

      {startConfirmItemId && canOpenStartConfirm(startConfirmItem) && <View className='start-confirm-backdrop' onClick={(event) => { if (!startSubmitting && event.target === event.currentTarget) closeStartConfirm() }}>
        <View className='start-confirm-modal' ref={startConfirmRef} role='dialog' aria-modal='true' aria-labelledby='start-confirm-title'>
          <View className='start-confirm-heading'>
            <Text id='start-confirm-title'>开始推进「{startConfirmItem.title}」</Text>
            <Button className='start-confirm-close' aria-label='关闭启动确认层' disabled={startSubmitting} onClick={closeStartConfirm}>×</Button>
          </View>
          {startUnknownOutcome ? <>
            <Text className='start-confirm-description'>提交结果尚未确认。不会自动重试，请重新读取真实数据后再决定下一步。</Text>
            {startConfirmError && <Text className='start-confirm-error'>{startConfirmError}</Text>}
            <View className='start-confirm-actions'><Button className='action-button secondary start-confirm-cancel' disabled={startSubmitting} onClick={closeStartConfirm}>取消</Button><Button className='action-button primary' disabled={startSubmitting} onClick={() => void rereadStartRealFacts()}>{startSubmitting ? '正在读取…' : '重新读取真实数据'}</Button></View>
          </> : startOverwriteConfirm ? <>
            <Text className='start-confirm-description'>已有启动动作：{startConfirmItem.startAction}</Text>
            <Text className='start-confirm-description'>确认后将覆盖为：{startPrompt.trim()}</Text>
            <Text className='start-confirm-hint'>覆盖后会立即开始执行，且不能撤销。</Text>
            {startConfirmError && <Text className='start-confirm-error'>{startConfirmError}</Text>}
            <View className='start-confirm-actions'><Button className='action-button secondary start-confirm-cancel' disabled={startSubmitting} onClick={() => { setStartOverwriteConfirm(false); setStartConfirmError('') }}>取消</Button><Button className='action-button primary' disabled={startSubmitting} onClick={() => void confirmStart(false, true)}>{startSubmitting ? '正在开始…' : '确认覆盖并开始'}</Button></View>
          </> : <>
            <Text className='start-confirm-description'>它现在进入执行阶段。先从一个小动作开始就够了。</Text>
            <Text className='start-confirm-label'>此刻准备先做什么？（可选）</Text>
            <textarea ref={startPromptRef} className='start-confirm-input' value={startPrompt} disabled={startSubmitting} placeholder='例如：先找一份入门资料，花 10 分钟看一遍。' onInput={(event) => { setStartPrompt(event.currentTarget.value); setStartSaveFailed(false); setStartOverwriteConfirm(false); setStartConfirmError('') }} />
            <Text className='start-confirm-hint'>开始后会作为不可编辑的启动动作保留在事项中。</Text>
            {startConfirmError && <Text className='start-confirm-error'>{startConfirmError}</Text>}
            <View className='start-confirm-actions'>
              {startSaveFailed ? <>
                <Button className='action-button secondary start-confirm-cancel' disabled={startSubmitting} onClick={() => confirmStart(true)}>不保存，直接开始</Button>
                <Button className='action-button primary' disabled={startSubmitting} onClick={() => confirmStart()}>{startSubmitting ? '正在开始…' : '重试保存'}</Button>
              </> : <>
                <Button className='action-button secondary start-confirm-cancel' disabled={startSubmitting} onClick={closeStartConfirm}>取消</Button>
                <Button className='action-button primary' disabled={startSubmitting} onClick={() => confirmStart()}>{startSubmitting ? '正在开始…' : '开始！'}</Button>
              </>}
            </View>
          </>}
        </View>
      </View>}

      {startActionPreview && <View className='start-action-preview-backdrop' onClick={() => setStartActionPreview(undefined)}>
        <View className='start-action-preview-modal' role='dialog' aria-modal='true' aria-label='启动动作全文'>
          <div className='start-action-preview-value'>{startActionPreview}</div>
        </View>
      </View>}

      {activeModule === 'settings' && <View className='settings-module module-panel'>
        <View className='trash-panel'>
          <View className='backup-heading'><View><Text className='section-kicker'>回收站</Text><Text className='panel-title'>已删除的事项、方法和探索主线</Text></View><Text className='backup-description'>事项和方法保留 30 天；探索主线当前不自动清理，可在此恢复。</Text></View>
          <View className='trash-filter-actions'>{(['all', 'item', 'method', 'exploration-track'] as TrashFilter[]).map((entry) => <View key={entry} className={`all-filter-button ${trashFilter === entry ? 'active' : ''}`} onClick={() => { setTrashFilter(entry); setTrashPage(1) }}><Text>{{ all: '全部', item: '事项', method: '方法', 'exploration-track': '探索主线' }[entry]}</Text></View>)}</View>
          {trashLoading ? <Text className='method-evidence-state'>正在读取回收站…</Text> : trashEntries.length === 0 ? <Text className='method-evidence-state'>回收站是空的。</Text> : <><View className='trash-entry-list'>{visibleTrashEntries.map((entry) => <View className='trash-entry' key={`${entry.type}-${entry.id}`}><View><Text className='trash-entry-title'>{entry.title}</Text><Text className='trash-entry-meta'>{entry.type === 'exploration-track' ? `探索主线 · 删除于 ${formatTime(entry.deletedAt)} · 当前不自动清理，可在此恢复` : `${entry.type === 'item' ? '事项' : '方法'} · 删除于 ${formatTime(entry.deletedAt)} · 剩余 ${remainingTrashDays(entry.deletedAt)} 天`}</Text></View><Button className='action-button secondary' disabled={busy} onClick={() => setPendingTrashRestore(entry)}>恢复</Button></View>)}</View>{trashPageCount > 1 && <View className='pagination trash-pagination'><View className={`pagination-button ${trashPage === 1 ? 'disabled' : ''}`} onClick={() => { if (trashPage > 1) setTrashPage((page) => page - 1) }}><Text>上一页</Text></View><Text className='pagination-status'>第 {trashPage} / {trashPageCount} 页</Text><View className={`pagination-button ${trashPage === trashPageCount ? 'disabled' : ''}`} onClick={() => { if (trashPage < trashPageCount) setTrashPage((page) => page + 1) }}><Text>下一页</Text></View></View>}</>}
        </View>
        <View className='data-status-panel'>
          <View><Text className='section-kicker'>本地数据状态</Text><Text className='panel-title'>数据仅保存在当前浏览器</Text></View>
          <View className='data-status-grid'>
            <View><Text>{items.length}</Text><Text>有效事项</Text></View>
            <View><Text>{methods.length}</Text><Text>当前方法</Text></View>
            <View><Text>{trashItems.length}</Text><Text>回收站</Text></View>
          </View>
        </View>
        <View className='backup-panel'>
        <View className='backup-heading'>
          <View><Text className='section-kicker'>数据备份</Text><Text className='panel-title'>导出与恢复</Text></View>
          <Text className='backup-description'>数据仅保存在当前浏览器。建议每周及重大更新前导出一次 JSON 备份。</Text>
        </View>
        <View className='backup-actions'>
          <View className={`secondary-button backup-export-button ${busy ? 'disabled' : ''}`} onClick={() => { if (!busy) exportBackup() }}><Text>导出完整备份</Text></View>
          <label className={`file-button ${busy ? 'disabled' : ''}`}>导入恢复<input className='backup-file-input' style={{ display: 'none' }} type='file' accept='application/json,.json' disabled={busy} onChange={selectBackup} /></label>
        </View>
        {backupMessage && <Text className={`backup-message ${pendingBackup ? 'warning' : ''}`}>{backupMessage}</Text>}
        {pendingBackup && <View className='restore-confirm'>
          <Text>备份时间：{formatTime(pendingBackup.exportedAt)}</Text>
          <Text>{pendingBackup.data.items.length} 条事项 · {pendingBackup.data.reviews.length} 条复盘 · {pendingBackup.data.methods.length} 条方法</Text>
          <Text className='restore-warning'>恢复会完整覆盖当前浏览器中的全部数据。确认后，系统会先自动下载当前数据的安全备份，再执行恢复。</Text>
          <View className='restore-actions'>
            <View className={`secondary-button restore-cancel-button ${busy ? 'disabled' : ''}`} onClick={() => { if (!busy) { setPendingBackup(undefined); setBackupMessage('已取消恢复') } }}><Text>取消</Text></View>
            <Button className='action-button delete-confirm-button' disabled={busy} onClick={restoreBackup}>备份当前数据并恢复</Button>
          </View>
        </View>}
      {pendingTrashRestore && <View className='trash-restore-backdrop' onClick={() => { if (!busy) setPendingTrashRestore(undefined) }}><View className='trash-restore-confirm' role='dialog' aria-label='恢复确认' onClick={(event) => event.stopPropagation()}><Text>恢复“{pendingTrashRestore.title}”？</Text><Text>恢复后将重新回到当前可用数据中。</Text><View><Button className='action-button secondary' disabled={busy} onClick={() => setPendingTrashRestore(undefined)}>取消</Button><Button className='action-button primary' disabled={busy} onClick={() => restoreTrashEntry(pendingTrashRestore)}>恢复</Button></View></View></View>}
        {restoring && <View className='restore-progress'><View className='status-dot' /><Text>恢复正在进行，一级导航已暂时锁定。</Text></View>}
      </View>
      </View>}

      {activeModule === 'methods' && <View className='methods-panel module-panel'>
        <View className='methods-page-header'><View><Text className='section-kicker'>当前有效的方法</Text><Text className='panel-title'>{methods.length} 条方法</Text></View><Text>按最近更新排序</Text></View>
        <View className='methods-workbench'>
          {methods.length === 0 ? <View className='methods-empty'><Text>完成复盘时，可以把已验证的结论提炼成方法。</Text></View> : <>
          <View className='method-list-pane'>
            <Input className='method-search-input' value={methodSearchQuery} maxlength={120} placeholder='搜索方法名称、步骤或说明' onInput={(event) => setMethodSearchQuery(event.detail.value)} />
            {workspaceMethods.length === 0 ? <Text className='method-list-empty'>没有匹配的方法</Text> : <View className='method-list'>{workspaceMethods.map((method) => <View key={method.id} className={`method-list-row ${selectedWorkspaceMethodId === method.id ? 'active' : ''}`} onClick={() => selectWorkspaceMethod(method.id)}><Text className='method-list-title'>{method.title}</Text><Text className='method-list-meta'>v{method.version} · 验证 {method.validationCount} 次 · {formatTime(method.updatedAt)}</Text><Text className='method-list-summary'>{method.steps.split(/\r?\n/, 1)[0]}</Text></View>)}</View>}
          </View>
          <View className='method-detail-pane'>
            {!selectedWorkspaceMethod ? <View className='method-detail-empty'><Text>未选择方法</Text><Text>{methodSearchQuery.trim() ? '当前搜索结果不包含已选方法，请从左侧选择。' : '从左侧列表选择一条方法查看详情。'}</Text></View> : (() => {
              const method = selectedWorkspaceMethod
              const history = methodHistories[method.id] ?? []
              const expanded = expandedMethodId === method.id
              return <View id={`method-${method.id}`} className='method-detail'>
                <View className='method-card-heading'>
                  <Text>{method.title}</Text>
                  <View className='method-card-actions'>
                    <Text>v{method.version} · 验证 {method.validationCount} 次</Text>
                    <View className='method-more-actions' ref={methodMoreMenuRef}>
                      <button
                        ref={methodMoreTriggerRef}
                        type='button'
                        className={`method-more-trigger ${methodMoreMenuId === method.id ? 'active' : ''}`}
                        aria-label='更多操作'
                        aria-haspopup='menu'
                        aria-expanded={methodMoreMenuId === method.id}
                        onClick={() => setMethodMoreMenuId((current) => current === method.id ? undefined : method.id)}
                      >
                        <svg aria-hidden='true' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'><circle cx='5' cy='12' r='1' fill='currentColor' stroke='none' /><circle cx='12' cy='12' r='1' fill='currentColor' stroke='none' /><circle cx='19' cy='12' r='1' fill='currentColor' stroke='none' /></svg><span className='method-more-label'>更多</span>
                      </button>
                      {methodMoreMenuId === method.id && <View className='method-more-menu' role='menu'><View className='method-more-menu-danger' role='menuitem' onClick={() => { setMethodMoreMenuId(undefined); setMethodTrashConfirmId(method.id) }}><Text>移入回收站</Text></View></View>}
                    </View>
                  </View>
                </View>
                {methodTrashConfirmId === method.id && <View className='method-trash-confirm'><Text>将“{method.title}”移入回收站？30 天内可以恢复；历史关联会保留说明。</Text><View><Button id='method-trash-cancel' className='action-button secondary' disabled={busy} onClick={() => setMethodTrashConfirmId(undefined)}>取消</Button><Button className='action-button delete-confirm-button' disabled={busy} onClick={moveMethodToTrash}>移入回收站</Button></View></View>}
                <Text className='method-label'>具体步骤</Text><Text className='method-value'>{method.steps}</Text>
                <Text className='method-label'>补充：</Text><Text className='method-value'>{method.applicable || '暂无补充说明'}</Text>
                {method.unsuitable && <><Text className='method-label'>不适用情况</Text><Text className='method-value'>{method.unsuitable}</Text></>}
                <View className={`method-apply-button ${applyingMethodId === method.id ? 'active' : ''}`} onClick={() => openMethodApplication(method)}><Text>{applyingMethodId === method.id ? '取消创建行动' : '用此方法开始行动'}</Text></View>
                {applyingMethodId === method.id && <View className='method-apply-form'><View className='item-title-input-wrap'><input className='method-action-input' value={methodActionTitle} placeholder='这次具体要完成什么' onInput={(event) => { const next = event.currentTarget.value; if (acceptsItemTitleInput(next)) { setMethodActionTitle(next); setMethodActionTitleLimitReached(false) } else setMethodActionTitleLimitReached(true) }} /><Text className='item-title-counter'>{methodActionTitleGraphemes}/{ITEM_TITLE_MAX_GRAPHEMES}</Text></View>{methodActionTitleLimitReached && <Text className='item-title-limit-notice'>标题最多20个字符</Text>}<textarea className='method-action-textarea' value={methodActionContent} maxLength={1000} placeholder='补充目标、场景或约束（可选）' onInput={(event) => setMethodActionContent(event.currentTarget.value)} /><View className={`method-action-submit ${methodActionTitle.trim() && methodActionTitleWithinLimit && !busy ? '' : 'disabled'}`} onClick={() => methodActionTitle.trim() && methodActionTitleWithinLimit && !busy && createMethodAction(method)}><Text>创建到想试试</Text></View></View>}
                <View className={`method-evidence-button ${expandedEvidenceMethodId === method.id ? 'active' : ''}`} onClick={() => toggleMethodEvidence(method.id)}><Text>{expandedEvidenceMethodId === method.id ? '收起来源与验证证据' : '查看来源与验证证据'}</Text></View>
                {expandedEvidenceMethodId === method.id && <View className='method-evidence-panel'><Text className='method-evidence-title'>来源与验证证据</Text>{methodEvidenceLoading ? <Text className='method-evidence-state'>正在读取证据…</Text> : methodEvidenceError ? <Text className='method-evidence-state error'>{methodEvidenceError}</Text> : methodEvidenceDetails.length === 0 ? <Text className='method-evidence-state'>暂无来源与验证证据</Text> : <View className='method-evidence-list'>{methodEvidenceDetails.map((evidence) => <View className='method-evidence-entry' key={evidence.evidenceId}><View className='method-evidence-entry-heading'><Text className={`method-evidence-relation ${evidence.relation}`}>{evidenceRelationLabels[evidence.relation]}</Text><Text className='method-evidence-time'>{formatTime(evidence.reviewCreatedAt)}</Text></View><Text className='method-evidence-item'>{evidence.itemTitle}</Text><Text className='method-evidence-summary'>{formatEvidenceSummary(evidence.reviewSummary)}</Text>{evidence.methodVersion !== undefined && <Text className='method-evidence-version'>对应方法版本 v{evidence.methodVersion}</Text>}{evidence.relation === 'unknown' && <Text className='method-evidence-unknown'>关系类型无法从旧数据中确定</Text>}</View>)}</View>}</View>}
                <View className={`method-history-button ${expanded ? 'active' : ''}`} onClick={() => toggleMethodHistory(method.id)}><Text>{expanded ? '收起版本历史' : `查看版本历史（${method.version}）`}</Text></View>
                {expanded && <View className='method-history'><Text className='method-history-title'>演化轨迹与复盘证据</Text>{[...history].reverse().map((version) => { const sourceReview = version.sourceReviewId ? historyReviews[version.sourceReviewId] : undefined; return <View id={'method-' + method.id + '-version-' + version.version} className='method-version' key={version.id}><View className='method-version-heading'><Text>v{version.version}</Text><Text>{formatTime(version.createdAt)}</Text></View><Text className='method-label'>方法名称</Text><Text className='method-value'>{version.title}</Text><Text className='method-label'>适用情况</Text><Text className='method-value'>{version.applicable}</Text>{version.unsuitable && <><Text className='method-label'>不适用情况</Text><Text className='method-value'>{version.unsuitable}</Text></>}<Text className='method-label'>具体步骤</Text><Text className='method-value'>{version.steps}</Text><View className='method-version-evidence'><Text className='method-label'>来源复盘</Text>{sourceReview ? <><Text>实际行动：{sourceReview.actualAction}</Text><Text>结果：{sourceReview.result}</Text></> : <Text className='muted'>{version.sourceReviewId ? '来源复盘当前不可用' : '历史迁移快照，无来源复盘记录'}</Text>}</View></View> })}</View>}
              </View>
            })()}
          </View>
          </>}
        </View>
      </View>}
        </View>
      </View>
    </View>
  )
}

type AuthenticationMode = 'login' | 'register'
type SessionReadSource = 'initial' | 'after-auth-write' | 'confirm-unknown-logout' | 'manual'

function authenticationErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiClientError
  const requestId = apiError.requestId ? `（requestId：${apiError.requestId}）` : ''
  return `${error instanceof Error ? error.message : fallback}${requestId}`
}

export default function IndexPage() {
  const [authSession, setAuthSession] = useState<AuthSession>()
  const [sessionResolved, setSessionResolved] = useState(false)
  const [sessionReading, setSessionReading] = useState(true)
  const [authMode, setAuthMode] = useState<AuthenticationMode>('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authUnknownOutcome, setAuthUnknownOutcome] = useState(false)
  const [authNeedsSessionConfirmation, setAuthNeedsSessionConfirmation] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutUnknownOutcome, setLogoutUnknownOutcome] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const sessionReadRequestRef = useRef(0)
  const sessionReadAbortRef = useRef<AbortController>()
  const authOperationRef = useRef(0)

  const enterUnauthenticatedGate = (message = '', preserveDraft = false) => {
    authOperationRef.current += 1
    sessionReadRequestRef.current += 1
    sessionReadAbortRef.current?.abort()
    advanceApiClientAuthenticationContext()
    setAuthSession(undefined)
    setSessionResolved(true)
    setSessionReading(false)
    setAuthSubmitting(false)
    setAuthUnknownOutcome(false)
    setAuthNeedsSessionConfirmation(false)
    setLogoutBusy(false)
    setLogoutUnknownOutcome(false)
    setLogoutError('')
    if (!preserveDraft) setAuthPassword('')
    setAuthError(message)
  }

  const readCurrentSession = async (source: SessionReadSource): Promise<'authenticated' | 'unauthenticated' | 'failed'> => {
    sessionReadAbortRef.current?.abort()
    const controller = new AbortController()
    sessionReadAbortRef.current = controller
    const requestId = sessionReadRequestRef.current + 1
    sessionReadRequestRef.current = requestId
    setSessionReading(true)
    if (source !== 'confirm-unknown-logout') setAuthError('')
    if (source === 'confirm-unknown-logout') setLogoutError('')
    try {
      const session = await apiClient.getCurrentSession(controller.signal)
      if (controller.signal.aborted || requestId !== sessionReadRequestRef.current) return 'failed'
      advanceApiClientAuthenticationContext()
      setAuthSession(session)
      setSessionResolved(true)
      setAuthUnknownOutcome(false)
      setAuthNeedsSessionConfirmation(false)
      setLogoutUnknownOutcome(false)
      setAuthPassword('')
      return 'authenticated'
    } catch (error) {
      if (controller.signal.aborted || requestId !== sessionReadRequestRef.current) return 'failed'
      if ((error as ApiClientError).status === 401) {
        enterUnauthenticatedGate(source === 'initial' ? '' : '当前没有有效会话，请登录。', source === 'after-auth-write' || source === 'manual')
        return 'unauthenticated'
      }
      if (!isApiClientAbort(error)) {
        const message = authenticationErrorMessage(error, '无法读取当前会话。')
        if (source === 'confirm-unknown-logout') setLogoutError(message)
        else setAuthError(message)
      }
      return 'failed'
    } finally {
      if (!controller.signal.aborted && requestId === sessionReadRequestRef.current) setSessionReading(false)
    }
  }

  useEffect(() => {
    const clearHandler = setApiClientUnauthorizedHandler(() => enterUnauthenticatedGate('当前会话已过期，请重新登录。'))
    void readCurrentSession('initial')
    return () => {
      clearHandler()
      sessionReadAbortRef.current?.abort()
    }
  }, [])

  const switchAuthenticationMode = (mode: AuthenticationMode) => {
    if (authSubmitting || authUnknownOutcome || authNeedsSessionConfirmation) return
    authOperationRef.current += 1
    setAuthMode(mode)
    setAuthError('')
  }

  const submitAuthentication = async () => {
    if (authSubmitting || sessionReading || authUnknownOutcome || authNeedsSessionConfirmation || !authUsername.trim() || authPassword.length < 8) return
    const operationId = authOperationRef.current + 1
    authOperationRef.current = operationId
    setAuthSubmitting(true)
    setAuthError('')
    try {
      if (authMode === 'register') await apiClient.register({ username: authUsername, password: authPassword })
      else await apiClient.login({ username: authUsername, password: authPassword })
      if (operationId !== authOperationRef.current) return
      setAuthNeedsSessionConfirmation(true)
      await readCurrentSession('after-auth-write')
    } catch (error) {
      if (operationId !== authOperationRef.current) return
      if (isApiClientUnknownOutcome(error)) {
        setAuthUnknownOutcome(true)
        setAuthNeedsSessionConfirmation(true)
        setAuthError(error.message)
      } else {
        setAuthError(authenticationErrorMessage(error, authMode === 'register' ? '注册失败。' : '登录失败。'))
      }
    } finally {
      if (operationId === authOperationRef.current) setAuthSubmitting(false)
    }
  }

  const logout = async () => {
    if (!authSession || logoutBusy || logoutUnknownOutcome) return
    const operationId = authOperationRef.current + 1
    authOperationRef.current = operationId
    setLogoutBusy(true)
    setLogoutError('')
    try {
      await apiClient.logout()
      if (operationId !== authOperationRef.current) return
      setAuthUsername(authSession.user.username)
      enterUnauthenticatedGate('')
    } catch (error) {
      if (operationId !== authOperationRef.current) return
      if ((error as ApiClientError).status === 401) {
        setAuthUsername(authSession.user.username)
        enterUnauthenticatedGate('当前会话已失效，请重新登录。')
      } else if (isApiClientUnknownOutcome(error)) {
        setLogoutUnknownOutcome(true)
        setLogoutError(error.message)
      } else {
        setLogoutError(authenticationErrorMessage(error, '退出失败。'))
      }
    } finally {
      if (operationId === authOperationRef.current) setLogoutBusy(false)
    }
  }

  const confirmUnknownLogout = async () => {
    if (logoutBusy || !logoutUnknownOutcome) return
    setLogoutBusy(true)
    const result = await readCurrentSession('confirm-unknown-logout')
    if (result === 'authenticated') setLogoutError('当前会话仍有效，未退出。')
    setLogoutBusy(false)
  }

  if (authSession) return <AuthenticatedWorkspace
    key={`${authSession.user.id}-${authSession.user.createdAt}`}
    session={authSession}
    logoutBusy={logoutBusy}
    logoutUnknownOutcome={logoutUnknownOutcome}
    logoutError={logoutError}
    onLogout={() => void logout()}
    onConfirmLogoutOutcome={() => void confirmUnknownLogout()}
  />

  const authenticationLocked = authSubmitting || sessionReading || authUnknownOutcome || authNeedsSessionConfirmation
  const canSubmitAuthentication = Boolean(authUsername.trim()) && authPassword.length >= 8 && !authenticationLocked

  return <View className='auth-gate-shell'>
    <View className='auth-gate-brand'><Text>MaruMaru</Text><Text>圈圈 · 行动与方法</Text></View>
    <View className='auth-gate-card'>
      <Text className='auth-gate-kicker'>个人行动闭环</Text>
      <Text className='auth-gate-title'>{!sessionResolved ? '正在确认当前会话' : authMode === 'register' ? '创建账户' : '登录圈圈'}</Text>
      <Text className='auth-gate-description'>{!sessionResolved ? '确认完成前不会读取或展示业务数据。' : '登录后进入仅属于当前账户的工作台。'}</Text>

      {!sessionResolved ? <View className='auth-session-state'>
        {sessionReading ? <Text>正在读取当前会话…</Text> : <>
          <Text className='auth-gate-error'>{authError || '暂时无法确认当前会话。'}</Text>
          <Button className='auth-primary-button' disabled={sessionReading} onClick={() => void readCurrentSession('manual')}>重新读取当前会话</Button>
        </>}
      </View> : <>
        <View className='auth-mode-switch'>
          <Button className={authMode === 'login' ? 'active' : ''} disabled={authenticationLocked} onClick={() => switchAuthenticationMode('login')}>登录</Button>
          <Button className={authMode === 'register' ? 'active' : ''} disabled={authenticationLocked} onClick={() => switchAuthenticationMode('register')}>注册</Button>
        </View>
        <View className='auth-field'>
          <Text>用户名</Text>
          <Input value={authUsername} maxlength={80} disabled={authenticationLocked} placeholder='输入用户名' onInput={(event) => setAuthUsername(event.detail.value)} />
        </View>
        <View className='auth-field'>
          <Text>密码</Text>
          <Input value={authPassword} maxlength={256} disabled={authenticationLocked} password placeholder='至少 8 个字符' onInput={(event) => setAuthPassword(event.detail.value)} />
        </View>
        {authError && <Text className='auth-gate-error'>{authError}</Text>}
        {(authUnknownOutcome || authNeedsSessionConfirmation) ? <View className='auth-confirm-session'>
          <Text>未根据本地状态推断认证结果，也不会自动重发。</Text>
          <Button className='auth-primary-button' disabled={sessionReading} onClick={() => void readCurrentSession('manual')}>{sessionReading ? '正在读取…' : '重新读取当前会话'}</Button>
        </View> : <Button className='auth-primary-button' disabled={!canSubmitAuthentication} onClick={() => void submitAuthentication()}>{authSubmitting ? '正在提交…' : authMode === 'register' ? '注册并进入' : '登录'}</Button>}
      </>}
    </View>
  </View>
}
