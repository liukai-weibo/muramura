import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { ActivityAuditEvent, ActivityAuditEventPage, AuditAction, AuditModule } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort, type ActivityAuditQuery, type ApiClientError } from './api-client'

const PAGE_SIZE = 20

const moduleOptions: Array<{ value: AuditModule; label: string }> = [
  { value: 'daily_note', label: '手记' },
  { value: 'mood', label: '情绪' },
  { value: 'meal', label: '三餐' },
  { value: 'item', label: '事项' },
  { value: 'search', label: '搜索' },
  { value: 'exploration_track', label: '探索轨道' },
  { value: 'method', label: '方法' },
  { value: 'review', label: '复盘' },
  { value: 'home_ai_card', label: 'AI 卡片' },
  { value: 'ai_preference', label: 'AI 偏好' },
  { value: 'ai_conversation', label: 'AI 会话' },
  { value: 'ai_config', label: 'AI 配置' },
]

const actionOptions: Array<{ value: AuditAction; label: string }> = [
  { value: 'create', label: '新建' },
  { value: 'update', label: '编辑' },
  { value: 'delete', label: '删除' },
  { value: 'search', label: '搜索' },
  { value: 'assign', label: '分配' },
  { value: 'remove', label: '移除' },
  { value: 'restore', label: '恢复' },
  { value: 'purge', label: '清空' },
  { value: 'archive', label: '归档' },
  { value: 'complete', label: '复盘' },
  { value: 'append', label: '发送' },
]

const moduleLabel: Record<AuditModule, string> = { daily_note: '手记', mood: '情绪', meal: '三餐', item: '事项', search: '搜索', exploration_track: '探索轨道', method: '方法', review: '复盘', daily_summary: '状态小结', daily_diet: '饮食推荐', home_ai_card: 'AI 卡片', ai_preference: 'AI 偏好', ai_conversation: 'AI 会话', ai_config: 'AI 配置' }
const actionLabel: Record<AuditAction, string> = { create: '新建', update: '编辑', delete: '删除', search: '搜索', assign: '分配', remove: '移除', restore: '恢复', purge: '清空', archive: '归档', complete: '复盘', append: '发送', refresh: '刷新' }

type ListState = 'initial-loading' | 'ready' | 'refreshing' | 'initial-error' | 'refresh-error'

interface AuditCenterProps {
  authenticationContext: string
  visible: boolean
}

interface FilterDraft {
  /** 合并搜索：用户名 / 用户 ID / 快照内容任一匹配。 */
  search: string
  modules: AuditModule[]
  actions: AuditAction[]
  from: string
  to: string
}

const emptyDraft = (): FilterDraft => ({ search: '', modules: [], actions: [], from: '', to: '' })

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function dateValid(value: string): boolean {
  return value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
}

import { snapshotPreviewSegments, snapshotPretty } from './audit-snapshot-preview'

/** 页码序列：页数 ≤7 全显；否则 首 + 省略 + 当前±1 + 省略 + 尾。 */
function pageItems(current: number, pages: number): Array<number | 'ellipsis'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const items: Array<number | 'ellipsis'> = [1]
  if (current > 3) items.push('ellipsis')
  for (let page = Math.max(2, current - 1); page <= Math.min(pages - 1, current + 1); page += 1) items.push(page)
  if (current < pages - 2) items.push('ellipsis')
  items.push(pages)
  return items
}

export function AuditCenter({ authenticationContext, visible }: AuditCenterProps) {
  const [snapshot, setSnapshot] = useState<ActivityAuditEventPage>()
  const snapshotRef = useRef<ActivityAuditEventPage>()
  const [listState, setListState] = useState<ListState>('initial-loading')
  const [draft, setDraft] = useState<FilterDraft>(() => emptyDraft())
  const [applied, setApplied] = useState<FilterDraft>(() => emptyDraft())
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<{ kind: 'error' | 'refresh-error'; message: string; requestId?: string }>()
  const [exporting, setExporting] = useState(false)
  const [snapshotView, setSnapshotView] = useState<ActivityAuditEvent>()

  const readAbortRef = useRef<AbortController>()
  const readGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const authenticationContextRef = useRef(authenticationContext)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; readAbortRef.current?.abort() }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSnapshotView(undefined) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const appliedRef = useRef(applied)
  appliedRef.current = applied
  const pageRef = useRef(page)
  pageRef.current = page

  const buildQuery = (pageValue: number, filter: FilterDraft): ActivityAuditQuery => ({
    search: filter.search.trim() || undefined,
    modules: filter.modules.length ? filter.modules : undefined,
    actions: filter.actions.length ? filter.actions : undefined,
    from: filter.from || undefined,
    to: filter.to || undefined,
    page: pageValue,
    pageSize: PAGE_SIZE,
  })

  const readEvents = async (nextPage = pageRef.current, nextFilter = appliedRef.current) => {
    readAbortRef.current?.abort()
    const controller = new AbortController()
    readAbortRef.current = controller
    const generation = ++readGenerationRef.current
    const authentication = authenticationContextRef.current
    setNotice(undefined)
    setListState(snapshotRef.current ? 'refreshing' : 'initial-loading')
    try {
      const result = await apiClient.listActivityAuditEvents(buildQuery(nextPage, nextFilter), controller.signal)
      if (controller.signal.aborted || generation !== readGenerationRef.current || authentication !== authenticationContextRef.current || !mountedRef.current) return
      snapshotRef.current = result
      setSnapshot(result)
      setListState('ready')
    } catch (error) {
      if (controller.signal.aborted || generation !== readGenerationRef.current || authentication !== authenticationContextRef.current || !mountedRef.current) return
      if (isApiClientAbort(error)) return
      const apiError = error as ApiClientError
      if (apiError.status === 401 || apiError.status === 403) return
      const hasSnapshot = Boolean(snapshotRef.current)
      setNotice({ kind: hasSnapshot ? 'refresh-error' : 'error', message: error instanceof Error ? error.message : '无法读取审计事件。', requestId: apiError.requestId })
      setListState(hasSnapshot ? 'refresh-error' : 'initial-error')
    }
  }

  useEffect(() => {
    void readEvents(1, emptyDraft())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitFilter = () => {
    if (!dateValid(draft.from) || !dateValid(draft.to)) {
      setNotice({ kind: 'error', message: '日期需为 YYYY-MM-DD 格式。' })
      return
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setNotice({ kind: 'error', message: '开始日期不能晚于结束日期。' })
      return
    }
    setApplied(draft)
    setPage(1)
    void readEvents(1, draft)
  }

  const clearFilter = () => {
    setDraft(emptyDraft())
    setApplied(emptyDraft())
    setPage(1)
    void readEvents(1, emptyDraft())
  }

  const goPage = (target: number) => {
    const total = snapshotRef.current?.total ?? 0
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    if (!Number.isSafeInteger(target) || target < 1 || target > pages) return
    setPage(target)
    void readEvents(target, appliedRef.current)
  }

  const exportCsv = () => {
    if (exporting) return
    setExporting(true)
    try {
      const url = apiClient.buildActivityAuditExportUrl({
        search: applied.search.trim() || undefined,
        modules: applied.modules.length ? applied.modules : undefined,
        actions: applied.actions.length ? applied.actions : undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      })
      window.open(url, '_blank', 'noopener')
    } finally {
      setExporting(false)
    }
  }

  const refreshing = listState === 'refreshing'
  const reading = refreshing || listState === 'initial-loading'
  const pages = snapshot ? Math.max(1, Math.ceil(snapshot.total / PAGE_SIZE)) : 1
  const hasFilter = Boolean(draft.search.trim() || draft.modules.length || draft.actions.length || draft.from || draft.to)

  return <View className={'audit-center ' + (visible ? '' : 'audit-center-hidden')}>
    <View className='audit-center-header'>
      <View><Text className='audit-center-title'>安全审计中心</Text><Text className='audit-center-description'>按用户、功能模块与时间查看内容变更与操作日志（仅平台管理员）</Text></View>
      <Button className='audit-center-export' disabled={exporting || !snapshot} onClick={exportCsv}>{exporting ? '正在导出…' : <><Text className='audit-center-export-icon'>⬇</Text><Text>导出 CSV</Text></>}</Button>
    </View>

    <View className='audit-center-filter' role='group' aria-label='审计筛选'>
      <input
        className='audit-center-text-input'
        aria-label='搜索'
        value={draft.search}
        maxLength={120}
        disabled={reading}
        placeholder='搜索用户名 / 用户 ID / 内容快照'
        onInput={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, search: value })) }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !reading) submitFilter() }}
      />
      <View className='audit-center-filter-group'>
        <Text className='audit-center-filter-label'>时间：</Text>
        <input className='audit-center-text-input' type='date' aria-label='开始日期' value={draft.from} disabled={reading} onInput={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, from: value })) }} />
        <Text className='audit-center-filter-sep'>至</Text>
        <input className='audit-center-text-input' type='date' aria-label='结束日期' value={draft.to} disabled={reading} onInput={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, to: value })) }} />
      </View>
      <View className='audit-center-filter-actions'>
        {hasFilter && <Button className='platform-administration-clear' disabled={reading} onClick={clearFilter}>清除</Button>}
        <Button className='platform-administration-search-button' disabled={reading} onClick={submitFilter}>筛选</Button>
      </View>
      <View className='audit-center-filter-group'>
        <Text className='audit-center-filter-label'>模块：</Text>
        {moduleOptions.map((option) => <Button key={option.value} className={'audit-center-chip ' + (draft.modules.includes(option.value) ? 'active' : '')} disabled={reading} onClick={() => setDraft((current) => ({ ...current, modules: toggle(current.modules, option.value) }))}>{option.label}</Button>)}
      </View>
      <View className='audit-center-filter-group'>
        <Text className='audit-center-filter-label'>操作：</Text>
        {actionOptions.map((option) => <Button key={option.value} className={'audit-center-chip ' + (draft.actions.includes(option.value) ? 'active' : '')} disabled={reading} onClick={() => setDraft((current) => ({ ...current, actions: toggle(current.actions, option.value) }))}>{option.label}</Button>)}
      </View>
    </View>

    {refreshing && <Text className='platform-administration-updating'>正在读取最新审计事件</Text>}
    {notice && listState === 'refresh-error' && snapshot && <View className='platform-administration-error'><Text>以下为刷新前内容。{notice.message}</Text>{notice.requestId && <Text>requestId：{notice.requestId}</Text>}</View>}

    {listState === 'initial-loading' && !snapshot ? <View className='platform-administration-skeleton' aria-label='正在读取审计事件'>{Array.from({ length: 6 }, (_, index) => <View key={index} />)}</View>
      : listState === 'initial-error' && !snapshot ? <View className='platform-administration-initial-error'><Text>{notice?.message || '无法读取审计事件。'}</Text>{notice?.requestId && <Text>requestId：{notice.requestId}</Text>}<Button onClick={() => void readEvents(page, applied)}>重新加载</Button></View>
        : snapshot && <>
          {snapshot.items.length === 0 ? <View className='platform-administration-empty'>
            <Text>{hasFilter ? '没有匹配当前筛选条件的审计事件。' : snapshot.total === 0 ? '暂无审计事件。' : '当前页没有审计事件。'}</Text>
            {hasFilter && <Button onClick={clearFilter}>清除筛选</Button>}
          </View> : <View className='audit-event-list'>
            <View className='audit-event-table-heading'><Text>时间</Text><Text>用户</Text><Text>模块</Text><Text>操作</Text><Text>内容快照</Text></View>
            {snapshot.items.map((event) => { const segments = snapshotPreviewSegments(event.snapshot); return <View className='audit-event-row' key={event.id}>
              <Text className='audit-event-time'>{formatTime(event.createdAt)}</Text>
              <Text className='audit-event-actor'>{event.actorUsername || event.actorUserId}</Text>
              <Text className={'audit-event-module audit-event-module-' + event.module}>{moduleLabel[event.module]}</Text>
              <Text className={'audit-event-action audit-event-action-' + event.action}>{actionLabel[event.action]}</Text>
              <Button className='audit-event-snapshot' aria-label='查看完整内容快照' {...(event.snapshot ? { title: snapshotPretty(event.snapshot).slice(0, 200) } as never : {})} onClick={() => setSnapshotView(event)}>
                <Text className='audit-event-snapshot-inner'>{segments.map((segment, index) => <Text key={index}>{segment.label ? <Text className='audit-event-snapshot-label'>{segment.label}</Text> : null}<Text className='audit-event-snapshot-copy'>{segment.value}</Text>{index < segments.length - 1 ? <Text className='audit-event-snapshot-sep'> · </Text> : null}</Text>)}</Text>
              </Button>
            </View> }) }
          </View>}
          <View className='platform-administration-pagination'>
            <Text className='audit-center-pagination-info'>共 {snapshot.total} 条记录 · 第 {snapshot.page} / {pages} 页</Text>
            <View className='audit-center-pagination-controls'>
              <Button className='audit-center-page-button' disabled={reading || snapshot.page <= 1} onClick={() => goPage(snapshot.page - 1)}>上一页</Button>
              {pageItems(snapshot.page, pages).map((item, index) => item === 'ellipsis'
                ? <Text key={'e' + index} className='audit-center-page-ellipsis'>…</Text>
                : <Button key={item} className={'audit-center-page-button' + (item === snapshot.page ? ' current' : '')} disabled={reading || item === snapshot.page} onClick={() => goPage(item)}>{item}</Button>)}
              <Button className='audit-center-page-button' disabled={reading || snapshot.page >= pages} onClick={() => goPage(snapshot.page + 1)}>下一页</Button>
            </View>
          </View>
        </>}

    {snapshotView && <View className='audit-snapshot-backdrop' role='dialog' aria-modal='true' aria-label='内容快照详情' onClick={(event) => { if (event.target === event.currentTarget) setSnapshotView(undefined) }}>
      <View className='audit-snapshot-dialog'>
        <View className='audit-snapshot-heading'>
          <View><Text className='audit-snapshot-title'>内容快照详情</Text><Text className='audit-snapshot-meta'>{formatTime(snapshotView.createdAt)} · {snapshotView.actorUsername || snapshotView.actorUserId} · {moduleLabel[snapshotView.module]} / {actionLabel[snapshotView.action]}</Text></View>
          <View className='audit-snapshot-close' onClick={() => setSnapshotView(undefined)}><Text>✕</Text></View>
        </View>
        <View className='audit-snapshot-body'>
          {snapshotView.snapshot ? <Text className='audit-snapshot-content'>{snapshotPretty(snapshotView.snapshot)}</Text> : <Text className='audit-snapshot-empty'>（无快照内容）</Text>}
        </View>
        <Text className='audit-snapshot-footnote'>点击弹窗外部或按 Esc 关闭</Text>
      </View>
    </View>}
  </View>
}
