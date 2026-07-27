import { Button, Input, Text, View } from '@tarojs/components'
import type { CurrentAssociatedStatus, ExplorationTrackHistory, ExplorationTrackItem, ExplorationTrackListEntry, ItemLocator } from '@knowledge-base/contracts'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { apiClient, isApiClientAbort, isApiClientUnknownOutcome } from './api-client'
import { captureDraftAfterWrite, explorationListReadState, isCurrentExplorationRequest, mayUnlockUnknownOutcome, truncateDisplayName } from './exploration-session-state'

const statusLabels: Record<string, string> = {
  doing: '已开始', idea_to_try: '想试试', idea_later: '以后再说', paused: '已暂停', reviewed: '已复盘', abandoned: '已放弃',
}
const currentStatuses: CurrentAssociatedStatus[] = ['doing', 'idea_to_try', 'idea_later', 'paused']
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const formatItemTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const ItemUpdatedAtContext = createContext<ReadonlyMap<string, string>>(new Map())

function TruncatedDisplayName({ className, value, maxWidthRatio = 1 }: { className: string; value: string; maxWidthRatio?: number }) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    const update = () => {
      const element = elementRef.current
      if (!element || typeof window === 'undefined') return
      const style = window.getComputedStyle(element)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const parentWidth = element.parentElement?.getBoundingClientRect().width ?? element.getBoundingClientRect().width
      const next = truncateDisplayName(value, parentWidth * maxWidthRatio, (text) => context.measureText(text).width)
      setDisplayValue((current) => current === next ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    if (elementRef.current) observer.observe(elementRef.current.parentElement ?? elementRef.current)
    return () => observer.disconnect()
  }, [maxWidthRatio, value])

  return <View ref={elementRef} className={className}>{displayValue}</View>
}

function Summary({ item }: { item: ExplorationTrackItem }) {
  if (item.reviewSummaryStatus !== 'available' || !item.reviewSummary) return <Text className='exploration-review-summary'>复盘详情请在事项中查看。</Text>
  const value = [item.reviewSummary.actualAction, item.reviewSummary.result].filter(Boolean).join('；')
  return value ? <Text className='exploration-review-summary'>{value}</Text> : <Text className='exploration-review-summary'>复盘详情请在事项中查看。</Text>
}

function TrackItem({ item, onOpen }: { item: ExplorationTrackItem; onOpen: (locator: ItemLocator) => void }) {
  const itemUpdatedAtById = useContext(ItemUpdatedAtContext)
  const updatedAt = itemUpdatedAtById.get(item.item.id)
  return <View className='exploration-track-item'>
    <View className='exploration-track-item-heading'>
      <View className='exploration-track-item-copy'><View className='exploration-track-item-title-row'><TruncatedDisplayName className='exploration-track-item-title' value={item.item.title} maxWidthRatio={0.25} /><Text className={`exploration-status exploration-status-${item.item.status}`}>{statusLabels[item.item.status] ?? item.item.status}</Text><Text className='exploration-track-item-time'>创建 {formatItemTime(item.item.createdAt)}{updatedAt ? ` · 更新 ${formatItemTime(updatedAt)}` : ''}</Text><Button className='exploration-inline-button exploration-track-item-open' onClick={() => onOpen(item.locator)}>查看</Button></View>{item.item.startAction && <Text className='exploration-track-item-meta'>开始时准备：{item.item.startAction}</Text>}</View>
    </View>
    {item.item.status === 'paused' && <Text className='exploration-track-item-meta exploration-paused-meta'>当前暂时停止投入</Text>}
    {(item.item.status === 'reviewed' || item.item.status === 'abandoned') && <Summary item={item} />}
  </View>
}

export function ExplorationPrototype({ onItemsChanged, onOpenItem, onOpenItems, itemUpdatedAtById }: { onItemsChanged: () => Promise<void>; onOpenItem: (locator: ItemLocator) => void; onOpenItems: (status: CurrentAssociatedStatus, items: import('@knowledge-base/contracts').Item[]) => void; itemUpdatedAtById: ReadonlyMap<string, string> }) {
  const [tracks, setTracks] = useState<ExplorationTrackListEntry[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [history, setHistory] = useState<ExplorationTrackHistory>()
  const [showDeleted, setShowDeleted] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [listReadSucceeded, setListReadSucceeded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [abandonedOpen, setAbandonedOpen] = useState(false)
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const listAbort = useRef<AbortController>()
  const detailAbort = useRef<AbortController>()

  const loadList = async (deleted = showDeleted, preferredId?: string): Promise<boolean> => {
    listAbort.current?.abort()
    const controller = new AbortController(); listAbort.current = controller
    const requestId = ++listRequest.current
    setListLoading(true); setError('')
    try {
      const next = deleted ? await apiClient.listDeletedExplorationTracks(controller.signal) : await apiClient.listExplorationTracks(controller.signal)
      if (!isCurrentExplorationRequest(requestId, listRequest.current)) return false
      const normalized = deleted ? next.map((entry) => ({ track: entry.track })) : next
      setTracks(normalized)
      setListReadSucceeded(true)
      const nextId = preferredId && normalized.some((entry) => entry.track.id === preferredId) ? preferredId : normalized[0]?.track.id
      setSelectedId(nextId)
      if (!nextId) setHistory(undefined)
      return true
    } catch (cause) {
      if (!isApiClientAbort(cause) && isCurrentExplorationRequest(requestId, listRequest.current)) setError(messageOf(cause, '暂时无法载入探索主线。'))
      return false
    } finally { if (isCurrentExplorationRequest(requestId, listRequest.current)) setListLoading(false) }
  }

  const loadHistory = async (id: string): Promise<boolean> => {
    detailAbort.current?.abort()
    const controller = new AbortController(); detailAbort.current = controller
    const requestId = ++detailRequest.current
    setDetailLoading(true); setError('')
    try {
      const next = await apiClient.getExplorationTrackHistory(id, controller.signal)
      if (isCurrentExplorationRequest(requestId, detailRequest.current)) { setHistory(next); return true }
      return false
    } catch (cause) {
      if (!isApiClientAbort(cause) && isCurrentExplorationRequest(requestId, detailRequest.current)) setError(messageOf(cause, '暂时无法载入探索历史。'))
      return false
    } finally { if (isCurrentExplorationRequest(requestId, detailRequest.current)) setDetailLoading(false) }
  }

  useEffect(() => { void loadList(false); return () => { listAbort.current?.abort(); detailAbort.current?.abort() } }, [])
  useEffect(() => { if (selectedId) void loadHistory(selectedId) }, [selectedId])

  const selectMode = (deleted: boolean) => { setShowDeleted(deleted); setTracks([]); setListReadSucceeded(false); setHistory(undefined); setAbandonedOpen(false); void loadList(deleted) }
  const confirmRealFacts = async () => {
    const listConfirmed = await loadList(showDeleted, selectedId)
    const historyConfirmed = selectedId ? await loadHistory(selectedId) : true
    if (mayUnlockUnknownOutcome([listConfirmed, historyConfirmed])) setUnknownOutcome(false)
  }
  const preserveUnknownOutcome = (cause: unknown, fallback: string) => {
    if (isApiClientUnknownOutcome(cause)) { setUnknownOutcome(true); setError('提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。'); return }
    setError(messageOf(cause, fallback))
  }
  const createTrack = async () => {
    if (!newName.trim()) { setError('主线名称不能为空'); return }
    setCreating(true); setError('')
    try { const track = await apiClient.createExplorationTrack(newName); setNewName(''); setCreateDialogOpen(false); await loadList(false, track.id) }
    catch (cause) { preserveUnknownOutcome(cause, '创建未完成，请重试。') }
    finally { setCreating(false) }
  }
  const capture = async (saveForLater: boolean) => {
    if (!history || !draft.trim()) return
    setCreating(true); setError('')
    try {
      try { await apiClient.createIdea({ title: draft, saveForLater, explorationTrack: { type: 'existing', trackId: history.track.id } }) }
      catch (cause) { setDraft(captureDraftAfterWrite(draft, false)); preserveUnknownOutcome(cause, '创建未完成，请重试。'); return }
      try { setDraft(captureDraftAfterWrite(draft, true)); await loadList(false, history.track.id); await loadHistory(history.track.id); await onItemsChanged() }
      catch (cause) { setError(messageOf(cause, '事项已创建，但暂时无法刷新行动事项。')) }
    } finally { setCreating(false) }
  }
  const rename = async () => {
    if (!history || !renameName.trim()) { setError('主线名称不能为空'); return }
    setCreating(true); setError('')
    try { await apiClient.renameExplorationTrack(history.track.id, renameName); setEditing(false); await loadList(false, history.track.id) }
    catch (cause) { preserveUnknownOutcome(cause, '改名未完成，请重试。') }
    finally { setCreating(false) }
  }
  const remove = async () => {
    if (!history) return
    setCreating(true); setError('')
    try { await apiClient.deleteExplorationTrack(history.track.id); setConfirmDelete(false); await loadList(false) }
    catch (cause) { preserveUnknownOutcome(cause, '删除主线未完成，请重试。') }
    finally { setCreating(false) }
  }
  const restore = async () => {
    if (!history) return
    setCreating(true); setError('')
    try { const track = await apiClient.restoreExplorationTrack(history.track.id); setConfirmRestore(false); setShowDeleted(false); await loadList(false, track.id) }
    catch (cause) { preserveUnknownOutcome(cause, '恢复未完成，请重试。') }
    finally { setCreating(false) }
  }

  const deleted = history?.lifecycle === 'deleted'
  const listState = explorationListReadState({ loading: listLoading, hasSucceeded: listReadSucceeded, hasEntries: tracks.length > 0 })
  return <ItemUpdatedAtContext.Provider value={itemUpdatedAtById}><View className='exploration-prototype module-panel'>
    <View className='exploration-prototype-header'><View><Text className='section-kicker'>探索主线</Text><Text className='exploration-prototype-title'>让独立行动形成可回看的过程</Text><Text className='module-description'>主线、关联事项与历史均来自本地 loopback API。</Text></View>
      {!showDeleted && <Button className='primary-button exploration-create-trigger' disabled={creating || unknownOutcome} onClick={() => setCreateDialogOpen(true)}>新建探索主线</Button>}</View>
    {error && <View className='exploration-notice' role='status'><Text>{error}</Text><Button className='exploration-inline-button' onClick={() => void (unknownOutcome ? confirmRealFacts() : selectedId ? loadHistory(selectedId) : loadList(showDeleted))}>{unknownOutcome ? '重新读取真实数据' : '重试'}</Button></View>}
    <View className='exploration-workspace'>
      <View className='exploration-list-panel'>
        <View className='exploration-list-heading'><View><Text className='section-kicker'>{showDeleted ? '已删除主线' : '探索主线'}</Text><Text>{showDeleted ? '只读回看' : '定位一段长期行动历程'}</Text></View>{listLoading && listReadSucceeded && <Text className='exploration-refreshing'>正在更新…</Text>}</View>
        {listState === 'loading' ? <Text className='exploration-state'>正在载入探索主线…</Text> : listState === 'error' ? <View className='exploration-state'><Text>暂时无法载入探索主线。</Text></View> : listState === 'empty' ? <View className='exploration-empty'><Text>{showDeleted ? '还没有已删除主线。' : '还没有探索主线。'}</Text>{!showDeleted && <Text>探索主线用于串联独立行动与复盘事实，形成一段长期行动历程。</Text>}</View> : <View className='exploration-track-list'>{tracks.map((entry) => <View key={entry.track.id} className={`exploration-track-row ${selectedId === entry.track.id ? 'active' : ''}`} onClick={() => setSelectedId(entry.track.id)}><TruncatedDisplayName className='exploration-row-name' value={entry.track.name} />{!showDeleted && <Text className='exploration-row-recent'>{entry.latestAssociatedItem ? `最近：${entry.latestAssociatedItem.title} · ${statusLabels[entry.latestAssociatedItem.status] ?? entry.latestAssociatedItem.status}` : '暂无关联行动'}</Text>}</View>)}</View>}
        <View className='exploration-deleted-entry' onClick={() => selectMode(!showDeleted)}><Text>{showDeleted ? '← 返回活跃主线' : '已删除主线'}</Text></View>
      </View>
      <View className='exploration-detail-panel'>
        {detailLoading && !history ? <View className='exploration-state'><Text>正在载入探索历史…</Text></View> : !history && listState === 'error' ? <View className='exploration-state'><Text>暂时无法载入探索主线与探索历史。</Text></View> : !history ? <View className='exploration-state'><Text>{showDeleted ? '选择一条已删除主线，查看保留的历史事实。' : '选择一条探索主线，查看它串联的独立行动与复盘事实。'}</Text></View> : <View className={`exploration-detail ${deleted ? 'deleted' : ''}`}>
          <View className='exploration-detail-heading'><View>{editing ? <View className='exploration-edit'><Input value={renameName} onInput={(event) => setRenameName(event.detail.value)} /><Button className='primary-button' disabled={creating || unknownOutcome} onClick={rename}>保存</Button><Button className='exploration-inline-button' disabled={creating} onClick={() => setEditing(false)}>取消</Button></View> : <><Text className='exploration-detail-title'>{history.track.name}</Text>{deleted && <Text className='exploration-deleted-label'>已删除主线 · 只读</Text>}</>}</View>{!deleted && !editing && <View className='exploration-manage'><Button className='exploration-inline-button' disabled={unknownOutcome} onClick={() => { setRenameName(history.track.name); setEditing(true) }}>改名</Button><Button className='exploration-inline-button' disabled={unknownOutcome} onClick={() => setConfirmDelete(true)}>删除主线</Button></View>}</View>
          {detailLoading && <Text className='exploration-refreshing'>正在更新…</Text>}
          <Text className='exploration-description'>{deleted ? '此主线处于已删除状态，仅保留历史事实供回看。' : '由独立行动与复盘组成；不代表计划或完成进度。'}</Text>
          <View className='exploration-section'><Text className='exploration-section-title'>当前关联事项</Text>{history.currentAssociatedItems.every((group) => group.items.length === 0) ? <Text className='exploration-empty-copy'>还没有关联行动。</Text> : currentStatuses.map((status) => { const group = history.currentAssociatedItems.find((value) => value.status === status); return group?.items.length ? <View key={status} className='exploration-current-group'><Text className='exploration-group-title'>{statusLabels[status]}</Text>{group.items.map((item) => <TrackItem key={item.item.id} item={item} onOpen={onOpenItem} />)}{group.hasMore && group.moreLocator && <Button className='exploration-inline-button' onClick={() => apiClient.listItemsByExplorationTrackAndStatus(group.moreLocator!.explorationTrackId, group.moreLocator!.status).then((items) => onOpenItems(group.moreLocator!.status, items)).catch((cause) => setError(messageOf(cause, '暂时无法载入该状态下的事项。')))}>查看该状态下的事项</Button>}</View> : null })}</View>
          {!deleted && <View className='exploration-section exploration-capture'><Text className='exploration-section-title'>在「{history.track.name}」下记下想做的事</Text><Input className='exploration-capture-input' value={draft} onInput={(event) => setDraft(event.detail.value)} placeholder='例如：预约一次线下二胡体验课' disabled={creating} /><View className='exploration-capture-actions'><Button className='primary-button' disabled={creating || unknownOutcome || !draft.trim()} onClick={() => capture(false)}>加入想试试</Button><Button className='secondary-button' disabled={creating || unknownOutcome || !draft.trim()} onClick={() => capture(true)}>加入以后再说</Button></View></View>}
          <View className='exploration-section'><Text className='exploration-section-title'>探索历史</Text>{history.history.length ? history.history.map((item) => <TrackItem key={item.item.id} item={item} onOpen={onOpenItem} />) : <Text className='exploration-empty-copy'>当前还没有可回看的探索历史。</Text>}</View>
          {history.abandonedHistory.length > 0 && <View className='exploration-section exploration-abandoned'><View className='exploration-collapse' onClick={() => setAbandonedOpen((open) => !open)}><Text>查看已放弃记录 {abandonedOpen ? '▴' : '▾'}</Text></View>{abandonedOpen && history.abandonedHistory.map((item) => <TrackItem key={item.item.id} item={item} onOpen={onOpenItem} />)}</View>}
          {deleted && <Button className='primary-button exploration-restore' disabled={creating || unknownOutcome} onClick={() => setConfirmRestore(true)}>恢复</Button>}
        </View>}
      </View>
    </View>
    {confirmDelete && <View className='exploration-confirm'><Text>删除主线？关联事项、复盘和历史事实不会被删除或解除关联。</Text><View><Button className='secondary-button' disabled={creating} onClick={() => setConfirmDelete(false)}>取消</Button><Button className='primary-button' disabled={creating || unknownOutcome} onClick={remove}>删除主线</Button></View></View>}
    {confirmRestore && <View className='exploration-confirm'><Text>恢复探索主线？恢复后，仍关联这条主线的事项会重新在主线历史中可见。</Text><View><Button className='secondary-button' disabled={creating} onClick={() => setConfirmRestore(false)}>取消</Button><Button className='primary-button' disabled={creating || unknownOutcome} onClick={restore}>恢复</Button></View></View>}
    {createDialogOpen && !showDeleted && <View className='capture-modal-backdrop exploration-create-modal-backdrop'><View className='capture-modal' role='dialog' aria-label='新建探索主线'><View className='capture-modal-heading'><View><Text className='section-kicker'>新建探索主线</Text><Text>为一段长期行动历程命名</Text></View></View><Input className='capture-modal-input' value={newName} onInput={(event) => setNewName(event.detail.value)} placeholder='例如：练习二胡' disabled={creating} /><View className='capture-actions'><Button className='secondary-button' disabled={creating} onClick={() => setCreateDialogOpen(false)}>取消</Button><Button className='primary-button' disabled={creating || unknownOutcome || !newName.trim()} onClick={createTrack}>新建</Button></View></View></View>}
  </View></ItemUpdatedAtContext.Provider>
}
