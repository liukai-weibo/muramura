import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DailyNoteEntry } from '@knowledge-base/contracts'
import { dailyNoteMinuteOfDay } from '@knowledge-base/contracts'
import { EntryRecordModal } from './entry-record-modal'
import { bandTintIndexes, tintClassOf } from './entry-tint'
import {
  TIMELINE_BAND_COUNT,
  TIMELINE_MORE_HEIGHT,
  bandColumns,
  bandSlot,
  type TimelineBandSide,
  bandCardTop,
  bandHourOf,
  bandKey,
  bandLayout,
  bandMoreTop,
  bandRowAt,
  bandRowHeight,
  groupByBand,
  minuteOfHour,
} from './timeline-layout'

export interface EntryTimelineViewProps {
  entries: DailyNoteEntry[]
  isToday: boolean
  /** 手记还没读完时不要接受点击：那时补录会因为拿不到 note 而静默失败。 */
  ready?: boolean
  /** 当前手记的日期，弹窗里要显示给人确认。 */
  entryDate: string
  selectedEntryId?: string
  onSelect: (entryId?: string) => void
  onAdd: (time: string, content: string) => Promise<boolean>
  onMove: (entryId: string, time: string) => Promise<boolean>
  onDelete: (entryId: string) => void
  onOpenInText: (entryId: string) => void
}

const ROWS = Array.from({ length: TIMELINE_BAND_COUNT }, (_unused, row) => row)
const pad = (value: number): string => String(value).padStart(2, '0')
const timeLabel = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minuteOfHour(minute))}`
const currentMinute = (): number => dailyNoteMinuteOfDay(new Date().toISOString()) ?? 0
/** 量不到高度时的兜底，量到之后立刻换成真实值，避免首帧空着。 */
const estimateHeight = (): number => Math.max(300, (typeof window === 'undefined' ? 900 : window.innerHeight) - 320)

interface DragState { entryId: string; minute: number; hour: number; side: TimelineBandSide; x: number; y: number }

/**
 * 时间轴视图：中间一条竖轴，左列 00–11 点、右列 12–23 点，一小时一格，整天一屏。
 * 格子表达时刻，卡片上不再写时间；点格子按那个时段弹窗补记，拖卡片换时段，双击进文本视图看全文。
 */
export function EntryTimelineView({
  entries,
  isToday,
  ready = true,
  entryDate,
  selectedEntryId,
  onSelect,
  onAdd,
  onMove,
  onDelete,
  onOpenInText,
}: EntryTimelineViewProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const amSideRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ entryId: string; startY: number; minute: number; moved: boolean } | null>(null)
  const [height, setHeight] = useState(estimateHeight)
  const [sideWidth, setSideWidth] = useState(0)
  const [record, setRecord] = useState<{ hour: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [clock, setClock] = useState(currentMinute)

  // 同步量一次再画：异步量的话，卡片会先用估算行高画一帧再跳位。
  useLayoutEffect(() => {
    const measure = () => {
      const element = gridRef.current
      if (!element) return
      const next = Math.round(element.getBoundingClientRect().height)
      const nextSideWidth = Math.round(amSideRef.current?.getBoundingClientRect().width ?? 0)
      if (next > 0) setHeight(current => (current === next ? current : next))
      if (nextSideWidth > 0) setSideWidth(current => (current === nextSideWidth ? current : nextSideWidth))
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined
    if (observer && gridRef.current) observer.observe(gridRef.current)
    if (observer && amSideRef.current) observer.observe(amSideRef.current)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(currentMinute()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      dragRef.current = null
      setDrag(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drag])

  const rowHeight = bandRowHeight(height)
  const columns = bandColumns(sideWidth)
  const nowHour = Math.floor(clock / 60)
  const timed = useMemo(() => entries
    .filter(entry => entry.timePrecision === 'minute')
    .map(entry => ({ entry, minute: dailyNoteMinuteOfDay(entry.recordedAt) ?? 0 })), [entries])
  const untimed = useMemo(() => entries.filter(entry => entry.timePrecision === 'day'), [entries])
  const groups = useMemo(
    () => groupByBand(timed.map(item => ({ id: item.entry.id, minute: item.minute, entry: item.entry }))),
    [timed],
  )
  const isEmpty = timed.length === 0

  const sideColumn = (side: TimelineBandSide) => <div
    key={side}
    ref={side === 'am' ? amSideRef : undefined}
    className={`daily-note-band-side is-${side} ${columns === 2 ? 'is-two-column' : ''}`}
  >
    {ROWS.map(row => {
      const hour = bandHourOf(row, side)
      const classes = [
        'daily-note-band',
        isToday && nowHour === hour ? 'is-now' : '',
        drag && drag.side === side && drag.hour === hour ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')
      return <button
        key={row}
        type='button'
        className={classes}
        disabled={!ready}
        title={`在 ${pad(hour)} 点补记`}
        aria-label={`在 ${pad(hour)} 点补记`}
        onClick={() => setRecord({ hour })}
      ><span className='daily-note-band-add' aria-hidden='true'>＋</span></button>
    })}

    <div className='daily-note-band-cards'>
      {ROWS.map(row => {
        const items = groups.get(bandKey(side, row)) ?? []
        if (items.length === 0) return null
        const layout = bandLayout(items.length, rowHeight, columns)
        const rowTop = row * rowHeight
        const tints = bandTintIndexes(items.map(item => item.id))
        return <div key={row} className='daily-note-band-stack'>
          {items.slice(0, layout.visible).map((item, index) => {
            const dragging = drag?.entryId === item.id
            const slot = bandSlot(index, layout)
            const classes = [
              'daily-note-timeline-card',
              `is-col-${slot.column}`,
              tintClassOf(tints[index] ?? 0),
              dragging ? 'is-dragging' : '',
              selectedEntryId === item.id ? 'is-selected' : '',
            ].filter(Boolean).join(' ')
            return <div
              key={item.id}
              data-entry-id={item.id}
              role='button'
              tabIndex={0}
              aria-label={`${timeLabel(item.minute)} ${item.entry.content}`}
              className={classes}
              style={{ top: `${rowTop + bandCardTop(index, layout)}px`, height: `${layout.cardHeight}px` }}
              title={item.entry.content}
              onClick={event => { event.stopPropagation(); onSelect(item.id) }}
              onDoubleClick={event => { event.stopPropagation(); onOpenInText(item.id) }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); onOpenInText(item.id) }
                if (event.key === ' ') { event.preventDefault(); onSelect(item.id) }
              }}
              onPointerDown={event => {
                if (event.button !== 0) return
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = { entryId: item.id, startY: event.clientY, minute: item.minute, moved: false }
              }}
              onPointerMove={event => {
                const info = dragRef.current
                if (!info || info.entryId !== item.id) return
                if (!info.moved && Math.abs(event.clientY - info.startY) > 4) info.moved = true
                if (!info.moved) return
                const grid = gridRef.current?.getBoundingClientRect()
                if (!grid) return
                const nextSide: TimelineBandSide = event.clientX < grid.left + grid.width / 2 ? 'am' : 'pm'
                setDrag({
                  entryId: item.id,
                  minute: info.minute,
                  side: nextSide,
                  hour: bandHourOf(bandRowAt(event.clientY - grid.top, rowHeight), nextSide),
                  x: event.clientX,
                  y: event.clientY,
                })
              }}
              onPointerUp={event => {
                const info = dragRef.current
                dragRef.current = null
                if (!info) return
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                const target = drag
                setDrag(null)
                // 只点不拖 = 选中；换时段才写时间，分钟保持不变。
                if (!info.moved || !target || target.entryId !== item.id) { onSelect(item.id); return }
                if (target.hour === Math.floor(info.minute / 60)) { onSelect(item.id); return }
                void onMove(item.id, `${pad(target.hour)}:${pad(minuteOfHour(item.minute))}`)
              }}
              onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
            >
              <span className='daily-note-timeline-card-content'>{item.entry.content}</span>
              <button type='button' className='daily-note-timeline-card-remove' title='删除这条' onClick={event => { event.stopPropagation(); onDelete(item.id) }}>×</button>
            </div>
          })}
          {layout.hidden > 0 && <button
            type='button'
            className={`daily-note-band-more is-col-${bandSlot(layout.visible, layout).column}`}
            style={{ top: `${rowTop + bandMoreTop(layout)}px`, height: `${TIMELINE_MORE_HEIGHT}px` }}
            title={`这一时段还有 ${layout.hidden} 条，去文本视图看`}
            onClick={() => onOpenInText(items[layout.visible]?.id ?? items[0]!.id)}
          >还有 {layout.hidden} 条</button>}
        </div>
      })}
    </div>
  </div>

  return <div className='daily-note-timeline-view'>
    {untimed.length > 0 && <div className='daily-note-untimed'>
      <span className='daily-note-untimed-title'>未定时间（旧数据）</span>
      <div className='daily-note-untimed-list'>
        {untimed.map(entry => <div key={entry.id} className='daily-note-untimed-item'>
          <span className='daily-note-untimed-content' title={entry.content}>{entry.content}</span>
          <button type='button' className='daily-note-untimed-button' onClick={() => onOpenInText(entry.id)}>定时间</button>
        </div>)}
      </div>
    </div>}

    <div className='daily-note-bands-frame'>
      <div className='daily-note-bands' ref={gridRef}>
        {sideColumn('am')}
        <div className='daily-note-band-axis'>
          {ROWS.map(row => {
            const isNowRow = isToday && (nowHour === row || nowHour === row + 12)
            return <div key={row} className={`daily-note-band-axis-row ${isNowRow ? 'is-now' : ''}`}>
              <button
                type='button'
                className='daily-note-band-axis-label is-am'
                disabled={!ready}
                title={`在 ${pad(row)} 点补记`}
                aria-label={`在 ${pad(row)} 点补记`}
                onClick={() => setRecord({ hour: row })}
              >{pad(row)}</button>
              <button
                type='button'
                className='daily-note-band-axis-label is-pm'
                disabled={!ready}
                title={`在 ${pad(row + 12)} 点补记`}
                aria-label={`在 ${pad(row + 12)} 点补记`}
                onClick={() => setRecord({ hour: row + 12 })}
              >{pad(row + 12)}</button>
            </div>
          })}
        </div>
        {sideColumn('pm')}
      </div>
      {/* 底部闭合刻度：左列收到 12 点、右列收到 00 点，一天读起来是闭环的。 */}
      <div className='daily-note-bands-foot'>
        <span />
        <div className='daily-note-bands-foot-axis'>
          <span className='daily-note-band-axis-label is-am' title='上午收口 12 点'>12</span>
          <span className='daily-note-band-axis-label is-pm' title='这一天的收口 00 点'>00</span>
        </div>
        <span />
      </div>
      {isEmpty && !record && <div className='daily-note-bands-empty'>
        {ready ? '点任意时段，就能按那个时间补一条' : '正在读取这一天的手记…'}
      </div>}
    </div>

    {drag && <div className='daily-note-drag-hint' style={{ left: `${drag.x + 12}px`, top: `${drag.y - 10}px` }}>
      {pad(drag.hour)}:{pad(minuteOfHour(drag.minute))}
    </div>}

    {record && <EntryRecordModal
      entryDate={entryDate}
      hour={record.hour}
      onSubmit={(time, content) => onAdd(time, content)}
      onClose={() => setRecord(null)}
    />}
  </div>
}
