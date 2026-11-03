import { useEffect, useRef, useState } from 'react'
import type { DailyNoteTimePrecision } from '@knowledge-base/contracts'

export interface EntryTimeChipProps {
  date: string
  time: string
  precision: DailyNoteTimePrecision
  label: string
  disabled?: boolean
  onChange: (date: string, time: string) => void
}

/**
 * 行首的时间标签：显示值不可直接编辑，点开才出现日期＋时间。
 * 改到别的日期时上游会把这条记录搬到那一天，这里只负责取值。
 */
export function EntryTimeChip({ date, time, precision, label, disabled, onChange }: EntryTimeChipProps) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState(date)
  const [draftTime, setDraftTime] = useState(time)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDraftDate(date)
    setDraftTime(time)
  }, [open, date, time])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const commit = () => {
    if (!draftDate || !draftTime) return
    setOpen(false)
    if (draftDate !== date || draftTime !== time) onChange(draftDate, draftTime)
  }

  return <div className='daily-note-time-chip-wrap' ref={wrapRef}>
    <button
      type='button'
      className={`daily-note-time-chip ${precision === 'day' ? 'is-day' : ''} ${open ? 'is-open' : ''}`}
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
      title={precision === 'day' ? '这条是旧数据，没有具体时间；点一下给它定个时间' : '改时间，或把这条移到别的日期'}
    >{label}</button>
    {open && <div className='daily-note-time-popover'>
      <label className='daily-note-time-popover-row'>
        <span className='daily-note-time-popover-label'>日期</span>
        <input className='daily-note-time-popover-input' type='date' value={draftDate} onChange={event => setDraftDate(event.target.value)} />
      </label>
      <label className='daily-note-time-popover-row'>
        <span className='daily-note-time-popover-label'>时间</span>
        <input className='daily-note-time-popover-input' type='time' value={draftTime} onChange={event => setDraftTime(event.target.value)} />
      </label>
      <div className='daily-note-time-popover-actions'>
        <button type='button' className='daily-note-time-popover-confirm' onClick={commit}>确定</button>
        <button type='button' className='daily-note-time-popover-cancel' onClick={() => setOpen(false)}>取消</button>
      </div>
    </div>}
  </div>
}
