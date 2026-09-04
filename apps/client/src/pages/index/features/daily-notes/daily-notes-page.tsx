import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailyNote, Item } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { notifyDailyNoteChanged, subscribeDailyNoteChanged } from '../../daily-note-sync'
import { isTauriDesktop } from '../../../../desktop/desktop-native-bridge'
import { DailyNoteAiPanel } from './daily-note-ai-panel'

export interface DailyNotesPageProps { onFlushReady: (flush: () => Promise<boolean>) => void; onItemsChanged?: () => Promise<void>; onItemCreated?: (item: Item) => void }
const shanghaiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const visualDailyNoteEmojis = ['🌱', '☀️', '🌙', '🍵', '✨', '🌿', '🫧', '🪴', '📝', '🎈', '🌼', '🍀']
const dailyNoteStatusEmojiStorageKey = 'marumaru.daily-note-status-emoji'
const readDailyStatusEmoji = (date: string) => {
  try {
    const stored = window.localStorage.getItem(dailyNoteStatusEmojiStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as { date?: string; emoji?: string }
      if (parsed.date === date && parsed.emoji && visualDailyNoteEmojis.includes(parsed.emoji)) return parsed.emoji
    }
  } catch { /* Display preference is best effort. */ }
  const emoji = visualDailyNoteEmojis[Math.floor(Math.random() * visualDailyNoteEmojis.length)] ?? visualDailyNoteEmojis[0]!
  try { window.localStorage.setItem(dailyNoteStatusEmojiStorageKey, JSON.stringify({ date, emoji })) } catch { /* Display preference is best effort. */ }
  return emoji
}
const dailyNoteEmojis = ['🌱', '☀️', '🌙', '🍵', '✨', '🌿', '🫧', '🪴', '📝', '🎈', '🌼', '🍀']
const dailyNoteEmoji = (date: string) => {
  const hash = Array.from(date).reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 7)
  return dailyNoteEmojis[hash % dailyNoteEmojis.length]!
}

export function DailyNotesPage({ onFlushReady, onItemsChanged, onItemCreated }: DailyNotesPageProps) {
  const [notes, setNotes] = useState<DailyNote[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState(''); const [crossedDate, setCrossedDate] = useState<string>()
  const [dailyStatusEmoji, setDailyStatusEmoji] = useState(() => readDailyStatusEmoji(shanghaiDate()))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ recent: true, archive: true })
  const pending = useRef(false); const timer = useRef<ReturnType<typeof setTimeout>>(); const selected = useRef<DailyNote>(); const draftRef = useRef(''); const abortAiRef = useRef<() => void>(() => undefined); const handledKeyEvent = useRef<Event>()
  const registerAiAbort = useCallback((abort: () => void) => { abortAiRef.current = abort }, [])
  const current = notes.find(note => note.id === selectedId)
  useEffect(() => { selected.current = current }, [current]); useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => {
    const sync = () => setDailyStatusEmoji(readDailyStatusEmoji(shanghaiDate()))
    const id = window.setInterval(sync, 60_000)
    return () => window.clearInterval(id)
  }, [])
  const refresh = async () => { const [today, all] = await Promise.all([apiClient.getTodayDailyNote(), apiClient.listDailyNotes()]); setNotes(all.some(note => note.id === today.id) ? all : [today, ...all]); setSelectedId(id => id ?? today.id); if (!selectedId || selectedId === today.id) setDraft(today.content) }
  useEffect(() => { void refresh().catch(() => setSaveError('暂时无法读取小记，请检查网络后重试')) }, [])
  useEffect(() => {
    const syncExternalChange = () => {
      if (pending.current) return
      const selectedId = selected.current?.id
      if (!selectedId) return
      void apiClient.listDailyNotes().then(all => {
        const remote = all.find(note => note.id === selectedId)
        if (!remote || pending.current || selected.current?.id !== selectedId) return
        if (!remote.content.trim() && selected.current.content.trim()) return
        setNotes(all)
        setDraft(remote.content)
        draftRef.current = remote.content
      }).catch(() => undefined)
    }
    const stop = subscribeDailyNoteChanged(syncExternalChange)
    return () => stop()
  }, [])
  const flush = useCallback(async () => { if (!pending.current || !selected.current) return true; if (timer.current) clearTimeout(timer.current); setSaving(true); setSaveError(''); try { const saved = await apiClient.updateDailyNote(selected.current.id, draftRef.current); pending.current = false; setNotes(list => list.map(note => note.id === saved.id ? saved : note)); if (saved.content.trim()) notifyDailyNoteChanged(); return true } catch { setSaveError('自动保存失败，内容仍保留在当前编辑器中'); return false } finally { setSaving(false) } }, [])
  useEffect(() => { onFlushReady(flush); return () => { void flush() } }, [onFlushReady])
  useEffect(() => {
    if (!isTauriDesktop()) return
    let stopped = false; const unlistens: Array<() => void> = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stops = await Promise.all([listen('daily-note-window-hidden', () => { void flush() })])
      if (stopped) stops.forEach(stop => stop()); else unlistens.push(...stops)
    })
    return () => { stopped = true; unlistens.forEach(stop => stop()) }
  }, [])
  useEffect(() => { const check = () => { const today = shanghaiDate(); if (selected.current && selected.current.entryDate !== today) setCrossedDate(today) }; const id = window.setInterval(check, 60_000); document.addEventListener('visibilitychange', check); return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check) } }, [])
  const edit = (value: string) => { setDraft(value); draftRef.current = value; pending.current = true; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void flush() }, 2000) }
  const choose = async (note: DailyNote) => { abortAiRef.current(); if (!(await flush())) return; setSelectedId(note.id); setDraft(note.content) }
  const openToday = async () => { abortAiRef.current(); if (!(await flush())) return; const today = await apiClient.getTodayDailyNote(); setNotes(list => [today, ...list.filter(note => note.id !== today.id)]); setSelectedId(today.id); setDraft(today.content); setCrossedDate(undefined) }
  const appendAiResult = async (content: string) => { const next = draftRef.current.trim() ? `${draftRef.current}\n\n${content}` : content; draftRef.current = next; setDraft(next); pending.current = true; return flush() }
  const replaceAiResult = async (content: string) => { if (!window.confirm('替换会覆盖当前正文。是否继续？')) return false; draftRef.current = content; setDraft(content); pending.current = true; return flush() }
  const retrySave = () => { pending.current = true; void flush() }
  const exportNote = () => { const blob = new Blob([draftRef.current], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `daily-note-${current?.entryDate ?? shanghaiDate()}.md`; anchor.click(); URL.revokeObjectURL(url) }
  const clearNote = () => { if (!window.confirm('清空全文后会自动保存，是否继续？')) return; edit('') }
  const convertMarkdown = () => {
    const source = draftRef.current
    if (!source.trim() || !window.confirm('将整理当前正文的 Markdown 格式，不会删除内容。是否继续？')) return
    const lines: string[] = []
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line && lines[lines.length - 1] === '') continue
      lines.push(line)
    }
    while (lines[0] === '') lines.shift()
    while (lines[lines.length - 1] === '') lines.pop()
    const converted = lines.join('\n')
    if (converted !== source) edit(converted)
  }
  const handleTab = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handledKeyEvent.current === event.nativeEvent) return
    handledKeyEvent.current = event.nativeEvent
    if (event.nativeEvent.isComposing) return
    const target = event.currentTarget
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const start = target.selectionStart
      const end = target.selectionEnd
      const next = draftRef.current.slice(0, start) + '\n' + draftRef.current.slice(end)
      edit(next)
      requestAnimationFrame(() => { target.selectionStart = start + 1; target.selectionEnd = start + 1 })
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    const start = target.selectionStart; const end = target.selectionEnd; const before = draftRef.current.slice(0, start); const lineStart = before.lastIndexOf('\n') + 1; const lineEnd = draftRef.current.indexOf('\n', end); const actualEnd = lineEnd < 0 ? draftRef.current.length : lineEnd; const line = draftRef.current.slice(lineStart, actualEnd)
    const match = line.match(/^(\s*)(#{1,6} |[-*] |(\d+)\. )/)
    let replacement = '  '; let cursor = start + replacement.length
    if (match) { const marker = match[2]!; const nextMarker = marker.startsWith('#') ? marker : marker.startsWith('-') || marker.startsWith('*') ? marker : `${Number(match[3]) + 1}. `; replacement = `\n${match[1]}${nextMarker}`; cursor = start + replacement.length }
    const next = draftRef.current.slice(0, end) + replacement + draftRef.current.slice(end); edit(next); requestAnimationFrame(() => { target.selectionStart = cursor; target.selectionEnd = cursor })
  }
  const groups = useMemo(() => ({ today: notes.filter(note => note.entryDate === shanghaiDate()), yesterday: notes.filter(note => note.entryDate !== shanghaiDate()).slice(0, 1), recent: notes.filter(note => note.entryDate !== shanghaiDate()).slice(1, 7), archive: notes.filter(note => note.entryDate !== shanghaiDate()).slice(7) }), [notes])
  const groupsConfig: Array<[string, string, DailyNote[]]> = [['today', '今天', groups.today], ['yesterday', '昨日', groups.yesterday], ['recent', '近 7 天', groups.recent], ['archive', '归档笔记', groups.archive]]
  return <View className='daily-notes-page'>
    <View className='daily-notes-sidebar'>{groupsConfig.map(([key, label, entries]) => <View key={key} className='daily-note-group'><View className='daily-note-group-heading' onClick={() => setCollapsed(value => ({ ...value, [key]: !value[key] }))}><Text>{collapsed[key] ? '▸' : '▾'} {label}</Text></View>{!collapsed[key] && entries.map(note => <View key={note.id} className={`daily-note-entry card-transition ${note.id === selectedId ? 'active' : ''}`} onClick={() => void choose(note)}><Text className='daily-note-entry-emoji' aria-hidden='true'>{dailyNoteEmoji(note.entryDate)}</Text><View><Text>{note.entryDate}{!note.content.trim() && <Text className='daily-note-empty-dot' aria-label='未记录' />}</Text><Text>{note.content.trim().slice(0, 20) || '空白小记'}</Text></View></View>)}</View>)}</View>
    <View className='daily-notes-editor'>{crossedDate && <View className='daily-note-crossday'><Text>已跨入新的一天（{crossedDate}）</Text><Button className='control-transition' onClick={() => void openToday()}>开启今日新小记</Button></View>}<View className='daily-note-editor-header'><View><View className='daily-note-save-state'>{saving ? <Text className='is-saving'>保存中</Text> : saveError ? <><Text className='is-save-error'>保存失败</Text><Button className='control-transition' onClick={retrySave}>重试</Button></> : <><Text className='daily-note-save-emoji' aria-hidden='true'>{dailyStatusEmoji}</Text><Text>已自动保存</Text></>}</View></View><View className='daily-note-editor-actions'><Button className='control-transition' onClick={exportNote}>导出记录</Button><Button className='control-transition' onClick={clearNote}>清空全文</Button><Button className='control-transition' onClick={convertMarkdown}>Markdown 转换</Button></View></View><textarea className='daily-note-textarea' value={draft} maxLength={100000} placeholder='写下今天真实发生的事...' onInput={event => edit(event.currentTarget.value)} onKeyDown={handleTab} /></View>
    <DailyNoteAiPanel note={current} draft={draft} onAppend={appendAiResult} onReplace={replaceAiResult} onAbortReady={registerAiAbort} onItemsChanged={onItemsChanged} onItemCreated={onItemCreated} />
  </View>
}
