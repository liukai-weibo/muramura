import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { AuthSession, DailyNote, Item, ItemStatus } from '@knowledge-base/contracts'
import { apiClient, actionsFor, type ApiClientError } from '../index/api-client'
import { notifyDailyNoteChanged } from '../index/daily-note-sync'
import './index.scss'

type MobileTab = 'notes' | 'items'
type NoteSaveState = 'loading' | 'saved' | 'saving' | 'error'
type ItemFilter = 'doing' | 'reviewed'

const statusLabels: Record<ItemStatus, string> = {
  idea_to_try: '历史状态', idea_later: '历史状态', doing: '进行中', paused: '历史状态',
  waiting_review: '历史状态', reviewed: '已复盘', archived_no_review: '历史状态', abandoned: '历史状态',
}
const statusFilters: Array<{ label: string; value: ItemFilter }> = [
  { label: '进行中', value: 'doing' },
  { label: '已复盘', value: 'reviewed' },
]
const shanghaiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const formatNoteDate = (date: string) => date === shanghaiDate() ? '今天' : date
const formatHistoryDate = (date: string) => date === shanghaiDate() ? '今天' : `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function errorMessage(error: unknown, fallback: string): string {
  const status = (error as ApiClientError)?.status
  if (status === 401) return '登录状态已失效，请重新登录。'
  return error instanceof Error && error.message ? error.message : fallback
}

function MobileLogin({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (busy || !username.trim() || password.length < 8) return
    setBusy(true); setError('')
    try { onAuthenticated(await apiClient.login({ username: username.trim(), password })) }
    catch (cause) { setError(errorMessage(cause, '登录失败，请检查账号和密码。')) }
    finally { setBusy(false) }
  }
  return <View className='mobile-auth-shell'>
    <View className='mobile-auth-card'>
      <Text className='mobile-brand'>MaruMaru</Text>
      <Text className='mobile-auth-title'>进入手记与事项</Text>
      <Text className='mobile-auth-copy'>登录后访问当前账户的个人数据。</Text>
      <Input className='mobile-auth-input' value={username} placeholder='用户名' onInput={event => setUsername(event.detail.value)} />
      <Input className='mobile-auth-input' value={password} password placeholder='密码（至少 8 位）' onInput={event => setPassword(event.detail.value)} onConfirm={() => void submit()} />
      {error && <Text className='mobile-error'>{error}</Text>}
      <Button className='mobile-primary-button' disabled={busy || !username.trim() || password.length < 8} onClick={() => void submit()}>{busy ? '正在登录…' : '登录'}</Button>
    </View>
  </View>
}

function MobileNotes() {
  const [notes, setNotes] = useState<DailyNote[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<NoteSaveState>('loading')
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickDraft, setQuickDraft] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickError, setQuickError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const draftRef = useRef('')
  const selectedRef = useRef<DailyNote>()
  const pendingRef = useRef(false)
  const generationRef = useRef(0)

  const flush = async () => {
    const selected = selectedRef.current
    if (!selected || !pendingRef.current) return true
    if (timer.current) clearTimeout(timer.current)
    setState('saving'); setError('')
    try {
      const saved = await apiClient.updateDailyNote(selected.id, draftRef.current)
      pendingRef.current = false
      setNotes(current => current.map(note => note.id === saved.id ? saved : note))
      selectedRef.current = saved
      setState('saved')
      notifyDailyNoteChanged()
      return true
    } catch (cause) { setState('error'); setError(errorMessage(cause, '自动保存失败，内容仍保留在编辑器中。')); return false }
  }

  const load = async (targetId?: string) => {
    const generation = ++generationRef.current
    setState('loading'); setError('')
    try {
      const [today, all] = await Promise.all([apiClient.getTodayDailyNote(), apiClient.listDailyNotes()])
      if (generation !== generationRef.current) return
      const merged = all.some(note => note.id === today.id) ? all : [today, ...all]
      const selected = merged.find(note => note.id === targetId) ?? merged.find(note => note.id === selectedId) ?? today
      setNotes(merged); setSelectedId(selected.id); setDraft(selected.content); draftRef.current = selected.content; selectedRef.current = selected; pendingRef.current = false; setState('saved')
    } catch (cause) { if (generation === generationRef.current) { setState('error'); setError(errorMessage(cause, '暂时无法读取手记。')) } }
  }
  useEffect(() => { void load() ; return () => { generationRef.current += 1; if (timer.current) clearTimeout(timer.current); void flush() } }, [])
  const selected = notes.find(note => note.id === selectedId)
  const edit = (value: string) => { setDraft(value); draftRef.current = value; pendingRef.current = true; setState('saving'); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 2000) }
  const choose = async (note: DailyNote) => { if (note.id === selectedId) { setHistoryOpen(false); return }; if (!(await flush())) return; ++generationRef.current; setSelectedId(note.id); setDraft(note.content); draftRef.current = note.content; selectedRef.current = note; pendingRef.current = false; setState('saved'); setHistoryOpen(false) }
  const saveQuickNote = async () => {
    const content = quickDraft.trim()
    if (!content || quickSaving) return
    setQuickSaving(true); setQuickError('')
    try {
      const saved = await apiClient.appendTodayDailyNote(content)
      setNotes(current => [saved, ...current.filter(note => note.id !== saved.id)])
      if (selectedRef.current?.id === saved.id) {
        setDraft(saved.content); draftRef.current = saved.content; selectedRef.current = saved; pendingRef.current = false; setState('saved')
      }
      notifyDailyNoteChanged()
      setQuickDraft(''); setQuickOpen(false)
    } catch (cause) { setQuickError(errorMessage(cause, '快速记录保存失败，内容仍保留在这里。')) }
    finally { setQuickSaving(false) }
  }
  const noteGroups = useMemo(() => notes.filter(note => note.id !== selectedId), [notes, selectedId])

  return <View className='mobile-notes'>
    <View className='mobile-section-heading'><View><Text className='mobile-section-title'>手记</Text><Text className='mobile-section-meta'>{selected ? formatNoteDate(selected.entryDate) : '正在读取'}</Text></View><View className='mobile-note-actions'><Button className='mobile-quiet-button' onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? '收起日期' : '日期历史'}</Button><Button className='mobile-primary-button mobile-small-button' onClick={() => { setQuickError(''); setQuickOpen(true) }}>快速记录</Button></View></View>
    {historyOpen && <View className='mobile-note-history'>{noteGroups.length === 0 ? <Text className='mobile-muted'>还没有其他日期的手记。</Text> : noteGroups.map(note => <Button key={note.id} className={`mobile-note-history-item ${note.id === selectedId ? 'active' : ''}`} onClick={() => void choose(note)}><Text>{formatHistoryDate(note.entryDate)}</Text></Button>)}</View>}
    {state === 'error' && <View className='mobile-inline-error'><Text>{error}</Text><Button className='mobile-link-button' onClick={() => void flush()}>重试保存</Button></View>}
    <View className='mobile-note-editor'><textarea className='mobile-note-textarea' value={draft} maxLength={100000} placeholder='记录今天真实发生的事…' onInput={event => edit(event.currentTarget.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key !== 'Tab') return; event.preventDefault(); event.stopPropagation(); const target = event.currentTarget; const start = target.selectionStart; const next = draftRef.current.slice(0, start) + '  ' + draftRef.current.slice(target.selectionEnd); edit(next); requestAnimationFrame(() => { target.selectionStart = start + 2; target.selectionEnd = start + 2 }) }} /></View>
    <View className='mobile-save-line'><Text>{state === 'loading' ? '正在读取…' : state === 'saving' ? '正在保存…' : state === 'error' ? '保存失败' : '已自动保存'}</Text></View>
    {quickOpen && <View className='mobile-modal-backdrop' onClick={() => { if (!quickSaving) setQuickOpen(false) }}><View className='mobile-modal' role='dialog' aria-label='快速记录' onClick={event => event.stopPropagation()}><Text className='mobile-modal-title'>快速记录</Text><Text className='mobile-modal-hint'>保存后会自动添加当前时间</Text><textarea autoFocus className='mobile-quick-input' value={quickDraft} maxLength={100000} placeholder='记下此刻想到的事…' onInput={event => { setQuickDraft(event.currentTarget.value); setQuickError('') }} />{quickError && <Text className='mobile-error'>{quickError}</Text>}<View className='mobile-modal-actions'><Button className='mobile-quiet-button' disabled={quickSaving} onClick={() => setQuickOpen(false)}>取消</Button><Button className='mobile-primary-button' disabled={quickSaving || !quickDraft.trim()} onClick={() => void saveQuickNote()}>{quickSaving ? '保存中…' : '保存'}</Button></View></View></View>}
  </View>
}

function MobileItems() {
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<ItemFilter>('doing')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string>()
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saveForLater, setSaveForLater] = useState(false)
  const refresh = async () => { setLoading(true); setError(''); try { setItems((await apiClient.listItems()).filter(item => !item.deletedAt).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) } catch (cause) { setError(errorMessage(cause, '暂时无法读取事项。')) } finally { setLoading(false) } }
  useEffect(() => { void refresh(); const onChanged = () => void refresh(); window.addEventListener('knowledge-base-items-changed', onChanged); return () => window.removeEventListener('knowledge-base-items-changed', onChanged) }, [])
  const visible = items.filter(item => item.status === filter)
  const create = async () => { if (!title.trim() || busyId) return; setBusyId('create'); setError(''); try { await apiClient.createIdea({ title: title.trim(), content: content.trim(), saveForLater }); setTitle(''); setContent(''); setSaveForLater(false); setCreateOpen(false); await refresh(); window.dispatchEvent(new CustomEvent('knowledge-base-items-changed')) } catch (cause) { setError(errorMessage(cause, '创建事项失败，请重试。')) } finally { setBusyId(undefined) } }
  const changeStatus = async (item: Item, action: { status: ItemStatus; label: string }) => { if (busyId) return; setBusyId(item.id); setError(''); try { if (action.status === 'doing' && item.status === 'idea_to_try') { const startAction = window.prompt('开始执行时，准备先做什么？', item.startAction ?? '') ; if (startAction === null) return; await apiClient.startExecution(item.id, { startAction: startAction.trim() || undefined }) } else await apiClient.changeStatus(item.id, action.status); await refresh() } catch (cause) { setError(errorMessage(cause, '状态更新失败，请重试。')) } finally { setBusyId(undefined) } }
  return <View className='mobile-items'>
    <View className='mobile-section-heading'><View><Text className='mobile-section-title'>事项</Text><Text className='mobile-section-meta'>{visible.length} 条</Text></View><Button className='mobile-primary-button mobile-small-button' onClick={() => setCreateOpen(true)}>新建事项</Button></View>
    <View className='mobile-filter-row'>{statusFilters.map(option => <Button key={option.value} className={filter === option.value ? 'active' : ''} onClick={() => setFilter(option.value)}>{option.label}</Button>)}</View>
    {error && <View className='mobile-inline-error'><Text>{error}</Text><Button className='mobile-link-button' onClick={() => void refresh()}>重试</Button></View>}
    {loading ? <Text className='mobile-muted'>正在读取事项…</Text> : visible.length === 0 ? <View className='mobile-empty'><Text>当前没有事项</Text><Text>把下一步写下来，之后再推进。</Text></View> : <View className='mobile-item-list'>{visible.map(item => <View className='mobile-item-card' key={item.id}><View className='mobile-item-card-heading'><Text className='mobile-item-title'>{item.title}</Text><Text className={`mobile-status mobile-status-${item.status}`}>{statusLabels[item.status]}</Text></View>{item.content && <Text className='mobile-item-content'>{item.content}</Text>}<Text className='mobile-item-time'>更新于 {formatTime(item.updatedAt)}</Text><View className='mobile-item-actions'>{actionsFor(item).filter(action => !['idea_later', 'paused'].includes(action.status) && !(action.status === 'abandoned' && (item.status === 'idea_to_try' || item.status === 'doing'))).map(action => <Button key={action.status} disabled={busyId === item.id} className={`mobile-action-button ${action.tone}`} onClick={() => void changeStatus(item, action)}>{action.label}</Button>)}</View></View>)}</View>}
    {createOpen && <View className='mobile-modal-backdrop' onClick={() => setCreateOpen(false)}><View className='mobile-modal' onClick={event => event.stopPropagation()}><Text className='mobile-modal-title'>新建事项</Text><Input className='mobile-auth-input' value={title} placeholder='事项标题' onInput={event => setTitle(event.detail.value)} /><Textarea className='mobile-create-content' value={content} maxlength={12000} placeholder='补充说明（可选）' onInput={event => setContent(event.detail.value)} /><View className='mobile-modal-actions'><Button className='mobile-quiet-button' onClick={() => setCreateOpen(false)}>取消</Button><Button className='mobile-primary-button' disabled={!title.trim() || busyId === 'create'} onClick={() => void create()}>{busyId === 'create' ? '创建中…' : '创建'}</Button></View></View></View>}
  </View>
}

export default function MobileIndex() {
  const [session, setSession] = useState<AuthSession>()
  const [sessionResolved, setSessionResolved] = useState(false)
  const [tab, setTab] = useState<MobileTab>('notes')
  useEffect(() => {
    const viewport = document.querySelector('meta[name="viewport"]')
    if (!viewport) return
    const original = viewport.getAttribute('content')
    viewport.setAttribute('content', `${original ?? 'width=device-width, initial-scale=1'}, maximum-scale=1, user-scalable=no`)
    return () => {
      if (original === null) viewport.removeAttribute('content')
      else viewport.setAttribute('content', original)
    }
  }, [])
  useEffect(() => { let active = true; void apiClient.getCurrentSession().then(current => { if (active) setSession(current) }).catch(() => undefined).finally(() => { if (active) setSessionResolved(true) }); return () => { active = false } }, [])
  if (!sessionResolved) return <View className='mobile-page mobile-loading'><Text>正在确认登录状态…</Text></View>
  if (!session) return <View className='mobile-page'><MobileLogin onAuthenticated={setSession} /></View>
  return <View className='mobile-page'><View className='mobile-topbar'><View><Text className='mobile-app-name'>MaruMaru</Text><Text className='mobile-user-name'>{session.user.username}</Text></View><Button className='mobile-quiet-button' onClick={() => void apiClient.logout().then(() => setSession(undefined)).catch(() => setSession(undefined))}>退出</Button></View><View className='mobile-content'>{tab === 'notes' ? <MobileNotes /> : <MobileItems />}</View><View className='mobile-tabbar'><Button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>手记</Button><Button className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')}>事项</Button></View></View>
}
