import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailyNote } from '@knowledge-base/contracts'
import { dailyNoteClock } from '@knowledge-base/contracts'
import { DAILY_NOTE_PAGE_ORIGIN, subscribeDailyNoteChanged } from '../../daily-note-sync'
import { isTauriDesktop } from '../../../../desktop/desktop-native-bridge'
import { EntryTextView } from './entry-text-view'
import { EntryTimelineView } from './entry-timeline-view'
import { useDailyNoteEntries } from './use-daily-note-entries'
import { shanghaiDate, shanghaiDateOffset } from './daily-note-date'
import { WeatherWidget } from './weather/weather-widget'
import { WeatherCityDialog } from './weather/weather-city-dialog'
import { useWeather } from './weather/use-weather'

/** 右侧 AI 复盘面板已隐藏，宽度让给时间轴；面板组件本身保留，随时能接回来。 */
export interface DailyNotesPageProps { onFlushReady: (flush: () => Promise<boolean>) => void }

type NoteView = 'text' | 'timeline'
/** v2：默认改成时间轴，旧键里残留的「文本」偏好不会把用户钉在文本视图。 */
const viewStorageKey = 'marumaru.daily-note-view.v2'
const readView = (): NoteView => {
  try { return window.localStorage.getItem(viewStorageKey) === 'text' ? 'text' : 'timeline' } catch { return 'timeline' }
}

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

export function DailyNotesPage({ onFlushReady }: DailyNotesPageProps) {
  const controller = useDailyNoteEntries()
  const {
    notes, current, selectedId, noteDate, entries, rows, loading, saveState, saveError, notice, dirty,
    setNotice, selectNote, openByDate, openToday, reloadNote, refreshList,
    setRowContent, setRowTime, insertRowAfter, removeRow, flushRow, flush,
    createEntryAt, moveEntry, clearAll,
  } = controller

  const [view, setView] = useState<NoteView>(readView)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const weather = useWeather()
  const [focusEntryId, setFocusEntryId] = useState<string>()
  const [activeEntryId, setActiveEntryId] = useState<string>()
  const [dailyStatusEmoji, setDailyStatusEmoji] = useState(() => readDailyStatusEmoji(shanghaiDate()))
  // 侧栏是回到旧日子的唯一入口（另有「补记」直接跳日期），所以「近 7 天」默认展开，
  // 只把更早的归档收起来。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ archive: true })
  const [crossedDate, setCrossedDate] = useState<string>()
  const selected = useRef<DailyNote>()
  const dirtyRef = useRef(false)
  const selectedIdRef = useRef<string>()
  useEffect(() => { selected.current = current }, [current])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  useEffect(() => {
    const sync = () => setDailyStatusEmoji(readDailyStatusEmoji(shanghaiDate()))
    const id = window.setInterval(sync, 60_000)
    return () => window.clearInterval(id)
  }, [])

  // 只跟进「别处」的写入（手机端、首页快捷追加、其他窗口）。自己保存产生的通知带同源标记，
  // 订阅时按标记过滤掉；否则每保存一次就会整篇重建，正在打字的行被换掉、光标掉到 body。
  useEffect(() => {
    const syncExternalChange = () => {
      if (dirtyRef.current) return
      // 光标正在手记里时不打断输入，切走或下一次进入时会重新对齐。
      const active = document.activeElement
      if (active && active.closest?.('.daily-note-text-view, .daily-note-time-popover, .daily-note-timeline-composer')) return
      const id = selectedIdRef.current
      if (!id) return
      void refreshList()
        .then(() => reloadNote(id))
        .catch(() => undefined)
    }
    return subscribeDailyNoteChanged(syncExternalChange, DAILY_NOTE_PAGE_ORIGIN)
  }, [refreshList, reloadNote])

  // 父组件传进来的是内联箭头函数，identity 每次重渲染都会变；若写进依赖，
  // effect 会反复重跑并用 cleanup 里的 flush 关掉正在编辑的行。注册只做一次。
  const onFlushReadyRef = useRef(onFlushReady)
  useEffect(() => { onFlushReadyRef.current = onFlushReady })
  useEffect(() => { onFlushReadyRef.current(flush) }, [flush])

  useEffect(() => {
    if (!isTauriDesktop()) return
    let stopped = false; const unlistens: Array<() => void> = []
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stops = await Promise.all([listen('daily-note-window-hidden', () => { void flush() })])
      if (stopped) stops.forEach(stop => stop()); else unlistens.push(...stops)
    })
    return () => { stopped = true; unlistens.forEach(stop => stop()) }
  }, [flush])

  useEffect(() => {
    const check = () => {
      const today = shanghaiDate()
      if (selected.current && selected.current.entryDate !== today) setCrossedDate(today)
    }
    const id = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check) }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])

  const switchView = async (next: NoteView) => {
    if (next === view) return
    if (!(await flush())) return
    setView(next)
    try { window.localStorage.setItem(viewStorageKey, next) } catch { /* 记住视图偏好失败不影响使用 */ }
    // 两个视图共用一份条目：切换时按服务端结果重建文本行，
    // 否则在时间轴上补录／拖拽后的改动不会出现在文本视图里。
    if (selectedId) await reloadNote(selectedId)
    if (next === 'timeline') setFocusEntryId(undefined)
  }

  const choose = async (note: DailyNote) => {
    setFocusEntryId(undefined)
    setActiveEntryId(undefined)
    if (!(await selectNote(note.id))) return
    setCrossedDate(undefined)
  }

  const goToday = async () => {
    if (!(await openToday())) return
    setCrossedDate(undefined)
    setFocusEntryId(undefined)
  }

  /** 回车拆行：前半段留在原行，后半段成为新的一条，两条共用同一个时间。 */
  const handleSplit = (key: string, before: string, after: string) => {
    // 新行直接带后半段内容，不必再写一次，否则空行会被标成「待保存」闪一下。
    const created = insertRowAfter(key, { content: after })
    setRowContent(key, before)
    return created
  }

  /** 退格到行首：并进上一行，当前行（如果在服务端存在）被删掉。 */
  const handleMerge = (key: string) => {
    const index = rows.findIndex(row => row.key === key)
    if (index <= 0) return undefined
    const previous = rows[index - 1]!
    const row = rows[index]!
    const separator = previous.content && !previous.content.endsWith('\n') ? '\n' : ''
    const merged = `${previous.content}${separator}${row.content}`
    setRowContent(previous.key, merged)
    void removeRow(key)
    return { key: previous.key, caret: merged.length }
  }

  const handleRemove = (key: string) => {
    const row = rows.find(item => item.key === key)
    if (!row) return
    if (row.content.trim() && !window.confirm('删除这条记录？')) return
    void removeRow(key)
  }

  const handleAddRow = () => insertRowAfter(rows[rows.length - 1]?.key)

  const openInTextView = async (entryId: string) => {
    setActiveEntryId(entryId)
    setFocusEntryId(entryId)
    if (view !== 'text') await switchView('text')
  }

  const exportNote = () => {
    if (!current) return
    const lines: string[] = [`# ${current.entryDate} 手记`, '']
    for (const entry of entries) {
      const clock = dailyNoteClock(entry.recordedAt)
      lines.push(`## ${entry.timePrecision === 'day' ? '未定时间' : clock?.label ?? ''}`, '', entry.content, '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `daily-note-${current.entryDate}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const clearNote = async () => {
    if (!current || !window.confirm('清空当天的全部记录，是否继续？')) return
    await clearAll()
  }

  // 分组必须按真实日期切，不能按「列表里第几个非今天」——那会把 41 天前的笔记挂在「昨日」下。
  const groups = useMemo(() => {
    const today = shanghaiDate(); const yesterday = shanghaiDateOffset(-1); const weekStart = shanghaiDateOffset(-6)
    return {
      today: notes.filter(note => note.entryDate === today),
      yesterday: notes.filter(note => note.entryDate === yesterday),
      recent: notes.filter(note => note.entryDate < yesterday && note.entryDate >= weekStart),
      archive: notes.filter(note => note.entryDate < weekStart),
    }
  }, [notes])
  const groupsConfig: Array<[string, string, DailyNote[]]> = ([['today', '今天', groups.today], ['yesterday', '昨日', groups.yesterday], ['recent', '近 7 天', groups.recent], ['archive', '归档笔记', groups.archive]] as Array<[string, string, DailyNote[]]>).filter(([, , list]) => list.length > 0)
  const isToday = noteDate === shanghaiDate()

  return <View className='daily-notes-page'>
    <View className='daily-notes-sidebar'>
      <View className='daily-note-sidebar-head'>
        <Text className='daily-note-sidebar-title'>手记</Text>
        <label className='daily-note-backfill' title='为还没有手记的日子补录'>
          <Text>＋ 补记</Text>
          <input type='date' className='daily-note-backfill-input' max={shanghaiDate()} onChange={event => { const value = event.currentTarget.value; if (value) void openByDate(value) }} />
        </label>
      </View>
      {groupsConfig.map(([key, label, groupNotes]) => <View key={key} className='daily-note-group'>
        <View className='daily-note-group-heading' onClick={() => setCollapsed(value => ({ ...value, [key]: !value[key] }))}>
          <Text>{collapsed[key] ? '▸' : '▾'} {label}</Text>
        </View>
        {!collapsed[key] && groupNotes.map(note => <View key={note.id} className={`daily-note-entry card-transition ${note.id === selectedId ? 'active' : ''}`} onClick={() => void choose(note)}>
          <Text className='daily-note-entry-emoji' aria-hidden='true'>{dailyNoteEmoji(note.entryDate)}</Text>
          <View>
            <Text>{note.entryDate}{!note.content.trim() && <Text className='daily-note-empty-dot' aria-label='未记录' />}</Text>
            <Text>{note.content.trim().slice(0, 20) || '空白小记'}</Text>
          </View>
        </View>)}
      </View>)}
    </View>

    <View className='daily-notes-editor'>
      {crossedDate && <View className='daily-note-crossday'><Text>已跨入新的一天（{crossedDate}）</Text><Button className='control-transition' onClick={() => void goToday()}>开启今日新小记</Button></View>}
      {notice && <View className='daily-note-notice'><Text>{notice}</Text></View>}

      <View className='daily-note-editor-header'>
        <View className='daily-note-save-state'>
          {saveState === 'saving'
            ? <Text className='is-saving'>保存中</Text>
            : saveState === 'error' || saveError
              ? <><Text className='is-save-error'>保存失败</Text><Button className='control-transition' onClick={() => void flush()}>重试</Button></>
              : dirty
                ? <Text className='is-pending'>待保存</Text>
                : <><Text className='daily-note-save-emoji' aria-hidden='true'>{dailyStatusEmoji}</Text><Text>已保存</Text></>}
        </View>
        <View className='daily-note-view-switch' role='tablist'>
          <button type='button' role='tab' aria-selected={view === 'text'} className={`daily-note-view-tab ${view === 'text' ? 'is-active' : ''}`} onClick={() => void switchView('text')}>文本</button>
          <button type='button' role='tab' aria-selected={view === 'timeline'} className={`daily-note-view-tab ${view === 'timeline' ? 'is-active' : ''}`} onClick={() => void switchView('timeline')}>时间轴</button>
        </View>
        <View className='daily-note-editor-actions'>
          <Button className='control-transition' onClick={exportNote}>导出记录</Button>
          <Button className='control-transition' onClick={() => void clearNote()}>清空当天</Button>
          <Button className='control-transition' onClick={() => setWeatherOpen(true)}>天气设置</Button>
        </View>
      </View>

      <View className='daily-note-day-title'>
        <Text className='daily-note-day-date'>{noteDate}</Text>
        <Text className='daily-note-day-meta'>{entries.length ? `${entries.length} 条记录` : '还没有记录'}{!isToday && ' · 补记中'}</Text>
      </View>

      {view === 'text'
        ? <View className='daily-note-text-layout'>
          <EntryTextView
            rows={rows}
            isToday={isToday}
            focusEntryId={focusEntryId}
            onContentChange={setRowContent}
            onTimeChange={setRowTime}
            onSplit={handleSplit}
            onMerge={handleMerge}
            onRemove={handleRemove}
            onFlushRow={key => void flushRow(key)}
            onAddRow={handleAddRow}
            onFocusRow={setActiveEntryId}
          />
          {/* 文本视图右侧本来就是空的：天气放在这里，时间轴视图不挤占格子。 */}
          <WeatherWidget weather={weather} onOpenSettings={() => setWeatherOpen(true)} />
        </View>
        : <EntryTimelineView
          entries={entries}
          isToday={isToday}
          ready={!loading && Boolean(current)}
          entryDate={noteDate}
          selectedEntryId={activeEntryId}
          onSelect={setActiveEntryId}
          onAdd={(time, content) => createEntryAt(noteDate, time, content)}
          onMove={(entryId, time) => moveEntry(entryId, noteDate, time)}
          onDelete={entryId => {
            const row = rows.find(item => item.entryId === entryId)
            if (!row) return
            if (!window.confirm('删除这条记录？')) return
            void removeRow(row.key)
          }}
          onOpenInText={entryId => void openInTextView(entryId)}
        />}
    </View>

    {weatherOpen && <WeatherCityDialog
      current={weather.city}
      onSelect={weather.chooseCity}
      onClose={() => setWeatherOpen(false)}
    />}
  </View>
}
