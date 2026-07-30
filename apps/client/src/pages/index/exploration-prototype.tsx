import { Button, Input, Text, View } from '@tarojs/components'
import type { CurrentAssociatedStatus, ExplorationTrackHistory, ExplorationTrackItem, ExplorationTrackListEntry, ItemLocator } from '@knowledge-base/contracts'
import { createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { apiClient, isApiClientAbort, isApiClientUnknownOutcome } from './api-client'
import { captureDraftAfterWrite, explorationListReadState, isCurrentExplorationRequest, mayUnlockUnknownOutcome } from './exploration-session-state'

const statusLabels: Record<string, string> = {
  doing: '已开始', idea_to_try: '想试试', idea_later: '以后再说', paused: '已暂停', reviewed: '已复盘', abandoned: '已放弃',
}
const currentStatuses: CurrentAssociatedStatus[] = ['doing', 'idea_to_try', 'idea_later', 'paused']
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const itemTimeFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const formatItemTime = (value: string) => itemTimeFormatter.format(new Date(value))
const ItemUpdatedAtContext = createContext<ReadonlyMap<string, string>>(new Map())
const EXPLORATION_TRACK_PAGE_SIZE = 9
const ITEM_TITLE_MAX_GRAPHEMES = 20
const itemTitleSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function itemTitleGraphemeCount(value: string): number {
  return [...itemTitleSegmenter.segment(value.trim())].length
}

function acceptsItemTitleInput(value: string): boolean {
  return itemTitleGraphemeCount(value) <= ITEM_TITLE_MAX_GRAPHEMES
}

function Summary({ item }: { item: ExplorationTrackItem }) {
  if (item.reviewSummaryStatus !== 'available' || !item.reviewSummary) return <Text className='exploration-review-summary'>复盘详情请在事项中查看。</Text>
  const value = [item.reviewSummary.actualAction, item.reviewSummary.result].filter(Boolean).join('；')
  return value ? <Text className='exploration-review-summary'>{value}</Text> : <Text className='exploration-review-summary'>复盘详情请在事项中查看。</Text>
}

const TrackItem = memo(function TrackItem({ item, onOpen }: { item: ExplorationTrackItem; onOpen: (locator: ItemLocator) => void }) {
  const itemUpdatedAtById = useContext(ItemUpdatedAtContext)
  const updatedAt = itemUpdatedAtById.get(item.item.id)
  return <View className='exploration-track-item'>
    <View className='exploration-track-item-heading'>
      <View className='exploration-track-item-copy'><View className='exploration-track-item-title-row'><Text className='exploration-track-item-title'>{item.item.title}</Text><Text className={`exploration-status exploration-status-${item.item.status}`}>{statusLabels[item.item.status] ?? item.item.status}</Text><Text className='exploration-track-item-time'>创建 {formatItemTime(item.item.createdAt)}{updatedAt ? ` · 更新 ${formatItemTime(updatedAt)}` : ''}</Text><Button className='exploration-inline-button exploration-track-item-open' onClick={() => onOpen(item.locator)}>查看</Button></View>{item.item.startAction && <Text className='exploration-track-item-meta'>开始时准备：{item.item.startAction}</Text>}</View>
    </View>
    {item.item.status === 'paused' && <Text className='exploration-track-item-meta exploration-paused-meta'>当前暂时停止投入</Text>}
    {(item.item.status === 'reviewed' || item.item.status === 'abandoned') && <Summary item={item} />}
  </View>
})

export function ExplorationPrototype({ explorationFactsVersion, restoreFactsVersion, onRestoreFactsConfirmed, onRestoreFactsFailed, onExplorationTrackCountChange, onItemsChanged, onOpenItem, onOpenItems, itemUpdatedAtById }: { explorationFactsVersion: number; restoreFactsVersion: number; onRestoreFactsConfirmed: () => void; onRestoreFactsFailed: (message: string) => void; onExplorationTrackCountChange: (count: number) => void; onItemsChanged: () => Promise<void>; onOpenItem: (locator: ItemLocator) => void; onOpenItems: (status: CurrentAssociatedStatus, items: import('@knowledge-base/contracts').Item[]) => void; itemUpdatedAtById: ReadonlyMap<string, string> }) {
  const [tracks, setTracks] = useState<ExplorationTrackListEntry[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [listPage, setListPage] = useState(1)
  const [history, setHistory] = useState<ExplorationTrackHistory>()
  const [listLoading, setListLoading] = useState(true)
  const [listReadSucceeded, setListReadSucceeded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [draftTitleLimitReached, setDraftTitleLimitReached] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [editing, setEditing] = useState(false)
  const [editingTrackId, setEditingTrackId] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [historyView, setHistoryView] = useState<'history' | 'abandoned'>('history')
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const listAbort = useRef<AbortController>()
  const detailAbort = useRef<AbortController>()
  const explorationRootRef = useRef<HTMLDivElement>()
  const editingAreaRef = useRef<HTMLDivElement>()
  const editingTrackIdRef = useRef<string>()
  const editingSessionRef = useRef(0)
  const savingRenameSessionRef = useRef<number>()
  const selectedIdRef = useRef<string>()
  const restoredHistoryIdRef = useRef<string>()
  selectedIdRef.current = selectedId

  const loadList = async (preferredId?: string, resetToFirstPage = false, preserveCurrentSelection = false): Promise<{ succeeded: boolean; selectedId?: string }> => {
    listAbort.current?.abort()
    const controller = new AbortController(); listAbort.current = controller
    const requestId = ++listRequest.current
    setListLoading(true); setError('')
    try {
      const next = await apiClient.listExplorationTracks(controller.signal)
      if (!isCurrentExplorationRequest(requestId, listRequest.current)) return { succeeded: false }
      const normalized = next
      setTracks(normalized)
      onExplorationTrackCountChange(normalized.length)
      setListReadSucceeded(true)
      const effectivePreferredId = preserveCurrentSelection ? selectedIdRef.current : preferredId
      const preferredIndex = effectivePreferredId ? normalized.findIndex((entry) => entry.track.id === effectivePreferredId) : -1
      const pageCount = Math.ceil(normalized.length / EXPLORATION_TRACK_PAGE_SIZE)
      const nextPage = pageCount === 0 ? 1 : resetToFirstPage ? 1 : preferredIndex >= 0 ? Math.floor(preferredIndex / EXPLORATION_TRACK_PAGE_SIZE) + 1 : Math.min(listPage, pageCount)
      const nextId = preferredIndex >= 0 && !resetToFirstPage ? effectivePreferredId : normalized[(nextPage - 1) * EXPLORATION_TRACK_PAGE_SIZE]?.track.id
      setListPage(nextPage)
      setSelectedId(nextId)
      if (!nextId) {
        setHistory(undefined)
        setDraft(''); setDraftTitleLimitReached(false)
        setEditing(false); setEditingTrackId(undefined); editingTrackIdRef.current = undefined
        setRenameName(''); setConfirmDelete(false); setHistoryView('history')
      }
      return { succeeded: true, selectedId: nextId }
    } catch (cause) {
      if (!isApiClientAbort(cause) && isCurrentExplorationRequest(requestId, listRequest.current)) setError(messageOf(cause, '暂时无法载入探索主线。'))
      return { succeeded: false }
    } finally { if (isCurrentExplorationRequest(requestId, listRequest.current)) setListLoading(false) }
  }

  const loadHistory = async (id: string): Promise<boolean> => {
    detailAbort.current?.abort()
    const controller = new AbortController(); detailAbort.current = controller
    const requestId = ++detailRequest.current
    let resultApplied = false
    setDetailLoading(true); setError('')
    try {
      const next = await apiClient.getExplorationTrackHistory(id, controller.signal)
      if (isCurrentExplorationRequest(requestId, detailRequest.current)) {
        resultApplied = true
        setHistory(next); setDetailLoading(false)
        return true
      }
      return false
    } catch (cause) {
      if (!isApiClientAbort(cause) && isCurrentExplorationRequest(requestId, detailRequest.current)) setError(messageOf(cause, '暂时无法载入探索历史。'))
      return false
    } finally { if (!resultApplied && isCurrentExplorationRequest(requestId, detailRequest.current)) setDetailLoading(false) }
  }

  useEffect(() => { void loadList(); return () => { listAbort.current?.abort(); detailAbort.current?.abort() } }, [])
  useEffect(() => {
    setHistoryView('history')
    if (selectedId && restoredHistoryIdRef.current === selectedId) {
      restoredHistoryIdRef.current = undefined
      return
    }
    if (selectedId) void loadHistory(selectedId)
  }, [selectedId])
  useEffect(() => {
    if (explorationFactsVersion <= 0) return
    void (async () => {
      const listConfirmed = await loadList(selectedId, false, true)
      const confirmedId = listConfirmed.selectedId
      if (!listConfirmed.succeeded || !confirmedId || selectedIdRef.current !== confirmedId) return
      await loadHistory(confirmedId)
    })()
  }, [explorationFactsVersion])
  useEffect(() => {
    if (restoreFactsVersion <= 0) return
    void (async () => {
      listAbort.current?.abort(); detailAbort.current?.abort()
      const listController = new AbortController(); listAbort.current = listController
      const listRequestId = ++listRequest.current
      setListLoading(true); setError('')
      try {
        const nextTracks = await apiClient.listExplorationTracks(listController.signal)
        if (!isCurrentExplorationRequest(listRequestId, listRequest.current)) return
        const nextSelectedId = nextTracks[0]?.track.id
        let nextHistory: ExplorationTrackHistory | undefined
        if (nextSelectedId) {
          const detailController = new AbortController(); detailAbort.current = detailController
          const detailRequestId = ++detailRequest.current
          setDetailLoading(true)
          try {
            nextHistory = await apiClient.getExplorationTrackHistory(nextSelectedId, detailController.signal)
          } catch (cause) {
            if (!isApiClientAbort(cause) && isCurrentExplorationRequest(detailRequestId, detailRequest.current)) {
              setError(messageOf(cause, '恢复后的探索历史读取失败，请保留当前事实并重新读取。'))
              onRestoreFactsFailed('恢复后的探索历史读取失败，请保留当前事实并重新读取。')
            }
            return
          } finally {
            if (isCurrentExplorationRequest(detailRequestId, detailRequest.current)) setDetailLoading(false)
          }
          if (!isCurrentExplorationRequest(listRequestId, listRequest.current) || !isCurrentExplorationRequest(detailRequestId, detailRequest.current)) return
        }
        setTracks(nextTracks)
        onExplorationTrackCountChange(nextTracks.length)
        setListReadSucceeded(true)
        setListPage(1)
        if (nextSelectedId && nextHistory) {
          restoredHistoryIdRef.current = nextSelectedId
          setHistory(nextHistory)
          setSelectedId(nextSelectedId)
        } else {
          setSelectedId(undefined)
          setHistory(undefined)
          setDraft(''); setDraftTitleLimitReached(false)
          setEditing(false); setEditingTrackId(undefined); editingTrackIdRef.current = undefined
          setRenameName(''); setConfirmDelete(false); setHistoryView('history')
        }
        onRestoreFactsConfirmed()
      } catch (cause) {
        if (!isApiClientAbort(cause) && isCurrentExplorationRequest(listRequestId, listRequest.current)) {
          setError(messageOf(cause, '恢复后的探索主线读取失败，请保留当前事实并重新读取。'))
          onRestoreFactsFailed('恢复后的探索主线读取失败，请保留当前事实并重新读取。')
        }
      } finally {
        if (isCurrentExplorationRequest(listRequestId, listRequest.current)) setListLoading(false)
      }
    })()
  }, [restoreFactsVersion])

  const confirmRealFacts = async () => {
    const listConfirmed = await loadList(selectedId)
    const historyConfirmed = listConfirmed.selectedId ? await loadHistory(listConfirmed.selectedId) : true
    if (mayUnlockUnknownOutcome([listConfirmed.succeeded, historyConfirmed])) setUnknownOutcome(false)
  }
  const preserveUnknownOutcome = (cause: unknown, fallback: string) => {
    if (isApiClientUnknownOutcome(cause)) { setUnknownOutcome(true); setError('提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。'); return }
    setError(messageOf(cause, fallback))
  }
  const createTrack = async () => {
    if (!newName.trim()) { setError('主线名称不能为空'); return }
    setCreating(true); setError('')
    try { const track = await apiClient.createExplorationTrack(newName); setNewName(''); setCreateDialogOpen(false); await loadList(track.id, true) }
    catch (cause) { preserveUnknownOutcome(cause, '创建未完成，请重试。') }
    finally { setCreating(false) }
  }
  const capture = async (saveForLater: boolean) => {
    if (!history || !draft.trim()) return
    if (!acceptsItemTitleInput(draft)) { setDraftTitleLimitReached(true); return }
    setCreating(true); setError('')
    try {
      try { await apiClient.createIdea({ title: draft, saveForLater, explorationTrack: { type: 'existing', trackId: history.track.id } }) }
      catch (cause) { setDraft(captureDraftAfterWrite(draft, false)); preserveUnknownOutcome(cause, '创建未完成，请重试。'); return }
      try { setDraft(captureDraftAfterWrite(draft, true)); setDraftTitleLimitReached(false); await loadList(history.track.id); await loadHistory(history.track.id); await onItemsChanged() }
      catch (cause) { setError(messageOf(cause, '事项已创建，但暂时无法刷新行动事项。')) }
    } finally { setCreating(false) }
  }
  const saveEditingTrack = async () => {
    const trackId = editingTrackIdRef.current
    const session = editingSessionRef.current
    const name = renameName.trim()
    if (!trackId || editingTrackId !== trackId || !name) { setError('主线名称不能为空'); return }
    if (creating || unknownOutcome || savingRenameSessionRef.current === session) return
    savingRenameSessionRef.current = session
    setCreating(true); setError('')
    try {
      const renamed = await apiClient.renameExplorationTrack(trackId, name)
      if (editingSessionRef.current !== session || editingTrackIdRef.current !== trackId) return
      setHistory((current) => current?.track.id === trackId ? { ...current, track: renamed } : current)
      setEditing(false); setEditingTrackId(undefined); editingTrackIdRef.current = undefined
      await loadList(trackId)
    }
    catch (cause) { preserveUnknownOutcome(cause, '改名未完成，请重试。') }
    finally {
      if (savingRenameSessionRef.current === session) savingRenameSessionRef.current = undefined
      setCreating(false)
    }
  }
  const beginEditingTrack = () => {
    if (!history) return
    editingSessionRef.current += 1
    editingTrackIdRef.current = history.track.id
    setEditingTrackId(history.track.id)
    setRenameName(history.track.name)
    setEditing(true)
  }
  const consumeOutsideEditingPointer = (event: PointerEvent | MouseEvent) => {
    if (!editing || editingAreaRef.current?.contains(event.target as Node)) return
    event.preventDefault()
    event.stopPropagation()
    void saveEditingTrack()
  }
  useEffect(() => {
    const root = explorationRootRef.current
    if (!root || !editing) return
    root.addEventListener('pointerdown', consumeOutsideEditingPointer, true)
    root.addEventListener('click', consumeOutsideEditingPointer, true)
    return () => {
      root.removeEventListener('pointerdown', consumeOutsideEditingPointer, true)
      root.removeEventListener('click', consumeOutsideEditingPointer, true)
    }
  }, [editing, editingTrackId, renameName, creating, unknownOutcome])
  const remove = async () => {
    if (!history) return
    setCreating(true); setError('')
    try { await apiClient.deleteExplorationTrack(history.track.id); setConfirmDelete(false); await loadList(undefined, true); await onItemsChanged() }
    catch (cause) { preserveUnknownOutcome(cause, '删除主线未完成，请重试。') }
    finally { setCreating(false) }
  }
  const listState = explorationListReadState({ loading: listLoading, hasSucceeded: listReadSucceeded, hasEntries: tracks.length > 0 })
  const visibleHistory = historyView === 'history' ? history?.history : history?.abandonedHistory
  const listPageCount = Math.ceil(tracks.length / EXPLORATION_TRACK_PAGE_SIZE)
  const visibleTracks = tracks.slice((listPage - 1) * EXPLORATION_TRACK_PAGE_SIZE, listPage * EXPLORATION_TRACK_PAGE_SIZE)
  const changeListPage = (nextPage: number) => {
    const page = Math.min(Math.max(nextPage, 1), listPageCount)
    const nextTrack = tracks[(page - 1) * EXPLORATION_TRACK_PAGE_SIZE]
    if (!nextTrack) return
    setListPage(page)
    setSelectedId(nextTrack.track.id)
  }
  return <ItemUpdatedAtContext.Provider value={itemUpdatedAtById}><View ref={explorationRootRef} className='exploration-prototype module-panel'>
    <View className='exploration-prototype-header'><View><Text className='section-kicker'>探索主线</Text><Text className='exploration-prototype-title'>让独立行动形成可回看的过程</Text><Text className='module-description'>主线、关联事项与历史均来自本地 loopback API。</Text></View>
      <Button className='primary-button exploration-create-trigger' disabled={creating || unknownOutcome} onClick={() => setCreateDialogOpen(true)}>新建探索主线</Button></View>
    {error && <View className='exploration-notice' role='status'><Text>{error}</Text><Button className='exploration-inline-button' onClick={() => void (unknownOutcome ? confirmRealFacts() : selectedId ? loadHistory(selectedId) : loadList())}>{unknownOutcome ? '重新读取真实数据' : '重试'}</Button></View>}
    <View className='exploration-workspace'>
      <View className='exploration-list-panel'>
        <View className='exploration-list-heading'><View><Text className='section-kicker'>探索主线</Text><Text>记录一段长期兴趣与历程</Text></View>{listLoading && listReadSucceeded && <Text className='exploration-refreshing'>正在更新…</Text>}</View>
        {listState === 'loading' ? <Text className='exploration-state'>正在载入探索主线…</Text> : listState === 'error' ? <View className='exploration-state'><Text>暂时无法载入探索主线。</Text></View> : listState === 'empty' ? <View className='exploration-empty'><Text>还没有探索主线。</Text><Text>探索主线用于串联独立行动与复盘事实，形成一段长期行动历程。</Text></View> : <><View className='exploration-track-list'>{visibleTracks.map((entry) => <View key={entry.track.id} className={`exploration-track-row ${selectedId === entry.track.id ? 'active' : ''}`} onClick={() => setSelectedId(entry.track.id)}><Text className='exploration-row-name'>{entry.track.name}</Text><Text className='exploration-row-recent'>{entry.latestAssociatedItem ? `最近：${entry.latestAssociatedItem.title} · ${statusLabels[entry.latestAssociatedItem.status] ?? entry.latestAssociatedItem.status}` : '暂无关联行动'}</Text></View>)}</View>{listPageCount > 1 && <View className='exploration-list-pagination'><Button className={`exploration-inline-button ${listPage === 1 ? 'is-disabled' : ''}`} disabled={listPage === 1} onClick={() => { if (listPage > 1) changeListPage(listPage - 1) }}>上一页</Button><Text>{listPage} / {listPageCount}</Text><Button className={`exploration-inline-button ${listPage === listPageCount ? 'is-disabled' : ''}`} disabled={listPage === listPageCount} onClick={() => { if (listPage < listPageCount) changeListPage(listPage + 1) }}>下一页</Button></View>}</>}
      </View>
      <View className='exploration-detail-panel'>
        {detailLoading && !history ? <View className='exploration-state'><Text>正在载入探索历史…</Text></View> : !history && listState === 'error' ? <View className='exploration-state'><Text>暂时无法载入探索主线与探索历史。</Text></View> : !history ? <View className='exploration-state'><Text>选择一条探索主线，查看它串联的独立行动与复盘事实。</Text></View> : <View className='exploration-detail'>
          <View className='exploration-detail-heading'><View>{editing ? <View ref={editingAreaRef} className='exploration-edit'><Input value={renameName} onInput={(event) => setRenameName(event.detail.value)} /><Button className='primary-button' disabled={creating || unknownOutcome} onClick={saveEditingTrack}>保存</Button></View> : <Text className='exploration-detail-title'>{history.track.name}</Text>}</View>{!editing && <View className='exploration-manage'><Button className='exploration-inline-button' disabled={unknownOutcome} onClick={beginEditingTrack}>改名</Button><Button className='exploration-inline-button' disabled={unknownOutcome} onClick={() => setConfirmDelete(true)}>删除主线</Button></View>}</View>
          {detailLoading && <Text className='exploration-refreshing'>正在更新…</Text>}
          <Text className='exploration-description'>由独立行动与复盘组成；不代表计划或完成进度。</Text>
          <View className='exploration-section'><Text className='exploration-section-title'>当前关联事项</Text>{history.currentAssociatedItems.every((group) => group.items.length === 0) ? <Text className='exploration-empty-copy'>还没有关联行动。</Text> : currentStatuses.map((status) => { const group = history.currentAssociatedItems.find((value) => value.status === status); return group?.items.length ? <View key={status} className='exploration-current-group'><Text className='exploration-group-title'>{statusLabels[status]}</Text>{group.items.map((item) => <TrackItem key={item.item.id} item={item} onOpen={onOpenItem} />)}{group.hasMore && group.moreLocator && <Button className='exploration-inline-button' onClick={() => apiClient.listItemsByExplorationTrackAndStatus(group.moreLocator!.explorationTrackId, group.moreLocator!.status).then((items) => onOpenItems(group.moreLocator!.status, items)).catch((cause) => setError(messageOf(cause, '暂时无法载入该状态下的事项。')))}>查看该状态下的事项</Button>}</View> : null })}</View>
          <View className='exploration-section exploration-capture'><Text className='exploration-section-title'>在「{history.track.name}」下记下想做的事</Text><View className='item-title-input-wrap'><Input className='exploration-capture-input' value={draft} onInput={(event) => { const next = event.detail.value; if (acceptsItemTitleInput(next)) { setDraft(next); setDraftTitleLimitReached(false) } else setDraftTitleLimitReached(true) }} placeholder='例如：预约一次线下二胡体验课' disabled={creating} /><Text className='item-title-counter'>{itemTitleGraphemeCount(draft)}/{ITEM_TITLE_MAX_GRAPHEMES}</Text></View>{draftTitleLimitReached && <Text className='item-title-limit-notice'>标题最多20个字符</Text>}<View className='exploration-capture-actions'><Button className='primary-button' disabled={creating || unknownOutcome || !draft.trim()} onClick={() => capture(false)}>加入想试试</Button><Button className='secondary-button' disabled={creating || unknownOutcome || !draft.trim()} onClick={() => capture(true)}>加入以后再说</Button></View></View>
          <View className='exploration-section'><View className='exploration-history-heading'><Text className='exploration-section-title'>{historyView === 'history' ? '探索历史' : '已放弃记录'}</Text>{history.abandonedHistory.length > 0 && <Button className='exploration-inline-button exploration-history-toggle' onClick={() => setHistoryView((view) => view === 'history' ? 'abandoned' : 'history')}>{historyView === 'history' ? '查看已放弃记录' : '查看探索历史'}</Button>}</View>{visibleHistory?.length ? visibleHistory.map((item) => <TrackItem key={item.item.id} item={item} onOpen={onOpenItem} />) : <Text className='exploration-empty-copy'>{historyView === 'history' ? '当前还没有可回看的探索历史。' : '当前还没有已放弃记录。'}</Text>}</View>
        </View>}
      </View>
    </View>
    {confirmDelete && <View className='exploration-confirm-backdrop' onClick={() => setConfirmDelete(false)}><View className='exploration-confirm' role='dialog' aria-label='删除主线确认' onClick={(event) => event.stopPropagation()}><Text>删除主线？关联事项、复盘和历史事实不会被删除或解除关联。</Text><View><Button className='secondary-button' disabled={creating} onClick={() => setConfirmDelete(false)}>取消</Button><Button className='primary-button' disabled={creating || unknownOutcome} onClick={remove}>删除主线</Button></View></View></View>}
    {createDialogOpen && <View className='capture-modal-backdrop exploration-create-modal-backdrop'><View className='capture-modal' role='dialog' aria-label='新建探索主线'><View className='capture-modal-heading'><View><Text className='section-kicker'>新建探索主线</Text><Text>为一段长期行动历程命名</Text></View></View><Input className='capture-modal-input' value={newName} onInput={(event) => setNewName(event.detail.value)} placeholder='例如：练习二胡' disabled={creating} /><View className='capture-actions'><Button className='secondary-button' disabled={creating} onClick={() => setCreateDialogOpen(false)}>取消</Button><Button className='primary-button' disabled={creating || unknownOutcome || !newName.trim()} onClick={createTrack}>新建</Button></View></View></View>}
  </View></ItemUpdatedAtContext.Provider>
}
