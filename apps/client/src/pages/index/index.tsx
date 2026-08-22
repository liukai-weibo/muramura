import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Image, Input, Text, Textarea, View } from '@tarojs/components'
import type { AuthSession, BackupDocument, DashboardMetricKey, DashboardReport, DashboardWindow, ExplorationTrack, ExplorationTrackHistory, ExplorationTrackListEntry, Item, ItemExplorationTrackContext, ItemMethodSourceDisplay, ItemStatus, ItemStatusEvent, Method, MethodApplicationContextResult, MethodEvidenceDetail, MethodEvidenceRelation, MethodVersion, Review, SearchResult, TrashEntry, TrashFilter, TrashPurgeEntry } from '@knowledge-base/contracts'
import { advanceApiClientAuthenticationContext, apiClient, actionsFor, isApiClientAbort, isApiClientUnknownOutcome, restoreApiClientDesktopSession, setApiClientAdminForbiddenHandler, setApiClientUnauthorizedHandler, type ApiClientError, type ApiItemAction } from './api-client'
import { ExplorationPrototype } from './exploration-prototype'
import { PlatformAdministration } from './platform-administration'
import { hasAdministratorRole, hasPlatformAdminRole } from './platform-administration-state'
import { searchCollapseState, searchExitState, searchResultSelectionState, shouldOpenSearchResults } from './search-session-state'
import { canModifyItemExplorationContext } from './item-exploration-state'
import { mergeUpdatedItemContentIntoList } from './item-content-state'
import ExperimentalAiPage from './experimental-ai'
import { canOpenStartConfirm, shouldDisplayStartAction, shouldInterceptStartAction, startFeedbackVisible } from './start-confirm-state'
import { DesktopAuthTitleBar, DesktopTitleBar } from '../../desktop/desktop-title-bar'
import { exitDesktopApplication, installDesktopShortcuts, isTauriDesktop } from '../../desktop/desktop-native-bridge'
import { HomeDashboard } from './home-dashboard'
import { DailyNotesPage } from './features/daily-notes/daily-notes-page'
import { QuickNoteFab } from './features/quick-note/quick-note-fab'
import { readColorTheme, readDisplayEffectMode, readQuickNoteFabVisible, saveColorTheme, saveQuickNoteFabVisible, type ColorTheme, type DisplayEffectMode } from './display-effect-preference'
import './index.scss'
import './cream-ui-theme.scss'
import '../../assets/help'
const marumaruBrandIconUrl = new URL('../../assets/brand/marumaru-white-cat-transparent.png', import.meta.url).href
const dailyNoteCatIconUrl = new URL('../../assets/home/guides/cat-forward-stretch.png', import.meta.url).href
const workbenchCatIconUrl = new URL('../../assets/home/guides/cat-playful-stretch.png', import.meta.url).href
const aiCatIconUrl = new URL('../../assets/home/guides/cat-ball-roll.png', import.meta.url).href
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
  idea_to_try: '历史状态', idea_later: '历史状态', doing: '进行中', paused: '历史状态',
  waiting_review: '历史状态', reviewed: '已复盘', archived_no_review: '历史状态', abandoned: '历史状态',
}

function formatDashboardDetail(detail: string): string {
  return detail.replace(/\b(idea_to_try|idea_later|doing|paused|waiting_review|reviewed|archived_no_review|abandoned)\b/g, (status) => statusLabels[status as ItemStatus] ?? status)
}

const statusNavigation: Array<{ label: string; status: ItemStatus }> = [
  { label: '进行中', status: 'doing' },
  { label: '已复盘', status: 'reviewed' },
]
const moreStatusNavigation: Array<{ label: string; status: ItemStatus }> = [
  { label: '已放弃', status: 'abandoned' },
]

type MethodMode = 'none' | 'create' | 'validate'
type ContentModule = 'actions' | 'explorations' | 'methods' | 'insights' | 'ai' | 'settings' | 'administration' | 'aiConfiguration'
type PrimaryModule = 'home' | 'workbench' | 'dailyNotes' | 'ai' | 'me'
type WorkbenchTab = 'actions' | 'explorations' | 'methods'
type MyTab = 'profile' | 'insights' | 'storage' | 'administration' | 'aiConfiguration'
type GlobalTool = 'search' | 'capture'
type NavigationTarget =
  | { type: 'item'; itemId: string }
  | { type: 'review'; itemId: string }
  | { type: 'method'; methodId: string; methodVersion?: number }
  | { type: 'backlog'; status: ItemStatus }

const moduleLabels: Record<ContentModule, string> = {
  actions: '行动',
  explorations: '长期探索',
  methods: '方法',
  insights: '观察',
  ai: '圈圈助手 · AI 行动参谋',
  settings: '数据管理',
  administration: '用户管理',
  aiConfiguration: 'AI 参数配置',
}

const primaryModuleLabels: Record<PrimaryModule, string> = {
  dailyNotes: '手记',
  home: '首页',
  workbench: '灵感todo',
  ai: '圈圈 AI 助手',
  me: '我的',
}

const evidenceRelationLabels: Record<MethodEvidenceRelation, string> = {
  formation: '形成方法',
  validation: '验证方法',
  revision: '修订方法',
  unknown: '历史证据',
}

const ITEM_TITLE_MAX_GRAPHEMES = 20
const itemTitleSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const trashEntryTypeLabels: Record<TrashEntry['type'], string> = {
  item: '事项',
  method: '方法',
  'exploration-track': '长期探索',
}

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
  const maxHeight = 246
  const nextHeight = Math.min(input.scrollHeight, maxHeight)
  input.style.height = `${nextHeight}px`
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
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
  onPasswordChanged: (username: string) => void
  colorTheme: ColorTheme
  onToggleColorTheme: () => void
}

function AuthenticatedWorkspace({ session, logoutBusy, logoutUnknownOutcome, logoutError, onLogout, onConfirmLogoutOutcome, onPasswordChanged, colorTheme, onToggleColorTheme }: AuthenticatedWorkspaceProps) {
  const dailyNoteFlushRef = useRef<(() => Promise<boolean>)>()
  const application = apiClient
  const reviewApplication = apiClient
  const searchApplication = apiClient
  const methodApplication = apiClient
  const methodLifecycleApplication = apiClient
  const trashApplication = apiClient
  const backupApplication = apiClient
  const dashboardApplication = apiClient
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false)
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [searchResultsOpen, setSearchResultsOpen] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchTriggerRef = useRef<HTMLElement>()
  const searchControlRef = useRef<HTMLDivElement | null>(null)
  const setDesktopSearchInputRef = (node: HTMLInputElement | null) => {
    if (node && !node.closest('.desktop-title-bar-actions')) searchInputRef.current = node
  }
  const setDesktopSearchControlRef = (node: HTMLDivElement | null) => {
    if (node && !node.closest('.desktop-title-bar-actions')) searchControlRef.current = node
  }
  const [searchResults, setSearchResults] = useState<SearchResult[]>()
  const [activeModule, setActiveModule] = useState<ContentModule>('actions')
  const [primaryModule, setPrimaryModule] = useState<PrimaryModule>('home')
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('actions')
  const [myTab, setMyTab] = useState<MyTab>('profile')
  const [displayEffectMode, setDisplayEffectMode] = useState<DisplayEffectMode>(readDisplayEffectMode)
  const [quickNoteFabVisible, setQuickNoteFabVisible] = useState(readQuickNoteFabVisible)
  const [quickNoteOpenRequest, setQuickNoteOpenRequest] = useState(0)
  const [dailyNoteEmpty, setDailyNoteEmpty] = useState(false)
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const navigationInitializedRef = useRef(false)
  const [administrationMounted, setAdministrationMounted] = useState(false)
  const [managementAccessDenied, setManagementAccessDenied] = useState(false)
  const [managementAccessNotice, setManagementAccessNotice] = useState('')
  const isPlatformAdministrator = hasPlatformAdminRole(session.user.roles)
  const isAdministrator = hasAdministratorRole(session.user.roles)
  const [explorationMounted, setExplorationMounted] = useState(false)
  const [dailyNotesMounted, setDailyNotesMounted] = useState(false)
  const [aiMounted, setAiMounted] = useState(false)
  const [explorationFactsVersion, setExplorationFactsVersion] = useState(0)
  const [restoreFactsVersion, setRestoreFactsVersion] = useState(0)
  const restoreFactsConfirmationRef = useRef<{ resolve: () => void; reject: (error: Error) => void }>()
  const [activeExplorationTrackCount, setActiveExplorationTrackCount] = useState<number>()
  const [explorationDashboardEntries, setExplorationDashboardEntries] = useState<ExplorationTrackListEntry[]>([])
  const [dashboardExplorationOpen, setDashboardExplorationOpen] = useState(false)
  const openPrimaryModuleRef = useRef<(target: PrimaryModule) => void>()
  const refreshDailyNoteBadge = useCallback(async () => {
    try {
      const note = await apiClient.readTodayDailyNote()
      setDailyNoteEmpty(!note?.content.trim())
    } catch {
      // Keep the last trusted badge state when the read fails.
    }
  }, [])
  useEffect(() => { void refreshDailyNoteBadge() }, [refreshDailyNoteBadge])
  useEffect(() => {
    const onChanged = () => { void refreshDailyNoteBadge() }
    window.addEventListener('daily-note-content-changed', onChanged)
    return () => window.removeEventListener('daily-note-content-changed', onChanged)
  }, [refreshDailyNoteBadge])
  useEffect(() => {
    if (!isTauriDesktop()) return
    let active = true
    let unlistenQuick: (() => void) | undefined
    let unlistenDaily: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const [quick, daily] = await Promise.all([
        listen('desktop-quick-note-shortcut', () => { if (active) setQuickNoteOpenRequest(value => value + 1) }),
        listen('desktop-daily-note-shortcut', () => { if (active) openPrimaryModuleRef.current?.('dailyNotes') }),
      ])
      if (active) { unlistenQuick = quick; unlistenDaily = daily } else { quick(); daily() }
    })
    return () => { active = false; unlistenQuick?.(); unlistenDaily?.() }
  }, [])
  useEffect(() => {
    if (!isTauriDesktop()) return
    let active = true
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen('daily-note-exit-request', async () => {
        if (!active) return
        const saved = await Promise.race([
          dailyNoteFlushRef.current?.() ?? Promise.resolve(true),
          new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), 2000)),
        ])
        if (saved || window.confirm('最后的小记尚未保存。是否仍要退出？')) await exitDesktopApplication()
      })
      if (active) unlisten = stop
      else stop()
    })
    return () => { active = false; unlisten?.() }
  }, [])
  useEffect(() => {
    if (activeModule === 'explorations' || activeModule === 'settings') setExplorationMounted(true)
    if (activeModule === 'administration' || activeModule === 'aiConfiguration') setAdministrationMounted(true)
    if (primaryModule === 'dailyNotes') setDailyNotesMounted(true)
    if (primaryModule === 'ai') setAiMounted(true)
  }, [activeModule, primaryModule])
  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true)
    const handleOffline = () => setIsBrowserOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  useEffect(() => {
    if (!navigationInitializedRef.current) {
      navigationInitializedRef.current = true
      return
    }
    if (activeModule === 'actions' || activeModule === 'explorations' || activeModule === 'methods') {
      setPrimaryModule('workbench')
      setWorkbenchTab(activeModule)
    } else if (activeModule === 'insights' || activeModule === 'settings') {
      setPrimaryModule('me')
      setMyTab(activeModule === 'insights' ? 'insights' : 'storage')
    } else if (activeModule === 'administration' || activeModule === 'aiConfiguration') {
      setPrimaryModule('me')
      setMyTab(activeModule)
    } else if (activeModule === 'ai') setPrimaryModule('ai')
  }, [activeModule])
  useEffect(() => setApiClientAdminForbiddenHandler((error) => {
    setManagementAccessDenied(true)
    setManagementAccessNotice(`你的管理员权限已变化，无法继续访问用户管理。${error.requestId ? `（requestId：${error.requestId}）` : ''}`)
    setActiveModule('actions')
    setAdministrationMounted(false)
  }), [])
  const [activeGlobalTool, setActiveGlobalTool] = useState<GlobalTool>()
  const captureOriginModuleRef = useRef<ContentModule>('actions')
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
  const [trashLoading, setTrashLoading] = useState(false)
  const [pendingTrashRestore, setPendingTrashRestore] = useState<TrashEntry>()
  const [pendingTrashPurge, setPendingTrashPurge] = useState<TrashPurgeEntry[]>()
  const [trashExpanded, setTrashExpanded] = useState(false)
  const [selectedTrashKeys, setSelectedTrashKeys] = useState<Set<string>>(() => new Set())
  const [trashTrackDetailEntry, setTrashTrackDetailEntry] = useState<TrashEntry>()
  const [trashTrackDetail, setTrashTrackDetail] = useState<ExplorationTrackHistory>()
  const [trashTrackDetailLoading, setTrashTrackDetailLoading] = useState(false)
  const [trashTrackDetailError, setTrashTrackDetailError] = useState('')
  const trashTrackDetailRequestRef = useRef(0)
  const trashTrackDetailAbortRef = useRef<AbortController>()
  const [methodTrashConfirmId, setMethodTrashConfirmId] = useState<string>()
  const [methodMoreMenuId, setMethodMoreMenuId] = useState<string>()
  const [moreStatusMenuOpen, setMoreStatusMenuOpen] = useState(false)
  const moreStatusMenuRef = useRef<HTMLDivElement>()
  const methodMoreMenuRef = useRef<HTMLDivElement>()
  const methodMoreTriggerRef = useRef<HTMLButtonElement>(null)
  const [filter, setFilter] = useState<ItemStatus | undefined>('doing')
  const [showTrash, setShowTrash] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
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
  const [selectedReviewLoading, setSelectedReviewLoading] = useState(false)
  const [reviewNotePrompt, setReviewNotePrompt] = useState<{ title: string; content: string }>()
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
  const selectedTrashEntries = trashEntries.filter((entry) => selectedTrashKeys.has(`${entry.type}:${entry.id}`))
  const allTrashSelected = trashEntries.length > 0 && selectedTrashEntries.length === trashEntries.length
  const trashTrackDetailItems = useMemo(() => {
    if (!trashTrackDetail) return []
    const entries = [...trashTrackDetail.currentAssociatedItems.flatMap((group) => group.items), ...trashTrackDetail.history, ...trashTrackDetail.abandonedHistory]
    return [...new Map(entries.map((entry) => [entry.item.id, entry])).values()]
  }, [trashTrackDetail])
  const visibleMethodSourceItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
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
  const compactRhythmDate = formattedRhythmDate.replace(/^\d+年/, '').replace('星期', '周').replace('日周', '日 周')
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

  const refresh = async (nextSelectedId = selectedId, commit = true) => {
    refreshAbortRef.current?.abort()
    const controller = new AbortController()
    refreshAbortRef.current = controller
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    try {
      const [nextItems, nextTrashItems, nextMethods] = await Promise.all([
        application.listItems(controller.signal), application.listTrash(controller.signal), reviewApplication.listMethods(controller.signal),
      ])
      if (requestId !== refreshRequestRef.current) return { succeeded: false, items: [], trashItems: [], methods: [] }
      if (commit) {
        setItems(nextItems)
        setTrashItems(nextTrashItems)
        setMethods(nextMethods)
        const selectionPool = [...nextItems, ...nextTrashItems]
        if (nextSelectedId && selectionPool.some((item) => item.id === nextSelectedId)) setSelectedId(nextSelectedId)
        else if (selectedId && !selectionPool.some((item) => item.id === selectedId)) setSelectedId(undefined)
        setMessage(`${nextItems.length} 条有效事项 · ${nextMethods.length} 条当前方法 · 回收站 ${nextTrashItems.length} 条`)
      }
      return { succeeded: true, items: nextItems, trashItems: nextTrashItems, methods: nextMethods }
    } catch (error) {
      if (isApiClientAbort(error) || requestId !== refreshRequestRef.current) return { succeeded: false, items: [], trashItems: [], methods: [] }
      throw error
    }
  }

  useEffect(() => setSelectedTrashKeys(new Set()), [trashFilter])

  useEffect(() => {
    refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '本地数据服务初始化失败'))
    return () => {
      refreshAbortRef.current?.abort()
      trashTrackDetailAbortRef.current?.abort()
    }
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
      const target = event.target as HTMLElement | null
      if (target?.closest('.global-search-control')) return
      collapseSearch()
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
    const refreshItems = () => { void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '无法刷新事项列表。')) }
    window.addEventListener('knowledge-base-items-changed', refreshItems)
    return () => window.removeEventListener('knowledge-base-items-changed', refreshItems)
  }, [])
  useEffect(() => {
    if (primaryModule !== 'home' && (primaryModule !== 'me' || myTab !== 'insights')) return
    const controller = new AbortController()
    dashboardApplication.getReport(dashboardWindow, controller.signal).then(setDashboardReport).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取仪表盘失败')
    })
    return () => controller.abort()
  }, [primaryModule, myTab, dashboardWindow, dashboardApplication, items, methods])

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
    if (activeModule !== 'settings') return
    const controller = new AbortController()
    setTrashLoading(true)
    trashApplication.listTrashEntries(trashFilter, controller.signal).then((entries) => {
      setTrashEntries(entries)
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error)) setMessage(error instanceof Error ? error.message : '读取回收站失败')
    }).finally(() => {
      if (!controller.signal.aborted) setTrashLoading(false)
    })
    return () => controller.abort()
  }, [activeModule, trashApplication, trashFilter])

  const openTrashTrackDetail = (entry: TrashEntry) => {
    if (entry.type !== 'exploration-track') return
    trashTrackDetailAbortRef.current?.abort()
    setTrashTrackDetailEntry(entry)
    setTrashTrackDetail(undefined)
    setTrashTrackDetailError('')
    setTrashTrackDetailLoading(true)
    const controller = new AbortController()
    trashTrackDetailAbortRef.current = controller
    const requestId = ++trashTrackDetailRequestRef.current
    apiClient.getExplorationTrackHistory(entry.id, controller.signal).then((history) => {
      if (requestId === trashTrackDetailRequestRef.current) setTrashTrackDetail(history)
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error) && requestId === trashTrackDetailRequestRef.current) setTrashTrackDetailError(error instanceof Error ? error.message : '读取长期探索详情失败')
    }).finally(() => {
      if (requestId === trashTrackDetailRequestRef.current) setTrashTrackDetailLoading(false)
    })
  }

  const closeTrashTrackDetail = () => {
    trashTrackDetailAbortRef.current?.abort()
    trashTrackDetailRequestRef.current += 1
    setTrashTrackDetailEntry(undefined)
    setTrashTrackDetail(undefined)
    setTrashTrackDetailError('')
    setTrashTrackDetailLoading(false)
  }

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
    if (!selectedId) { setSelectedReview(undefined); setSelectedReviewLoading(false); return }
    const controller = new AbortController()
    setSelectedReview(undefined)
    setSelectedReviewLoading(true)
    reviewApplication.getReviewForItem(selectedId, controller.signal).then((review) => {
      if (!controller.signal.aborted) setSelectedReview(review)
    }).catch((error: unknown) => {
      if (!isApiClientAbort(error) && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '读取复盘失败')
    }).finally(() => {
      if (!controller.signal.aborted) setSelectedReviewLoading(false)
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
      if (!isApiClientAbort(error) && !controller.signal.aborted) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入长期探索关联。')
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
      if (!isApiClientAbort(error) && !controller.signal.aborted && selectedIdRef.current === itemId) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入长期探索关联。')
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
      setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入可选长期探索。')
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
      else setItemExplorationError(error instanceof Error ? error.message : '调整长期探索未完成，请重试。')
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
      else setItemExplorationError(error instanceof Error ? error.message : '移除长期探索未完成，请重试。')
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
    setPrimaryModule('workbench')
    setWorkbenchTab('actions')
    setActiveModule('actions')
    setShowTrash(false)
    setDeleteConfirm(false)
    if (!item) {
      setSelectedId(undefined)
      setPendingReviewLocation(false)
      setMessage('目标记录不存在或已删除')
      return false
    }
    setFilter(item.status)
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
    if (result.deletedAt && result.type === 'item' && result.itemId) {
      requestLeaveAllDrafts(() => {
        setActiveModule('actions')
        setShowTrash(true)
        setSelectedId(result.itemId)
      })
      return
    }
    if (result.type === 'review' && result.itemId) {
      navigateTo({ type: 'review', itemId: result.itemId })
      return
    }
    if (result.type === 'item' && result.itemId) {
      navigateTo({ type: 'item', itemId: result.itemId })
      return
    }
    if (result.type === 'daily-note') {
      openPrimaryModule('dailyNotes')
      return
    }
    if (result.type === 'exploration-track') {
      openWorkbenchTab('explorations')
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
    setMessage('')
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
      await refresh(changedItemId)
      if (shouldRelocateAfterRefresh) {
        setMoreStatusMenuOpen(false)
        setFilter(action.status)
        setSelectedId(changedItemId)
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
      await reloadCurrentItemExplorationContext()
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
      await refresh()
      await reloadCurrentItemExplorationContext()
      setExplorationFactsVersion((version) => version + 1)
      setMessage(`“${entry.title}”已恢复`)
      setPendingTrashRestore(undefined)
      closeTrashTrackDetail()
    }))
  }

  const purgeTrashEntries = (entries: readonly TrashPurgeEntry[]) => {
    requestLeaveAllDrafts(() => run(async () => {
      await trashApplication.purgeTrashEntries([...entries])
      const refreshed = await trashApplication.listTrashEntries(trashFilter)
      setTrashEntries(refreshed)
      setSelectedTrashKeys(new Set())
      setPendingTrashPurge(undefined)
      await refresh()
      if (entries.some((entry) => entry.type === 'exploration-track')) setExplorationFactsVersion((version) => version + 1)
      if (trashTrackDetailEntry && entries.some((entry) => entry.type === 'exploration-track' && entry.id === trashTrackDetailEntry.id)) closeTrashTrackDetail()
      setMessage(`已永久删除 ${entries.length} 条回收站记录`)
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
    setSelectedId(undefined)
    setDeleteConfirm(false)
  }

  const openTrash = () => {
    setShowTrash(true)
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
    let restoreFactsConfirmed = false
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
      const restoredFacts = await refresh(undefined, false)
      if (!restoredFacts.succeeded) throw new Error('恢复后的事项、方法或回收站读取未确认，请保留当前事实并重新读取。')
      const restoredTrashEntries = await trashApplication.listTrashEntries('all')
      setExplorationMounted(true)
      await new Promise<void>((resolve, reject) => {
        restoreFactsConfirmationRef.current = { resolve, reject }
        setRestoreFactsVersion((version) => version + 1)
      })
      restoreFactsConfirmationRef.current = undefined
      setItems(restoredFacts.items)
      setTrashItems(restoredFacts.trashItems)
      setMethods(restoredFacts.methods)
      setTrashEntries(restoredTrashEntries)
      setPendingBackup(undefined)
      setSelectedId(undefined)
    setFilter('doing')
      setShowTrash(false)
      restoreFactsConfirmed = true
      setBackupMessage('恢复完成；覆盖前的数据已自动下载为安全备份')
    } catch (error: unknown) {
      restoreFactsConfirmationRef.current = undefined
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
      setRestoring(!restoreFactsConfirmed)
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
      setReviewNotePrompt({ title: selectedItem.title, content: submittedReviewForm.result })
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

  const openPrimaryModule = (target: PrimaryModule) => {
    if (primaryModule === 'dailyNotes' && target !== 'dailyNotes') void dailyNoteFlushRef.current?.()
    requestLeaveAllDrafts(() => {
      setPrimaryModule(target)
      if (target === 'workbench') setActiveModule(workbenchTab)
      else if (target === 'ai') setActiveModule('ai')
      else if (target === 'me' && (myTab === 'insights' || myTab === 'storage')) setActiveModule(myTab === 'insights' ? 'insights' : 'settings')
      else if (target === 'me' && (myTab === 'administration' || myTab === 'aiConfiguration')) setActiveModule(myTab)
    })
  }
  openPrimaryModuleRef.current = openPrimaryModule

  const openWorkbenchTab = (tab: WorkbenchTab) => {
    requestLeaveAllDrafts(() => {
      setWorkbenchTab(tab)
      setPrimaryModule('workbench')
      setActiveModule(tab)
    })
  }

  const openMyTab = (tab: MyTab) => {
    requestLeaveAllDrafts(() => {
      setMyTab(tab)
      setPrimaryModule('me')
      if (tab === 'insights') setActiveModule('insights')
      else if (tab === 'storage') setActiveModule('settings')
      else if (tab === 'administration' || tab === 'aiConfiguration') setActiveModule(tab)
    })
  }

  const closePasswordChange = () => {
    if (passwordChangeBusy) return
    setPasswordChangeOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setNewPasswordConfirmation('')
    setPasswordChangeError('')
  }

  const submitPasswordChange = async () => {
    if (passwordChangeBusy) return
    if (!currentPassword || !newPassword || !newPasswordConfirmation) {
      setPasswordChangeError('请填写当前密码、新密码和确认密码。')
      return
    }
    if (newPassword.length < 8) {
      setPasswordChangeError('新密码至少需要 8 个字符。')
      return
    }
    if (newPassword !== newPasswordConfirmation) {
      setPasswordChangeError('两次输入的新密码不一致。')
      return
    }
    setPasswordChangeBusy(true)
    setPasswordChangeError('')
    try {
      await apiClient.changeOwnPassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirmation('')
      onPasswordChanged(session.user.username)
    } catch (error) {
      const apiError = error as ApiClientError
      setPasswordChangeError(apiError.businessCode === 'AUTH_CURRENT_PASSWORD_INVALID'
        ? '当前密码不正确。'
        : authenticationErrorMessage(error, '密码修改失败。'))
    } finally {
      setPasswordChangeBusy(false)
    }
  }

  useEffect(() => installDesktopShortcuts({
    onNew: () => { if (!busy && !restoring && !captureLocked) openCapture() },
    onSearch: () => openSearch(),
    onEscape: () => {
      if (activeGlobalTool === 'capture') closeCapture()
      else if (searchExpanded) exitSearch()
    },
  }), [activeGlobalTool, busy, captureLocked, closeCapture, exitSearch, openCapture, openSearch, restoring, searchExpanded])

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

  const desktopSearchControl = <View className='global-search-control interactive' ref={setDesktopSearchControlRef} onClick={(event) => event.stopPropagation()}>
    {searchExpanded ? <View className='global-tool-button global-search-expanded'>
      <input ref={setDesktopSearchInputRef} className='global-search-input' value={searchQuery} maxLength={120} placeholder='搜索事项、复盘或方法' onMouseDown={(event) => event.stopPropagation()} onChange={(event) => updateSearchQuery(event.currentTarget.value)} onFocus={() => { if (searchQuery.trim()) setSearchResultsOpen(true) }} />
      <button type='button' className='global-search-exit' aria-label='退出全局搜索' onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); exitSearch() }}>×</button>
    </View> : <View className={`global-tool-button ${searchQuery.trim() ? 'has-draft' : ''}`} onClick={openSearch}><Text className='global-search-icon'>⌕</Text><Text>搜索事项...</Text><Text className='global-search-shortcut'>Ctrl F</Text></View>}
    {searchExpanded && searchResultsOpen && searchQuery.trim() && <View className='search-results-popover' role='dialog' aria-label='搜索结果'>
      {searchResults === undefined ? <Text className='search-empty'>正在搜索…</Text> : searchError ? <Text className='search-empty'>{searchError}</Text> : searchResults.length === 0 ? <Text className='search-empty'>没有找到相关记录。</Text> : (['item', 'review', 'method', 'daily-note', 'exploration-track'] as const).map((type) => {
        const grouped = searchResults.filter((result) => result.type === type)
        if (!grouped.length) return null
        return <View className='search-group' key={type}>
          <Text className='search-group-title'>{type === 'item' ? '事项' : type === 'review' ? '复盘' : type === 'method' ? '方法' : type === 'daily-note' ? '手记' : '长期探索'} · {grouped.length}</Text>
          {grouped.map((result) => <View className='search-result' key={result.id} onClick={() => locateSearchResult(result)}>
            <View><Text className='search-result-title'>{result.title}{result.deletedAt ? ' · 已删除' : ''}</Text><Text className='search-result-excerpt'>{result.type === 'item' && result.itemStatus ? `状态：${statusLabels[result.itemStatus]}` : result.excerpt}</Text></View>
            <Text className='search-result-action'>{result.methodVersion ? `定位 v${result.methodVersion}` : '定位'}</Text>
          </View>)}
        </View>
      })}
    </View>}
  </View>
  const desktopBreadcrumb = primaryModuleLabels[primaryModule]

  return (
    <View className='app-shell' data-color-theme={colorTheme} data-display-effect={displayEffectMode}>
      <View className='primary-navigation'>
        <View className='navigation-brand'>
          <View className='navigation-brand-heading'>
            <Image className='navigation-brand-image' src={marumaruBrandIconUrl} mode='aspectFit' />
            <Text className='navigation-brand-name'>MaruMaru</Text>
          </View>
          <Text className='navigation-brand-subtitle'>圈圈 · 行动与方法</Text>
        </View>
        <View className='navigation-group navigation-group-workspace'>
          <Text className='navigation-group-title'>工作区</Text>
          {([['home', '首页']] as Array<[PrimaryModule, string]>).map(([module, label]) => <View
            key={module}
            className={`navigation-item navigation-transition navigation-item-${module} ${primaryModule === module ? 'active' : ''} ${restoring ? 'disabled' : ''}`}
            onClick={() => { if (!restoring) openPrimaryModule(module) }}
          >{module === 'home' && <Text className='navigation-home-icon' aria-hidden='true'>🏠</Text>}{module === 'workbench' && <Image className='navigation-module-icon' src={workbenchCatIconUrl} mode='aspectFit' />}{module === 'ai' && <Image className='navigation-module-icon' src={aiCatIconUrl} mode='aspectFit' />}<Text>{label}</Text></View>)}
          <View className={`navigation-item navigation-transition navigation-item-workbench ${primaryModule === 'workbench' ? 'active' : ''} ${restoring ? 'disabled' : ''}`} onClick={() => { if (!restoring) openPrimaryModule('workbench') }}><Image className='navigation-module-icon' src={workbenchCatIconUrl} mode='aspectFit' /><Text>灵感todo</Text></View>
          <View className={`navigation-item navigation-transition navigation-item-dailyNotes ${primaryModule === 'dailyNotes' ? 'active' : ''} ${restoring ? 'disabled' : ''}`} onClick={() => { if (!restoring) openPrimaryModule('dailyNotes') }}><Image className='navigation-daily-note-icon' src={dailyNoteCatIconUrl} mode='aspectFit' /><Text>手记</Text>{dailyNoteEmpty && <Text className='navigation-daily-note-badge' aria-label='今日尚未记录' />}</View>
          <View className={`navigation-item navigation-transition navigation-item-ai ${primaryModule === 'ai' ? 'active' : ''} ${restoring ? 'disabled' : ''}`} onClick={() => { if (!restoring) openPrimaryModule('ai') }}><Image className='navigation-module-icon' src={aiCatIconUrl} mode='aspectFit' /><Text>圈圈 AI 助手</Text></View>
        </View>
        <View className='navigation-group navigation-group-account'>
          <Text className='navigation-group-title'>账户</Text>
          <View className={`navigation-item navigation-transition navigation-item-me ${primaryModule === 'me' ? 'active' : ''} ${restoring ? 'disabled' : ''}`} onClick={() => { if (!restoring) openPrimaryModule('me') }}><Text>我的</Text></View>
        </View>
        <View className='navigation-account'>
          <View><Text className='navigation-account-label'>当前账户</Text><Text className='navigation-account-name'>{session.user.username}</Text></View>
            <View role='switch' aria-checked={quickNoteFabVisible} className={`navigation-quick-note-toggle ${quickNoteFabVisible ? 'is-on' : ''}`} onClick={() => { const visible = !quickNoteFabVisible; setQuickNoteFabVisible(visible); saveQuickNoteFabVisible(visible) }}>
            <Text>速记悬浮球</Text><Text className='navigation-quick-note-switch' aria-hidden='true' />
          </View>
          <Button className='navigation-logout control-transition' disabled={logoutBusy || logoutUnknownOutcome} onClick={onLogout}>{logoutBusy ? '正在退出…' : '退出'}</Button>
          {logoutError && <Text className='navigation-account-error'>{logoutError}</Text>}
          {logoutUnknownOutcome && <Button className='navigation-session-confirm control-transition' disabled={logoutBusy} onClick={onConfirmLogoutOutcome}>重新读取当前会话</Button>}
        </View>
      </View>

      <View className='app-main'>
        <DesktopTitleBar
          breadcrumb={desktopBreadcrumb}
          onSearch={openSearch}
          onCapture={openCapture}
          colorTheme={colorTheme}
          onToggleColorTheme={onToggleColorTheme}
          searchContent={desktopSearchControl}
          workbenchTabs={primaryModule === 'workbench' ? ([['actions', '行动'], ['explorations', '长期探索'], ['methods', '方法']] as Array<[WorkbenchTab, string]>).map(([id, label]) => ({ id, label, active: workbenchTab === id, onClick: () => openWorkbenchTab(id) })) : undefined}
        />
        <View className={`global-header ${primaryModule === 'workbench' && workbenchTab === 'actions' ? 'global-header-actions' : ''}`}>
          <View><Text className='global-module-title'>{primaryModuleLabels[primaryModule]}</Text>{(managementAccessNotice && primaryModule === 'workbench' || restoring && primaryModule === 'workbench') && <Text className='global-message'>{managementAccessNotice || '正在安全恢复数据，请勿离开'}</Text>}</View>
          {!isBrowserOnline && <Text className='global-connectivity-status offline'>网络已断开</Text>}
          {!isTauriDesktop() && primaryModule !== 'ai' && <View className='global-actions'>
            <View className={`global-tool-button ${busy || restoring ? 'disabled' : ''}`} onClick={() => { if (!busy && !restoring) void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '刷新数据失败')) }}><Text>刷新数据</Text></View>
            <View className='global-search-control' ref={!isTauriDesktop() ? searchControlRef : undefined}>
              {searchExpanded ? <View className='global-search-expanded'>
                <input ref={!isTauriDesktop() ? searchInputRef : undefined} className='global-search-input' value={searchQuery} maxLength={120} placeholder='搜索事项、复盘或方法' onChange={(event) => updateSearchQuery(event.currentTarget.value)} onFocus={() => { if (searchQuery.trim()) setSearchResultsOpen(true) }} />
                <button type='button' className='global-search-exit' aria-label='退出全局搜索' onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); exitSearch() }}>×</button>
              </View> : <View className={`global-tool-button ${searchQuery.trim() ? 'has-draft' : ''}`} onClick={openSearch}><Text>全局搜索</Text></View>}
              {searchExpanded && searchResultsOpen && searchQuery.trim() && <View className='search-results-popover' role='dialog' aria-label='搜索结果'>
                {searchResults === undefined ? <Text className='search-empty'>正在搜索…</Text> : searchError ? <Text className='search-empty'>{searchError}</Text> : searchResults.length === 0 ? <Text className='search-empty'>没有找到相关记录。</Text> : (['item', 'review', 'method', 'daily-note', 'exploration-track'] as const).map((type) => {
                  const grouped = searchResults.filter((result) => result.type === type)
                  if (!grouped.length) return null
                  return <View className='search-group' key={type}>
                    <Text className='search-group-title'>{type === 'item' ? '事项' : type === 'review' ? '复盘' : type === 'method' ? '方法' : type === 'daily-note' ? '手记' : '长期探索'} · {grouped.length}</Text>
                    {grouped.map((result) => <View className='search-result' key={result.id} onClick={() => locateSearchResult(result)}>
                      <View><Text className='search-result-title'>{result.title}{result.deletedAt ? ' · 已删除' : ''}</Text><Text className='search-result-excerpt'>{result.type === 'item' && result.itemStatus ? `状态：${statusLabels[result.itemStatus]}` : result.excerpt}</Text></View>
                      <Text className='search-result-action'>{result.methodVersion ? `定位 v${result.methodVersion}` : '定位'}</Text>
                    </View>)}
                  </View>
                })}
              </View>}
            </View>
            <View className={`global-tool-button primary control-transition ${captureLocked ? 'disabled' : ''}`} onClick={openCapture}><Text>＋ 快速捕获</Text></View>
          </View>}
          {!isTauriDesktop() && <button type='button' className='global-theme-toggle control-transition' title={colorTheme === 'light' ? '切换为深色主题' : '切换为浅色主题'} aria-label={colorTheme === 'light' ? '切换为深色主题' : '切换为浅色主题'} onClick={onToggleColorTheme}>{colorTheme === 'light' ? '☾' : '☀'}</button>}
        </View>

        {primaryModule === 'workbench' && !isTauriDesktop() && <View className='fast-ui-tabs workbench-tabs' role='tablist'>
          {([['actions', '行动'], ['explorations', '长期探索'], ['methods', '方法']] as Array<[WorkbenchTab, string]>).map(([tab, label]) => <View key={tab} className={`fast-ui-tab ${workbenchTab === tab ? 'active' : ''}`} role='tab' aria-selected={workbenchTab === tab} onClick={() => openWorkbenchTab(tab)}><Text>{label}</Text></View>)}
        </View>}
        {primaryModule === 'me' && <View className='fast-ui-tabs' role='tablist'>
          {([['profile', '账户'], ['insights', '观察'], ['storage', '数据工具'], ...(isAdministrator && !managementAccessDenied ? [['administration', '管理区域'] as [MyTab, string]] : []), ...(isPlatformAdministrator && !managementAccessDenied ? [['aiConfiguration', 'AI 参数'] as [MyTab, string]] : [])] as Array<[MyTab, string]>).map(([tab, label]) => <View key={tab} className={`fast-ui-tab ${myTab === tab ? 'active' : ''}`} role='tab' aria-selected={myTab === tab} onClick={() => openMyTab(tab)}><Text>{label}</Text></View>)}
        </View>}

        <View className={`page ${primaryModule === 'dailyNotes' ? 'daily-notes-page-shell' : ''}`}>

        {primaryModule === 'home' && <HomeDashboard
          items={items}
          backlog={dashboardReport?.backlog}
          onOpenItem={(itemId) => navigateTo({ type: 'item', itemId })}
          onOpenBacklog={(status) => navigateTo({ type: 'backlog', status })}
          onOpenCapture={openCapture}
          onOpenDailyNotes={() => openPrimaryModule('dailyNotes')}
          displayEffectMode={displayEffectMode}
        />}
        {dailyNotesMounted && <View className={`module-retained ${primaryModule === 'dailyNotes' ? '' : 'module-retained-hidden'}`}><DailyNotesPage onFlushReady={(flush) => { dailyNoteFlushRef.current = flush }} onItemsChanged={async () => { await refresh() }} onItemCreated={(item) => { setItems(current => current.some(entry => entry.id === item.id) ? current : [item, ...current]) }} /></View>}

        {reviewNotePrompt && <View className='review-note-prompt' role='dialog' aria-modal='true' aria-label='写入手记'>
          <View className='review-note-prompt-card'><Text>是否将本条行动写入手记？</Text><Text>将追加事项标题和本次复盘内容，不会改写已有记录。</Text><View><Button className='action-button secondary' onClick={() => setReviewNotePrompt(undefined)}>暂不写入</Button><Button className='action-button primary' onClick={() => void apiClient.appendTodayDailyNote(`事项：${reviewNotePrompt.title}\n\n${reviewNotePrompt.content}`).then(() => { window.dispatchEvent(new CustomEvent('daily-note-content-changed')); setReviewNotePrompt(undefined); setMessage('已写入手记') }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '写入手记失败'))}>写入手记</Button></View></View>
        </View>}

      {activeGlobalTool === 'capture' && <View className='capture-modal-backdrop'>
        <View className='capture-modal quick-capture-modal' role='dialog' aria-label='快速捕获'>
          <View className='capture-modal-heading'><View><Text className='section-kicker'>快速捕获</Text><Text>记录一个现在不想丢失的行动念头</Text></View><View className='capture-modal-close' onClick={closeCapture}><Text>关闭</Text></View></View>
          <View className='item-title-input-wrap'><Input ref={captureInputRef} className='capture-modal-input' value={title} placeholder='一句话记录你想做什么' onInput={(event) => { const next = event.detail.value; if (acceptsItemTitleInput(next)) { setTitle(next); setCaptureTitleLimitReached(false) } else setCaptureTitleLimitReached(true) }} /><Text className='item-title-counter'>{captureTitleGraphemes}/{ITEM_TITLE_MAX_GRAPHEMES}</Text></View>
          {captureTitleLimitReached && <Text className='item-title-limit-notice'>标题最多20个字符</Text>}
          <View className='capture-actions'>
            <View className={`primary-button ${busy || captureLocked || captureUnknownOutcome || !hasCaptureContent ? 'disabled' : ''}`} onClick={() => { if (!busy && !captureLocked && !captureUnknownOutcome && hasCaptureContent) createIdea(false) }}><Text>{busy ? '正在创建…' : '开始记录'}</Text></View>
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

      {(primaryModule === 'workbench' && workbenchTab === 'explorations' || explorationMounted) && <View className={`exploration-module ${primaryModule === 'workbench' && workbenchTab === 'explorations' ? '' : 'exploration-module-retained-hidden'}`}><ExplorationPrototype
        explorationFactsVersion={explorationFactsVersion}
        restoreFactsVersion={restoreFactsVersion}
        onRestoreFactsConfirmed={() => restoreFactsConfirmationRef.current?.resolve()}
         onRestoreFactsFailed={(error) => restoreFactsConfirmationRef.current?.reject(new Error(error))}
         onExplorationTrackCountChange={setActiveExplorationTrackCount}
         onExplorationTracksChange={setExplorationDashboardEntries}
        onRefresh={() => refresh().then(() => undefined)}
        showManualRefresh={!isTauriDesktop()}
        itemUpdatedAtById={itemUpdatedAtById}
        onItemsChanged={() => refresh().then(() => reloadCurrentItemExplorationContext()).then(() => undefined)}
        onOpenItem={(locator) => {
          setActiveModule('actions')
          setFilter(locator.status)
          void refresh(locator.itemId).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '无法重新读取事项'))
        }}
      /></View>}

      {isAdministrator && !managementAccessDenied && (primaryModule === 'me' && (myTab === 'administration' || myTab === 'aiConfiguration') || administrationMounted) && <PlatformAdministration
        authenticationContext={`${session.user.id}-${session.user.createdAt}`}
        currentUserId={session.user.id}
        canManageRoles={isPlatformAdministrator}
        view={myTab === 'aiConfiguration' ? 'ai' : 'users'}
        visible={primaryModule === 'me' && (myTab === 'administration' || myTab === 'aiConfiguration')}
      />}

      {aiMounted && <View className={`module-retained ${primaryModule === 'ai' ? '' : 'module-retained-hidden'}`}><ExperimentalAiPage /></View>}

      {primaryModule === 'me' && myTab === 'profile' && <View className='fast-ui-profile module-panel'>
        <Text className='section-kicker'>账户中心</Text><Text className='fast-ui-profile-title'>{session.user.username}</Text>
        <Text className='module-description'>查看账户信息、当前登录状态，并在需要时退出登录。</Text>
        <View className='fast-ui-profile-card'><Text>当前角色</Text><Text>{isPlatformAdministrator ? '平台管理员' : isAdministrator ? '普通管理员' : '普通成员'}</Text></View>
        <View className='fast-ui-profile-card'><Text>当前会话</Text><Text>当前浏览器会话已登录。</Text></View>
        <Button className='action-button secondary' onClick={() => setPasswordChangeOpen(true)}>修改密码</Button>
        {passwordChangeOpen && <View className='account-password-dialog-backdrop' role='dialog' aria-modal='true' aria-label='修改密码'>
          <View className='account-password-dialog'>
          <Text className='account-password-form-title'>修改密码</Text>
          <Input password value={currentPassword} maxlength={256} placeholder='当前密码' disabled={passwordChangeBusy} onInput={(event) => setCurrentPassword(event.detail.value)} />
          <Input password value={newPassword} maxlength={256} placeholder='新密码，至少 8 个字符' disabled={passwordChangeBusy} onInput={(event) => setNewPassword(event.detail.value)} />
          <Input password value={newPasswordConfirmation} maxlength={256} placeholder='确认新密码' disabled={passwordChangeBusy} onInput={(event) => setNewPasswordConfirmation(event.detail.value)} onConfirm={() => void submitPasswordChange()} />
          {passwordChangeError && <Text className='account-password-form-error'>{passwordChangeError}</Text>}
          <View className='account-password-form-actions'><Button className='action-button secondary' disabled={passwordChangeBusy} onClick={closePasswordChange}>取消</Button><Button className='action-button primary' disabled={passwordChangeBusy} onClick={() => void submitPasswordChange()}>{passwordChangeBusy ? '正在修改…' : '确认修改'}</Button></View>
          </View>
        </View>}
        <Button className='action-button secondary' disabled={logoutBusy || logoutUnknownOutcome} onClick={onLogout}>{logoutBusy ? '正在退出…' : '退出登录'}</Button>
      </View>}

      {primaryModule === 'me' && myTab === 'insights' && <View className='dashboard-panel module-panel'>
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
              ] as Array<[DashboardMetricKey, string, number]>).map(([key, label, value]) => <View className={`metric-card ${dashboardMetric === key ? 'active' : ''}`} key={key} onClick={() => { setDashboardExplorationOpen(false); setDashboardMetric((current) => current === key ? undefined : key) }}>
                <Text>{value}</Text><Text>{label}</Text>
              </View>)}
              <View className={`metric-card ${dashboardExplorationOpen ? 'active' : ''}`} onClick={() => { setDashboardMetric(undefined); setDashboardExplorationOpen((current) => !current) }}>
                <Text>{activeExplorationTrackCount ?? '—'}</Text><Text>长期探索</Text>
              </View>
            </View>
            {dashboardMetric && <View className='dashboard-drilldown'>
              <View className='dashboard-drilldown-heading'><Text>对应记录 · {dashboardReport.metricRecords[dashboardMetric].length}</Text><Text onClick={() => setDashboardMetric(undefined)}>收起</Text></View>
              {dashboardReport.metricRecords[dashboardMetric].length === 0
                ? <Text className='dashboard-empty'>该窗口内没有对应记录。</Text>
                : dashboardReport.metricRecords[dashboardMetric].map((record) => <View className='dashboard-drilldown-row' key={record.id} onClick={() => locateDashboardRecord(dashboardMetric, record)}>
                  <View><Text>{record.title}</Text><Text>{formatDashboardDetail(record.detail)}</Text></View><Text>{record.itemId || record.methodId ? '定位' : '仅记录'}</Text>
                </View>)}
            </View>}
            {dashboardExplorationOpen && <View className='dashboard-drilldown'>
              <View className='dashboard-drilldown-heading'><Text>长期探索 · {explorationDashboardEntries.length}</Text><Text onClick={() => setDashboardExplorationOpen(false)}>收起</Text></View>
              {explorationDashboardEntries.length === 0
                ? <Text className='dashboard-empty'>当前没有长期探索记录。</Text>
                : explorationDashboardEntries.slice(0, 5).map((entry) => <View className='dashboard-drilldown-row' key={entry.track.id}>
                  <View><Text>{entry.track.name}</Text><Text>{entry.latestAssociatedItem ? `最近关联事项：${entry.latestAssociatedItem.title}` : `最近修改：${formatTime(entry.track.updatedAt)}`}</Text></View><Text>仅记录</Text>
                </View>)}
            </View>}
          </View>

          <View className='dashboard-columns dashboard-columns-single'>
            <View className='dashboard-section'>
              <Text className='dashboard-section-title'>当前堵塞</Text>
              {([
                ['想试试', dashboardReport.backlog.ideaToTry, 'idea_to_try'],
                ['进行中', dashboardReport.backlog.doing, 'doing'],
              ] as Array<[string, number, ItemStatus]>).map(([label, value, status]) => <View className='backlog-row' key={status} onClick={() => navigateTo({ type: 'backlog', status })}><Text>{label}</Text><Text>{value}</Text></View>)}
            </View>

          </View>

          <View className='dashboard-section dashboard-facts'>
            <Text className='dashboard-section-title'>事实提示</Text>
            {dashboardReport.facts.map((fact) => <Text key={fact}>· {fact}</Text>)}
          </View>
        </>}
      </View>}

      {primaryModule === 'workbench' && workbenchTab === 'actions' && <>
        <View className='action-rhythm-bar'>
          <View><Text className='action-rhythm-date'>{formattedRhythmDate}</Text><Text className='action-rhythm-note'>这一周，推进一件真实的事</Text></View>
          <View className='action-rhythm-days'>{captureWeekDays.map(({ date, isToday }) => <View key={date.toISOString()} className={`action-rhythm-day ${isToday ? 'today' : ''}`}><Text>{['一', '二', '三', '四', '五', '六', '日'][(date.getDay() + 6) % 7]}</Text><Text>{date.getDate()}</Text></View>)}</View>
          <View className={`action-capture-button ${captureLocked ? 'disabled' : ''}`} onClick={openCapture}><Text>＋ 捕获</Text></View>
        </View>
        <View className={`workspace action-workspace ${showTrash ? 'is-trash' : ''} module-panel ${!showTrash && (reviewEditing || selectedItem?.status === 'reviewed') ? 'review-workspace' : ''}`} id='workspace'>
        <View className='list-panel'>
          {!showTrash && <View className='desktop-action-list-tools'>
            <View className='desktop-action-calendar'><Text className='action-rhythm-date'>{compactRhythmDate} · 事项池（{visibleItems.length}）</Text></View>
          </View>}
          <View className='panel-heading'><View><Text className='section-kicker'>{showTrash ? '回收站' : '事项池'}</Text><Text className='panel-title'>{visibleItems.length} 件事</Text></View></View>
          <View className='filter-header'>
            {showTrash ? <Text className='filter-guidance'>删除后保留 30 天，之后自动永久清理</Text> : filter === 'abandoned' || filter === 'waiting_review' ? <><Text className='filter-guidance'>{filter === 'abandoned' ? `已放弃 · ${abandonedItemCount} 件` : `待完成复盘（历史）· ${historicalWaitingReviewCount} 件`}</Text><View className='more-status-return' onClick={() => requestLeaveAllDrafts(() => { setFilter('idea_to_try'); setSelectedId(undefined) })}><Text>返回状态导航</Text></View></> : <Text className='filter-guidance'>按行动状态查看</Text>}
          </View>
          {!showTrash && filter !== 'abandoned' && filter !== 'waiting_review' && <View className='compact-status-navigation'>
            {statusNavigation.map((entry) => <View key={entry.status} className={`filter-button ${filter === entry.status ? 'active' : ''}`} onClick={() => requestLeaveAllDrafts(() => { setFilter(entry.status); setSelectedId(undefined) })}><Text>{entry.label}</Text></View>)}
            <View ref={moreStatusMenuRef} className={`filter-button more-status-trigger ${moreStatusMenuOpen ? 'active' : ''}`} onClick={() => setMoreStatusMenuOpen((open) => !open)}><Text>更多</Text>{moreStatusMenuOpen && <View className='more-status-menu'>{moreStatusNavigation.map((entry) => <View key={entry.status} onClick={() => requestLeaveAllDrafts(() => { setMoreStatusMenuOpen(false); setFilter(entry.status); setSelectedId(undefined) })}><Text>{entry.label}</Text></View>)}</View>}</View>
          </View>}
          {!showTrash && filter !== 'abandoned' && filter !== 'waiting_review' && <View className='status-navigation'>
            {statusNavigation.map((entry) => <View key={entry.status} className={`filter-button ${filter === entry.status ? 'active' : ''}`} onClick={() => requestLeaveAllDrafts(() => { setFilter(entry.status); setSelectedId(undefined) })}><Text>{entry.label}</Text></View>)}
            <View ref={moreStatusMenuRef} className={`filter-button more-status-trigger ${moreStatusMenuOpen ? 'active' : ''}`} onClick={() => setMoreStatusMenuOpen((open) => !open)}><Text>更多状态 ▾</Text>{moreStatusMenuOpen && <View className='more-status-menu'><View onClick={() => requestLeaveAllDrafts(() => { setMoreStatusMenuOpen(false); setFilter('abandoned'); setSelectedId(undefined) })}><Text>已放弃（{abandonedItemCount}）</Text></View></View>}</View>
          </View>}
          <View className='list'>
            {visibleItems.length === 0 ? <View className='empty'><Text>{showTrash ? '回收站是空的。' : '这个状态下还没有事项。'}</Text><Text>{showTrash ? '删除的事项会在这里保留 30 天。' : '先捕获一个真实想法，让系统开始运转。'}</Text></View> : visibleItems.map((item) => (
              <div className={`item ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onMouseDown={(event) => { event.stopPropagation(); if (selectedIdRef.current !== item.id) requestLeaveAllDrafts(() => setSelectedId(item.id)) }} onClick={(event) => { event.stopPropagation(); if (selectedIdRef.current !== item.id) requestLeaveAllDrafts(() => setSelectedId(item.id)) }}>
                <View className='item-main'><Text className='item-title'>{item.title}</Text>{sourceDisplayText(methodSourceDisplays[item.id]) && <Text className='item-method-source'>{sourceDisplayText(methodSourceDisplays[item.id])}</Text>}</View>
                <View className='item-meta'>{showTrash
                  ? <><Text className='trash-badge'>待清理</Text><Text className='time'>{Math.max(1, 30 - Math.floor((Date.now() - new Date(item.deletedAt ?? '').getTime()) / 86400000))} 天后清理</Text></>
                  : <><Text className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</Text><Text className='time'>{formatTime(item.updatedAt)}</Text></>}</View>
              </div>
            ))}
          </View>
        </View>
        <View className={`detail-panel ${!showTrash && (reviewEditing || selectedItem?.status === 'reviewed') ? 'review-mode' : ''}`}>
          <View className={`main-workspace-content ${selectedItem ? '' : 'is-empty'}`}>
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
              <Text className='detail-content-label'>长期探索</Text>
              {itemExplorationLoading ? <Text className='item-exploration-copy'>正在载入长期探索关联…</Text>
                : itemExplorationError ? <View className='item-exploration-error'><Text>{itemExplorationError}</Text><Button className='exploration-inline-button' onClick={() => { if (selectedId) { explorationContextAbortRef.current?.abort(); const controller = new AbortController(); explorationContextAbortRef.current = controller; setItemExplorationLoading(true); setItemExplorationError(''); application.getItemExplorationTrack(selectedId, controller.signal).then((context) => { if (!controller.signal.aborted) { setItemExplorationContext(context); setItemExplorationUnknownOutcome(false) } }).catch((error: unknown) => { if (!isApiClientAbort(error) && !controller.signal.aborted) setItemExplorationError(error instanceof Error ? error.message : '暂时无法载入长期探索关联。') }).finally(() => { if (!controller.signal.aborted) setItemExplorationLoading(false) }) } }}>{itemExplorationUnknownOutcome ? '重新读取真实数据' : '重试读取'}</Button></View>
                : itemExplorationContext?.status === 'available' ? <View className='item-exploration-row'><Text className='item-exploration-copy'>{itemExplorationContext.track.name}</Text>{canModifySelectedItemExploration && <View className='item-exploration-actions'><Button className='exploration-inline-button' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void openExplorationSelector()}>调整</Button><Button className='exploration-inline-button danger' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void removeSelectedItemFromExplorationTrack()}>移除</Button></View>}</View>
                    : itemExplorationContext?.status === 'track-deleted' ? <Text className='item-exploration-copy'>原长期探索已删除：{itemExplorationContext.track.name}</Text>
                      : itemExplorationContext?.status === 'unavailable' ? <View><Text className='item-exploration-copy'>关联长期探索暂不可用</Text><Text className='item-exploration-copy'>请保留当前事项并等待数据修复。</Text></View>
                        : <View className='item-exploration-row'><Text className='item-exploration-copy muted'>未归入长期探索</Text>{canModifySelectedItemExploration && <Button className='exploration-inline-button' disabled={itemExplorationSaving || itemExplorationUnknownOutcome} onClick={() => void openExplorationSelector()}>归入</Button>}</View>}
              {explorationSelectorOpen && canModifySelectedItemExploration && <View className='item-exploration-selector'><Text className='item-exploration-selector-heading'>归入长期探索</Text><View className='item-exploration-selector-options'>{selectableExplorationTracks.map((track) => <Button key={track.id} className='exploration-inline-button' disabled={itemExplorationSaving} onClick={() => void assignSelectedItemToExplorationTrack(track.id)}>{track.name}</Button>)}{selectableExplorationTracks.length === 0 && <Text className='item-exploration-copy'>还没有可选长期探索。</Text>}</View><Button className='exploration-inline-button item-exploration-selector-cancel' disabled={itemExplorationSaving} onClick={() => setExplorationSelectorOpen(false)}>取消</Button></View>}
            </View>}
            {showTrash && <Text className='detail-status trash-badge'>将在 30 天内自动清理</Text>}
            {!showTrash && (!contentBelowFacts || selectedItem.status === 'reviewed') && <View className={`action-context-summary ${contentEditingItemId === selectedItem.id ? 'editing' : ''}`}>
              <div className={`action-context-card action-context-content ${contentEditingItemId === selectedItem.id ? 'editing' : ''} ${contentEditingItemId !== selectedItem.id ? 'clickable' : ''}`} ref={contentEditingItemId === selectedItem.id ? contentEditorRef : undefined} role={contentEditingItemId !== selectedItem.id ? 'button' : undefined} tabIndex={contentEditingItemId !== selectedItem.id ? 0 : undefined} onMouseDown={(event) => { if (contentEditingItemId !== selectedItem.id) { event.preventDefault(); openContentEditor() } }} onKeyDown={(event) => { if (contentEditingItemId !== selectedItem.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openContentEditor() } }}>
                <View className='detail-content-heading'>
                  <Text className='detail-content-label'>补充：</Text>
                  {contentEditingItemId !== selectedItem.id && <Text className={`action-context-inline-value ${selectedItem.content ? '' : 'muted'}`}>{selectedItem.content || '点击此处添加补充说明，把这件事拆解为具体的物理下一步……'}</Text>}
                  {contentEditingItemId !== selectedItem.id && <Button className='detail-content-edit' onClick={openContentEditor}><Text>{selectedItem.content ? '编辑' : '添加说明'}</Text></Button>}
                  {contentEditingItemId === selectedItem.id && <View className='detail-content-editor'>
                    <textarea ref={contentInputRef} className='detail-content-input' rows={1} value={contentDraft} maxLength={1000} placeholder='补充这件事的背景、约束或想法' onInput={(event) => { resizeContentEditor(event.currentTarget); updateContentDraft(selectedItem.id, event.currentTarget.value) }} />
                  </View>}
                </View>
                {contentEditingItemId === selectedItem.id && contentSaveError && <View className='detail-content-save-feedback error'><Text>{contentSaveError}</Text>{!contentSaveUnknownOutcome && <Button className='detail-content-retry' disabled={contentSavingItemId === selectedItem.id} onClick={retrySaveItemContent}>重试</Button>}</View>}
              </div>
            </View>}
            {!showTrash && selectedItem.status === 'reviewed' && <View className='review-result-card'>
              {selectedReviewLoading ? <Text className='review-result-empty'>正在读取复盘结果…</Text>
                : selectedReview ? <>
                  {selectedReview.actualAction.trim() && selectedReview.actualAction.trim() !== selectedReview.result.trim() && <View className='review-result-section'><Text className='review-result-section-label'>做了什么</Text><Text className='review-result-value'>{selectedReview.actualAction}</Text></View>}
                  <View className='review-result-section'><Text className='review-result-section-label'>复盘结果</Text><Text className='review-result-value'>{selectedReview.result.trim() || selectedReview.actualAction.trim() || '未记录结果'}</Text></View>
                  {selectedReview.effective.trim() && selectedReview.effective !== defaultEffective && <View className='review-result-section'><Text className='review-result-section-label'>有效 / 舒服</Text><Text className='review-result-value'>{selectedReview.effective}</Text></View>}
                  {selectedReview.incompatible.trim() && selectedReview.incompatible !== defaultIncompatible && <View className='review-result-section'><Text className='review-result-section-label'>阻力 / 不舒服</Text><Text className='review-result-value'>{selectedReview.incompatible}</Text></View>}
                  {selectedReview.newIdeas.trim() && <View className='review-result-section'><Text className='review-result-section-label'>产生新想法</Text><Text className='review-result-value'>{selectedReview.newIdeas}</Text></View>}
                </> : <Text className='review-result-empty'>未找到该事项的复盘记录。</Text>}
            </View>}
            {!showTrash && startFeedbackVisible(startedFeedbackItemId, selectedItem) && <View className='started-feedback' role='status'>
              <Text>✓ 进行中</Text>
              <Text>现在先从一个小动作开始。</Text>
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

            {!showTrash && contentBelowFacts && selectedItem.status !== 'reviewed' && <View className={`action-context-summary detail-content-after-facts ${contentEditingItemId === selectedItem.id ? 'editing' : ''}`}>
              <div className={`action-context-card action-context-content ${contentEditingItemId === selectedItem.id ? 'editing' : ''} ${contentEditingItemId !== selectedItem.id ? 'clickable' : ''}`} ref={contentEditingItemId === selectedItem.id ? contentEditorRef : undefined} role={contentEditingItemId !== selectedItem.id ? 'button' : undefined} tabIndex={contentEditingItemId !== selectedItem.id ? 0 : undefined} onMouseDown={(event) => { if (contentEditingItemId !== selectedItem.id) { event.preventDefault(); openContentEditor() } }} onKeyDown={(event) => { if (contentEditingItemId !== selectedItem.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openContentEditor() } }}>
                <View className='detail-content-heading'>
                  <Text className='detail-content-label'>补充：</Text>
                  {contentEditingItemId !== selectedItem.id && <Text className={`action-context-inline-value ${selectedItem.content ? '' : 'muted'}`}>{selectedItem.content || '点击此处添加补充说明，把这件事拆解为具体的物理下一步……'}</Text>}
                  {contentEditingItemId !== selectedItem.id && <Button className='detail-content-edit' onClick={openContentEditor}><Text>{selectedItem.content ? '编辑' : '添加说明'}</Text></Button>}
                  {contentEditingItemId === selectedItem.id && <View className='detail-content-editor'>
                    <textarea ref={contentInputRef} className='detail-content-input' rows={1} value={contentDraft} maxLength={1000} placeholder='补充这件事的背景、约束或想法' onInput={(event) => { resizeContentEditor(event.currentTarget); updateContentDraft(selectedItem.id, event.currentTarget.value) }} />
                  </View>}
                </View>
                {contentEditingItemId === selectedItem.id && contentSaveError && <View className='detail-content-save-feedback error'><Text>{contentSaveError}</Text>{!contentSaveUnknownOutcome && <Button className='detail-content-retry' disabled={contentSavingItemId === selectedItem.id} onClick={retrySaveItemContent}>重试</Button>}</View>}
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
              {actionsFor(selectedItem).filter((action) => !['idea_later', 'paused'].includes(action.status) && !(action.status === 'abandoned' && (selectedItem.status === 'idea_to_try' || selectedItem.status === 'doing'))).map((action) => <Button key={action.status} className={`action-button ${action.tone} ${action.label === '开始执行' ? 'start-execution-button' : ''}`} disabled={busy} onClick={() => shouldInterceptStartAction(selectedItem, action) ? requestLeaveAllDrafts(openStartConfirm) : changeStatus(action)}>{action.label}</Button>)}
              {deleteConfirm ? <View className='delete-confirm'>
                <Text>确定删除“{selectedItem.title}”？删除后可在回收站保留 30 天。</Text>
                <View className='delete-confirm-actions'>
                  <Button className='action-button secondary' disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button>
                  <Button className='action-button delete-confirm-button' disabled={busy} onClick={removeSelected}>确认删除</Button>
                </View>
              </View> : <Button className='action-button delete' disabled={busy} onClick={() => requestLeaveAllDrafts(() => setDeleteConfirm(true))}>删除事项</Button>}
            </View>}
          </> : <View className='detail-empty'>
            <Text className='detail-empty-title'>选择一件事</Text>
            <Text className='detail-empty-description'>查看详情，并推动它进入下一个真实状态。</Text>
          </View>}
          </View>
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

      {primaryModule === 'me' && myTab === 'storage' && <View className='settings-module module-panel'>
                <View className='trash-panel'>
          <View className='backup-heading'><View><Text className='section-kicker'>回收站</Text><Text className='panel-title'>已删除的事项、方法和长期探索</Text></View><View className='trash-heading-actions'><Text className='backup-description'>事项和方法保留 30 天；长期探索当前不自动清理。</Text><Button className='action-button secondary' aria-expanded={trashExpanded} onClick={() => setTrashExpanded((expanded) => !expanded)}>{trashExpanded ? '收起' : '展开'}</Button></View></View>
          {trashExpanded && <>
            <View className='trash-filter-actions'>{(['all', 'item', 'method', 'exploration-track'] as TrashFilter[]).map((entry) => <View key={entry} className={`all-filter-button ${trashFilter === entry ? 'active' : ''}`} onClick={() => setTrashFilter(entry)}><Text>{{ all: '全部', item: '事项', method: '方法', 'exploration-track': '长期探索' }[entry]}</Text></View>)}</View>
            {trashEntries.length > 0 && <View className='trash-batch-actions'><View className='trash-batch-selection'><label className='trash-select-control'><input type='checkbox' checked={allTrashSelected} onChange={() => setSelectedTrashKeys(allTrashSelected ? new Set() : new Set(trashEntries.map((entry) => `${entry.type}:${entry.id}`)))} /><Text>全选当前筛选结果</Text></label><Text>已选 {selectedTrashEntries.length}</Text></View><View className={`trash-batch-action-slot ${selectedTrashEntries.length > 0 ? 'is-visible' : ''}`}><Button className='action-button secondary' disabled={busy || selectedTrashEntries.length === 0} onClick={() => setSelectedTrashKeys(new Set())}>清空选择</Button><Button className='action-button danger' disabled={busy || selectedTrashEntries.length === 0} onClick={() => setPendingTrashPurge(selectedTrashEntries.map(({ type, id }) => ({ type, id })))}>批量永久删除</Button></View></View>}
            {trashLoading ? <Text className='method-evidence-state'>正在读取回收站…</Text> : trashEntries.length === 0 ? <Text className='method-evidence-state'>回收站是空的。</Text> : <View className='trash-entry-list'>{trashEntries.map((entry) => { const key = `${entry.type}:${entry.id}`; const selected = selectedTrashKeys.has(key); return <View className='trash-entry' key={key}><label className='trash-entry-select' onClick={(event) => event.stopPropagation()}><input type='checkbox' checked={selected} onChange={() => setSelectedTrashKeys((current) => { const next = new Set(current); if (selected) next.delete(key); else next.add(key); return next })} /></label><View className={`trash-entry-copy ${entry.type === 'exploration-track' ? 'trash-entry-clickable' : ''}`} onClick={() => openTrashTrackDetail(entry)}><Text className='trash-entry-title'>{entry.title}</Text><Text className='trash-entry-meta'>{trashEntryTypeLabels[entry.type]} · 已删除 · {formatTime(entry.deletedAt)}</Text>{entry.type === 'exploration-track' && <Text className='trash-entry-hint'>点击查看绑定事项</Text>}</View><View className='trash-entry-actions' onClick={(event) => event.stopPropagation()}><View className='trash-entry-action'><Button className='action-button secondary' disabled={busy} onClick={() => setPendingTrashRestore(entry)}>恢复</Button></View><View className='trash-entry-action'><Button className='action-button danger' disabled={busy} onClick={() => setPendingTrashPurge([{ type: entry.type, id: entry.id }])}>永久删除</Button></View></View></View> })}</View>}
          </>}
        </View>
        <View className='data-status-panel'>
          <View><Text className='section-kicker'>本地数据状态</Text><Text className='panel-title'>数据仅保存在当前浏览器</Text></View>
          <View className='data-status-grid'>
            <View><Text>{items.length}</Text><Text>有效事项</Text></View>
            <View><Text>{methods.length}</Text><Text>当前方法</Text></View>
            <View><Text>{activeExplorationTrackCount ?? '—'}</Text><Text>长期探索</Text></View>
            <View><Text>{trashItems.length}</Text><Text>回收站</Text></View>
          </View>
        </View>
        <View className='backup-panel'>
        <View className='backup-heading'>
          <View><Text className='section-kicker'>数据备份</Text><Text className='panel-title'>导出与恢复</Text></View>
          <Text className='backup-description'>数据仅保存在当前浏览器。建议每周及重大更新前导出一次 JSON 备份。</Text>
        </View>
        <View className='backup-actions'>
          <View className={`secondary-button backup-export-button ${busy || restoring ? 'disabled' : ''}`} onClick={() => { if (!busy && !restoring) exportBackup() }}><Text>导出完整备份</Text></View>
          <label className={`file-button ${busy || restoring ? 'disabled' : ''}`}>导入恢复<input className='backup-file-input' style={{ display: 'none' }} type='file' accept='application/json,.json' disabled={busy || restoring} onChange={selectBackup} /></label>
        </View>
        {backupMessage && <Text className={`backup-message ${pendingBackup ? 'warning' : ''}`}>{backupMessage}</Text>}
        {pendingBackup && <View className='restore-confirm'>
          <Text>备份时间：{formatTime(pendingBackup.exportedAt)}</Text>
          <Text>{pendingBackup.data.items.length} 条事项 · {pendingBackup.data.reviews.length} 条复盘 · {pendingBackup.data.methods.length} 条方法 · {pendingBackup.version === 3 ? pendingBackup.data.explorationTracks.length : 0} 条长期探索</Text>
          <Text className='restore-warning'>恢复会完整覆盖当前浏览器中的全部数据。确认后，系统会先自动下载当前数据的安全备份，再执行恢复。</Text>
          <View className='restore-actions'>
            <View className={`secondary-button restore-cancel-button ${busy || restoring ? 'disabled' : ''}`} onClick={() => { if (!busy && !restoring) { setPendingBackup(undefined); setBackupMessage('已取消恢复') } }}><Text>取消</Text></View>
            <Button className='action-button delete-confirm-button' disabled={busy || restoring} onClick={restoreBackup}>备份当前数据并恢复</Button>
          </View>
        </View>}      {pendingTrashRestore && <View className='trash-restore-backdrop' onClick={() => { if (!busy) setPendingTrashRestore(undefined) }}><View className='trash-restore-confirm' role='dialog' aria-label='恢复确认' onClick={(event) => event.stopPropagation()}><Text>恢复“{pendingTrashRestore.title}”？</Text><Text>恢复后将重新回到当前可用数据中。</Text><View><Button className='action-button secondary' disabled={busy} onClick={() => setPendingTrashRestore(undefined)}>取消</Button><Button className='action-button primary' disabled={busy} onClick={() => restoreTrashEntry(pendingTrashRestore)}>恢复</Button></View></View></View>}
      {pendingTrashPurge && <View className='trash-restore-backdrop' onClick={() => { if (!busy) setPendingTrashPurge(undefined) }}><View className='trash-restore-confirm' role='dialog' aria-label='永久删除确认' onClick={(event) => event.stopPropagation()}><Text>永久删除 {pendingTrashPurge.length} 条回收站记录？</Text><Text className='restore-warning'>永久删除后无法恢复，请确认要继续。</Text><View><Button className='action-button secondary' disabled={busy} onClick={() => setPendingTrashPurge(undefined)}>取消</Button><Button className='action-button danger' disabled={busy} onClick={() => purgeTrashEntries(pendingTrashPurge)}>永久删除</Button></View></View></View>}
      {trashTrackDetailEntry && <View className='trash-restore-backdrop' onClick={() => { if (!busy) closeTrashTrackDetail() }}><View className='trash-track-detail-modal' role='dialog' aria-modal='true' aria-label='长期探索详情' onClick={(event) => event.stopPropagation()}><View className='trash-track-detail-heading'><View><Text className='section-kicker'>已删除长期探索</Text><Text className='panel-title'>{trashTrackDetail?.track.name ?? trashTrackDetailEntry.title}</Text></View><Button className='action-button secondary' onClick={closeTrashTrackDetail}>关闭</Button></View>{trashTrackDetailLoading && <Text className='method-evidence-state'>正在读取详情…</Text>}{trashTrackDetailError && <View className='trash-track-detail-error'><Text>{trashTrackDetailError}</Text><Button className='action-button secondary' onClick={() => openTrashTrackDetail(trashTrackDetailEntry)}>重试</Button></View>}{trashTrackDetail && <><Text className='trash-entry-meta'>已删除 · {formatTime(trashTrackDetail.track.deletedAt ?? trashTrackDetailEntry.deletedAt)} · 生命周期：已删除</Text><Text className='trash-track-detail-section-title'>绑定事项</Text>{trashTrackDetailItems.length === 0 ? <Text className='method-evidence-state'>暂无绑定事项</Text> : <View className='trash-track-detail-items'>{trashTrackDetailItems.map((entry) => <View className='trash-track-detail-item' key={entry.item.id}><View><Text className='trash-entry-title'>{entry.item.title}</Text><Text className='trash-entry-meta'>{statusLabels[entry.item.status] ?? entry.item.status}</Text></View><Text className={`trash-detail-deleted ${entry.item.deletedAt ? 'is-deleted' : ''}`}>{entry.item.deletedAt ? '已删除' : '正常'}</Text></View>)}</View>}</>}</View></View>}      {restoring && <View className='restore-progress'><View className='status-dot' /><Text>恢复正在进行，一级导航已暂时锁定。</Text></View>}
      </View>
      </View>}

      {primaryModule === 'workbench' && workbenchTab === 'methods' && <View className='methods-panel module-panel'>
        <View className='methods-compact-heading'><View><Text className='section-kicker'>当前有效的方法</Text><Text className='panel-title'>{methods.length} 条方法</Text></View></View>
        <View className='methods-page-header'><View><Text className='section-kicker'>当前有效的方法</Text><Text className='panel-title'>{methods.length} 条方法</Text></View><Text>按最近更新排序</Text></View>
        <View className='methods-workbench'>
          {methods.length === 0 ? <View className='methods-empty'><Text>完成复盘时，可以把已验证的结论提炼成方法。</Text></View> : <>
          <View className='method-list-pane'>
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
      <QuickNoteFab visible={quickNoteFabVisible} openRequest={quickNoteOpenRequest} onOpenDailyNotes={() => openPrimaryModule('dailyNotes')} />
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
  const [colorTheme, setColorTheme] = useState<ColorTheme>(readColorTheme)
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
    void restoreApiClientDesktopSession().then(() => readCurrentSession('initial'))
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

  const toggleColorTheme = () => {
    setColorTheme((current) => {
      const next: ColorTheme = current === 'light' ? 'dark' : 'light'
      saveColorTheme(next)
      return next
    })
  }

  if (authSession) return <AuthenticatedWorkspace
    key={`${authSession.user.id}-${authSession.user.createdAt}`}
    session={authSession}
    logoutBusy={logoutBusy}
    logoutUnknownOutcome={logoutUnknownOutcome}
    logoutError={logoutError}
    onLogout={() => void logout()}
    onConfirmLogoutOutcome={() => void confirmUnknownLogout()}
    onPasswordChanged={(username) => { setAuthUsername(username); enterUnauthenticatedGate('密码已修改，请使用新密码重新登录。') }}
    colorTheme={colorTheme}
    onToggleColorTheme={toggleColorTheme}
  />

  const authenticationLocked = authSubmitting || sessionReading || authUnknownOutcome || authNeedsSessionConfirmation
  const canSubmitAuthentication = Boolean(authUsername.trim()) && authPassword.length >= 8 && !authenticationLocked

  return <View className='auth-gate-shell' data-color-theme={colorTheme}>
    <DesktopAuthTitleBar />
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
          <Input value={authPassword} maxlength={256} disabled={authenticationLocked} password placeholder='至少 8 个字符' onInput={(event) => setAuthPassword(event.detail.value)} onConfirm={() => { if (canSubmitAuthentication) void submitAuthentication() }} />
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
