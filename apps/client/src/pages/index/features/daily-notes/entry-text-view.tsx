import { useEffect, useRef, useState } from 'react'
import type { NoteRow } from './use-daily-note-entries'
import { EntryTimeChip } from './entry-time-chip'

export interface EntryTextViewProps {
  rows: NoteRow[]
  isToday: boolean
  /** 从时间轴点进来的条目：到这里定位并聚焦对应行。 */
  focusEntryId?: string
  onContentChange: (key: string, content: string) => void
  onTimeChange: (key: string, date: string, time: string) => void
  /** 回车拆行：返回新行的 key，便于把光标移过去。 */
  onSplit: (key: string, before: string, after: string) => string | undefined
  /** 退格到行首：返回合并后的落点。 */
  onMerge: (key: string) => { key: string; caret: number } | undefined
  onRemove: (key: string) => void
  onFlushRow: (key: string) => void
  onAddRow: () => string | undefined
  onFocusRow?: (entryId: string | undefined) => void
}

interface FocusRequest { key: string; caret: number }

/**
 * 文本视图：一行一条记录，行首是时间标签。
 * 打字手感和纯文本一样——回车接着往下写、退格能合并，
 * 但每行背后已经是一条带时间的结构化记录。
 */
export function EntryTextView({ rows, isToday, focusEntryId, onContentChange, onTimeChange, onSplit, onMerge, onRemove, onFlushRow, onAddRow, onFocusRow }: EntryTextViewProps) {
  const areasRef = useRef(new Map<string, HTMLTextAreaElement>())
  const requestRef = useRef<FocusRequest>()
  const [focusToken, setFocusToken] = useState(0)

  const setArea = (key: string, element: HTMLTextAreaElement | null) => {
    if (element) areasRef.current.set(key, element)
    else areasRef.current.delete(key)
  }
  const syncHeight = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(() => {
    for (const element of areasRef.current.values()) syncHeight(element)
  }, [rows])

  const focusRow = (key: string, caret: number) => {
    requestRef.current = { key, caret }
    setFocusToken(token => token + 1)
  }

  // 只跟着「聚焦请求」走，不跟 rows：否则每敲一个字都会把光标重置。
  // 行是渲染后才出现的，焦点必须在下一拍补上，否则回车拆行后光标会掉到 body。
  useEffect(() => {
    const request = requestRef.current
    if (!request) return
    const frame = requestAnimationFrame(() => {
      const element = areasRef.current.get(request.key)
      if (!element) return
      element.focus()
      const caret = Math.min(request.caret, element.value.length)
      try { element.setSelectionRange(caret, caret) } catch { /* 隐藏元素上部分浏览器会抛错，忽略 */ }
    })
    return () => cancelAnimationFrame(frame)
  }, [focusToken])

  // 从时间轴双击跳过来时定位一次。消费过就不再重复：rows 每次打字都会变，
  // 若跟着 rows 反复执行，光标会被一次次挪到行尾。
  const consumedRef = useRef<string>()
  const [flashKey, setFlashKey] = useState<string>()
  useEffect(() => {
    if (!focusEntryId || consumedRef.current === focusEntryId) return
    const row = rows.find(item => item.entryId === focusEntryId)
    if (!row) return
    consumedRef.current = focusEntryId
    focusRow(row.key, row.content.length)
    // 闪一下告诉用户「跳到的是这一条」，1.4 秒后自动淡出。
    setFlashKey(row.key)
    areasRef.current.get(row.key)?.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setFlashKey(undefined), 1400)
    return () => window.clearTimeout(timer)
  }, [focusEntryId, rows])

  return <div className='daily-note-text-view'>
    {rows.length === 0 && !isToday && <button type='button' className='daily-note-row-add' onClick={() => { const key = onAddRow(); if (key) focusRow(key, 0) }}>＋ 添加一条</button>}
    {rows.map((row, index) => {
      const previous = index > 0 ? rows[index - 1] : undefined
      const next = rows[index + 1]
      return <div key={row.key} className={`daily-note-row ${row.precision === 'day' ? 'is-untimed' : ''} ${flashKey === row.key ? 'is-focused' : ''}`}>
        <EntryTimeChip
          date={row.date}
          time={row.time}
          precision={row.precision}
          label={row.precision === 'day' ? '整篇' : row.time}
          onChange={(date, time) => onTimeChange(row.key, date, time)}
        />
        <textarea
          ref={element => setArea(row.key, element)}
          className='daily-note-row-input'
          rows={1}
          value={row.content}
          placeholder={index === 0 ? '这一刻在做什么…回车接着写下一条' : '接着写…'}
          onInput={event => { onContentChange(row.key, event.currentTarget.value); syncHeight(event.currentTarget) }}
          onKeyDown={event => {
            const element = event.currentTarget
            const start = element.selectionStart ?? 0
            const end = element.selectionEnd ?? start
            if (event.key === 'Enter' && !event.shiftKey) {
              // 输入法选字时的回车是上屏，不能当拆行。
              if (event.nativeEvent.isComposing) return
              event.preventDefault()
              const created = onSplit(row.key, row.content.slice(0, start), row.content.slice(end))
              if (created) focusRow(created, 0)
              return
            }
            if (event.key === 'Backspace' && start === 0 && end === 0) {
              const merged = onMerge(row.key)
              if (merged) { event.preventDefault(); focusRow(merged.key, merged.caret) }
              return
            }
            if (event.key === 'ArrowUp' && start === 0 && previous) {
              event.preventDefault(); focusRow(previous.key, previous.content.length)
              return
            }
            if (event.key === 'ArrowDown' && start === end && start === row.content.length && next) {
              event.preventDefault(); focusRow(next.key, 0)
              return
            }
            if (event.key === 'Escape') element.blur()
          }}
          onFocus={() => onFocusRow?.(row.entryId)}
          onBlur={() => onFlushRow(row.key)}
        />
        <button type='button' className='daily-note-row-remove' title='删除这条' onClick={() => onRemove(row.key)}>×</button>
      </div>
    })}
    {rows.length > 0 && <button type='button' className='daily-note-row-add' onClick={() => { const key = onAddRow(); if (key) focusRow(key, 0) }}>＋ 添加一条</button>}
    <p className='daily-note-text-hint'>回车换下一条 · 退格到行首合并上一条 · 点左侧时间可改时间或移到别的日期</p>
  </div>
}
