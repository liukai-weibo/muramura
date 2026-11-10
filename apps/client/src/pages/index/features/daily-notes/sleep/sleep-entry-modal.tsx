import { useEffect, useMemo, useRef, useState } from 'react'
import type { SleepEntry, SleepEntryPatch, SleepInputPrecision } from '@knowledge-base/contracts'
import {
  SLEEP_FUTURE_TOLERANCE_MINUTES,
  addDays,
  dailyNoteClock,
  isWithinSleepFutureTolerance,
  isValidSleepBed,
  isValidSleepWake,
  sleepClockLabel,
  sleepDayOf,
  sleepIsoAt,
} from '@knowledge-base/contracts'
import { apiClient } from '../../../api-client'
import { inferSleepFromDay, type SleepSuggestion } from './sleep-suggestion'
import { SleepDatePicker } from './sleep-date-picker'
import { buildSleepRecommendations, SLEEP_FREQUENT_MIN_SAMPLES, type SleepTimeChip } from './sleep-recommendations'
import { shanghaiDate } from '../daily-note-date'

const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

const clockParts = (iso: string): { hour: number; minute: number } | undefined => {
  const clock = dailyNoteClock(iso)
  return clock ? { hour: clock.hour, minute: clock.minute } : undefined
}

const pad = (value: number) => String(value).padStart(2, '0')

export interface SleepEntryModalProps {
  initialDate: string
  entry?: SleepEntry
  entries: SleepEntry[]
  precision: SleepInputPrecision
  /** 提醒场景只补起床，不展示入睡区。 */
  mode?: 'full' | 'wake'
  onClose: () => void
  onSave: (sleepDate: string, patch: SleepEntryPatch) => Promise<unknown>
  onDelete?: (sleepDate: string) => Promise<unknown>
}

type SleepField = 'wake' | 'bed'

/**
 * 记录某一天的睡眠：当天起床 + 当晚入睡。
 * 两组时间默认都展示，未选中即「未记录」；常用时间标签放在网格上方，减少找时间成本。
 */
export function SleepEntryModal({ initialDate, entry, entries, precision, mode = 'full', onClose, onSave, onDelete }: SleepEntryModalProps) {
  const today = shanghaiDate()
  const [sleepDate, setSleepDate] = useState(initialDate)
  const [wakeOn, setWakeOn] = useState(Boolean(entry?.wakeAt) || !entry)
  const [wakeHour, setWakeHour] = useState(clockParts(entry?.wakeAt ?? '')?.hour ?? 7)
  const [wakeMinute, setWakeMinute] = useState(clockParts(entry?.wakeAt ?? '')?.minute ?? 0)
  const [bedOn, setBedOn] = useState(Boolean(entry?.bedAt))
  const [bedHour, setBedHour] = useState(clockParts(entry?.bedAt ?? '')?.hour ?? 23)
  const [bedMinute, setBedMinute] = useState(clockParts(entry?.bedAt ?? '')?.minute ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number>()
  const suggestionCache = useRef(new Map<string, SleepSuggestion>())

  const showToast = (message: string) => {
    if (!message) return
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  // 提示出现后，点任意位置都消失（避免触发它的那次点击立刻清掉）。
  useEffect(() => {
    if (!toast) return
    const dismiss = () => setToast('')
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', dismiss, { once: true }), 20)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [toast])

  const recommendations = useMemo(
    () => buildSleepRecommendations(entries, today, precision),
    [entries, today, precision],
  )

  // 切换日期时载入那一天的记录；空白日期按常用时间预填起床。
  useEffect(() => {
    const target = entries.find(item => item.sleepDate === sleepDate)
    if (target) {
      const wake = target.wakeAt ? clockParts(target.wakeAt) : undefined
      const bed = target.bedAt ? clockParts(target.bedAt) : undefined
      setWakeOn(Boolean(wake))
      if (wake) { setWakeHour(wake.hour); setWakeMinute(wake.minute) }
      setBedOn(Boolean(bed))
      if (bed) { setBedHour(bed.hour); setBedMinute(bed.minute) }
      return
    }
    const defaultWake = recommendations.defaultWake
    setWakeOn(sleepDate === today)
    setWakeHour(defaultWake?.hour ?? 7)
    setWakeMinute(precision === 'hour' ? 0 : defaultWake?.minute ?? 0)
    setBedOn(false)
    setBedHour(recommendations.bed[0]?.hour ?? 23)
    setBedMinute(precision === 'hour' ? 0 : recommendations.bed[0]?.minute ?? 0)
  }, [sleepDate, entries, precision, today, recommendations])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const chooseWakeHour = (hour: number) => {
    // 已经选中同一个小时时，再点一次表示取消记录。
    if (wakeOn && hour === wakeHour) { setWakeOn(false); return }
    if (precision === 'hour' && hour !== wakeHour) setWakeMinute(0)
    setWakeHour(hour)
    setWakeOn(true)
  }
  const chooseBedHour = (hour: number) => {
    if (bedOn && hour === bedHour) { setBedOn(false); return }
    if (precision === 'hour' && hour !== bedHour) setBedMinute(0)
    setBedHour(hour)
    setBedOn(true)
  }

  const applyChip = (field: SleepField, chip: SleepTimeChip) => {
    const reason = field === 'wake'
      ? wakeDisabledReason(chip.hour, chip.minute)
      : bedDisabledReason(chip.hour, chip.minute)
    if (reason) { showToast(reason); return }
    if (field === 'wake') {
      setWakeHour(chip.hour); setWakeMinute(chip.minute); setWakeOn(true)
    } else {
      setBedHour(chip.hour); setBedMinute(chip.minute); setBedOn(true)
    }
    setError('')
  }

  const wakeAt = wakeOn ? sleepIsoAt(sleepDate, wakeHour, wakeMinute) : undefined
  const wakeMinuteOfDay = wakeOn ? wakeHour * 60 + wakeMinute : undefined
  const bedMinuteOfDay = bedHour * 60 + bedMinute
  const bedRollsOver = bedOn && wakeMinuteOfDay !== undefined && bedMinuteOfDay < wakeMinuteOfDay
  const bedAt = bedOn ? sleepIsoAt(bedRollsOver ? addDays(sleepDate, 1) : sleepDate, bedHour, bedMinute) : undefined
  const bedLabel = bedOn ? `${bedRollsOver ? '次日' : '当天'} ${pad(bedHour)}:${pad(bedMinute)}` : '未记录'

  const targetEntry = entries.find(item => item.sleepDate === sleepDate)
  const entryHasMinutes = precision === 'hour' && targetEntry
    ? Boolean((targetEntry.wakeAt && clockParts(targetEntry.wakeAt)?.minute) || (targetEntry.bedAt && clockParts(targetEntry.bedAt)?.minute))
    : false

  const previousEntry = entries.find(item => item.sleepDate === addDays(sleepDate, -1))
  const previousBedSpill = previousEntry?.bedAt && sleepDayOf(previousEntry.bedAt) === sleepDate
    ? previousEntry.bedAt
    : undefined
  const previousBedMinute = previousBedSpill ? clockParts(previousBedSpill) : undefined
  const previousBedLabel = previousBedSpill ? (sleepClockLabel(previousBedSpill) ?? '') : ''
  const nextWake = entries.find(item => item.sleepDate === addDays(sleepDate, 1))?.wakeAt

  const FUTURE_HINT = `还没到这个时间，最多可以提前 ${SLEEP_FUTURE_TOLERANCE_MINUTES / 60} 小时记录`

  /** 不可选的原因；空字符串表示可选。 */
  const wakeDisabledReason = (hour: number, minute: number): string => {
    if (previousBedMinute) {
      const bedMinute = previousBedMinute.hour * 60 + previousBedMinute.minute
      const target = precision === 'hour' ? hour * 60 : hour * 60 + minute
      if (target < bedMinute) return `昨天 ${previousBedLabel} 才睡，起床不能早于 ${previousBedLabel}`
    }
    const iso = sleepIsoAt(sleepDate, hour, minute)
    if (iso && Date.parse(iso) > Date.now() + SLEEP_FUTURE_TOLERANCE_MINUTES * 60 * 1000) return FUTURE_HINT
    return ''
  }

  const bedDisabledReason = (hour: number, minute: number): string => {
    const minuteOfDay = hour * 60 + minute
    const rolls = wakeMinuteOfDay !== undefined && minuteOfDay < wakeMinuteOfDay
    const iso = sleepIsoAt(rolls ? addDays(sleepDate, 1) : sleepDate, hour, minute)
    if (iso && Date.parse(iso) > Date.now() + SLEEP_FUTURE_TOLERANCE_MINUTES * 60 * 1000) return FUTURE_HINT
    return ''
  }

  const wakeHours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => !wakeDisabledReason(hour, 0))
  const bedHours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => !bedDisabledReason(hour, 0))
  const wakeMinutes = wakeOn ? MINUTE_STEPS.filter(minute => !wakeDisabledReason(wakeHour, minute)) : []
  const bedMinutes = bedOn ? MINUTE_STEPS.filter(minute => !bedDisabledReason(bedHour, minute)) : []
  const wakeChips = recommendations.wakeSamples >= SLEEP_FREQUENT_MIN_SAMPLES
    ? recommendations.wake.filter(chip => !wakeDisabledReason(chip.hour, chip.minute))
    : []
  const bedChips = recommendations.bedSamples >= SLEEP_FREQUENT_MIN_SAMPLES
    ? recommendations.bed.filter(chip => !bedDisabledReason(chip.hour, chip.minute))
    : []

  const loadSuggestion = async (): Promise<SleepSuggestion> => {
    const cached = suggestionCache.current.get(sleepDate)
    if (cached) return cached
    const notes = await apiClient.listDailyNotes()
    const note = notes.find(item => item.entryDate === sleepDate)
    const dayEntries = note ? (await apiClient.getDailyNoteWithEntries(note.id)).entries : []
    const suggestion = inferSleepFromDay(dayEntries)
    suggestionCache.current.set(sleepDate, suggestion)
    return suggestion
  }

  const fillFromNotes = async (field: SleepField) => {
    setSuggesting(true)
    setError('')
    try {
      const suggestion = await loadSuggestion()
      const value = suggestion[field]
      if (!value) { setError('这一天的手记里没有可用时间'); return }
      const reason = field === 'wake'
        ? wakeDisabledReason(value.hour, value.minute)
        : bedDisabledReason(value.hour, value.minute)
      if (reason) { showToast(reason); return }
      if (field === 'wake') {
        setWakeHour(value.hour); setWakeMinute(value.minute); setWakeOn(true)
      } else {
        setBedHour(value.hour); setBedMinute(value.minute); setBedOn(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取手记时间失败')
    } finally {
      setSuggesting(false)
    }
  }

  const submit = async () => {
    if (!wakeOn && !bedOn) { setError('至少记录起床或入睡其中一个时间'); return }
    if (wakeOn && !wakeAt) { setError('起床时间无效'); return }
    if (wakeOn && !isValidSleepWake(sleepDate, wakeAt!)) { setError('起床时间必须落在当天'); return }
    if (wakeAt && previousBedSpill && Date.parse(wakeAt) < Date.parse(previousBedSpill)) {
      setError(`今天 ${previousBedLabel} 才睡，起床不能早于 ${previousBedLabel}`)
      return
    }
    if (wakeAt && !isWithinSleepFutureTolerance(wakeAt)) { setError(`时间最多可以比现在晚 ${SLEEP_FUTURE_TOLERANCE_MINUTES} 分钟`); return }
    if (bedOn && !bedAt) { setError('入睡时间无效'); return }
    if (bedOn && !isValidSleepBed(sleepDate, bedAt!, wakeOn ? wakeAt : undefined)) {
      setError(wakeOn ? `入睡不能早于当天 ${sleepClockLabel(wakeAt!) ?? ''} 的起床` : '没有起床记录时，入睡只能记在当天')
      return
    }
    if (bedAt && !isWithinSleepFutureTolerance(bedAt)) { setError(`时间最多可以比现在晚 ${SLEEP_FUTURE_TOLERANCE_MINUTES} 分钟`); return }
    if (bedAt && nextWake && Date.parse(bedAt) >= Date.parse(nextWake)) {
      setError(`次日 ${sleepClockLabel(nextWake) ?? ''} 已记起床，入睡要早于它`)
      return
    }

    const patch: SleepEntryPatch = {}
    if (mode === 'wake') {
      patch.wakeAt = wakeOn ? wakeAt : null
    } else {
      patch.wakeAt = wakeOn ? wakeAt : null
      patch.bedAt = bedOn ? bedAt : null
    }
    setSaving(true)
    setError('')
    try {
      await onSave(sleepDate, patch)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!onDelete) return
    if (!window.confirm('删除这一天的睡眠记录？')) return
    setSaving(true)
    try {
      await onDelete(sleepDate)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const bedChipLabel = (chip: SleepTimeChip): string => {
    if (!wakeOn || !wakeMinuteOfDay) return chip.label
    return chip.hour * 60 + chip.minute < wakeMinuteOfDay ? `次日 ${chip.label}` : chip.label
  }

  return <div className='capture-modal-backdrop' role='dialog' aria-modal='true' aria-label='记录睡眠' onClick={onClose}>
    <div className='capture-modal sleep-entry-modal' onClick={event => event.stopPropagation()}>
      <div className='capture-modal-heading'>
        <div className='sleep-modal-heading'>
          <span className='section-kicker'>睡眠</span>
          {mode === 'wake' && <span>补记今天的起床时间</span>}
        </div>
        <button type='button' className='sleep-close-icon' aria-label='关闭' onClick={onClose}>✕</button>
      </div>

      <div className='sleep-date-nav'>
        {mode === 'wake'
          ? <span className='sleep-date-fixed'>今天 · {sleepDate}</span>
          : <SleepDatePicker value={sleepDate} today={today} entries={entries} onChange={setSleepDate} />}
        <span className='sleep-night-date'>{sleepDate === today ? '今天' : sleepDate === addDays(today, -1) ? '昨天' : `${sleepDate} 的睡眠`}</span>
      </div>

      <div className='sleep-entry-scroll'>
        {entryHasMinutes ? <p className='sleep-time-hint'>这条记录精确到分钟；改小时会把分钟归零，不改则保留原分钟。</p> : null}

        <div className='sleep-time-block is-wake'>
          <div className='sleep-time-head'>
            <div className='sleep-time-labels'>
              <span className='sleep-time-caption'>{sleepDate === today ? '今天起床' : '当天起床'}</span>
              <span className={`sleep-time-value ${wakeOn ? '' : 'is-empty'}`}>{wakeOn ? `${pad(wakeHour)}:${pad(wakeMinute)}` : '未记录'}</span>
            </div>
            <div className='sleep-module-actions'>
              <button type='button' className='sleep-mini-action' disabled={suggesting} onClick={() => void fillFromNotes('wake')}>手记填入</button>
            </div>
          </div>

          {previousBedSpill && wakeOn && previousBedMinute && wakeMinuteOfDay !== undefined
            && wakeMinuteOfDay < previousBedMinute.hour * 60 + previousBedMinute.minute
            && <p className='sleep-time-hint is-warning'>昨天 {previousBedLabel} 才睡，起床不能早于 {previousBedLabel}</p>}

          {wakeChips.length > 0 && <div className='sleep-chips' role='group' aria-label='常用起床时间'>
            {wakeChips.map(chip => <button
              key={`wake-chip-${chip.label}`}
              type='button'
              className={`sleep-chip ${wakeOn && chip.hour === wakeHour && chip.minute === wakeMinute ? 'is-active' : ''}`}
              onClick={() => applyChip('wake', chip)}
            >{chip.label}</button>)}
          </div>}

          <div className='sleep-hour-grid' role='radiogroup' aria-label='起床小时'>
            {wakeHours.map(hour => <button
              key={`wake-${hour}`}
              type='button'
              role='radio'
              aria-checked={wakeOn && hour === wakeHour}
              className={`sleep-hour ${wakeOn && hour === wakeHour ? 'is-active' : ''}`}
              onClick={() => chooseWakeHour(hour)}
            >{pad(hour)}</button>)}
          </div>
          {wakeHours.length === 0 && <p className='sleep-time-hint'>今天还没有可选的时间。</p>}
          {precision === 'minute' && wakeOn && wakeMinutes.length > 0 && <div className='sleep-minute-row' role='radiogroup' aria-label='起床分钟'>
            {wakeMinutes.map(minute => <button
              key={`wake-m-${minute}`}
              type='button'
              role='radio'
              aria-checked={minute === wakeMinute}
              className={`sleep-minute ${minute === wakeMinute ? 'is-active' : ''}`}
              onClick={() => {
                if (minute === wakeMinute) { setWakeOn(false); return }
                setWakeMinute(minute); setWakeOn(true)
              }}
            >{pad(minute)}</button>)}
          </div>}
        </div>

        {mode === 'full' && <div className='sleep-time-block is-bed'>
          <div className='sleep-time-head'>
            <div className='sleep-time-labels'>
              <span className='sleep-time-caption'>{sleepDate === today ? '今晚入睡' : '当晚入睡'}</span>
              <span className={`sleep-time-value ${bedOn ? '' : 'is-empty'}`}>{bedOn ? bedLabel : '未记录'}</span>
            </div>
            <div className='sleep-module-actions'>
              <button type='button' className='sleep-mini-action' disabled={suggesting} onClick={() => void fillFromNotes('bed')}>手记填入</button>
            </div>
          </div>

          {bedChips.length > 0 && <div className='sleep-chips' role='group' aria-label='常用入睡时间'>
            {bedChips.map(chip => <button
              key={`bed-chip-${chip.label}`}
              type='button'
              className={`sleep-chip ${bedOn && chip.hour === bedHour && chip.minute === bedMinute ? 'is-active' : ''}`}
              onClick={() => applyChip('bed', chip)}
            >{bedChipLabel(chip)}</button>)}
          </div>}

          <div className='sleep-hour-grid' role='radiogroup' aria-label='入睡小时'>
            {bedHours.map(hour => <button
              key={`bed-${hour}`}
              type='button'
              role='radio'
              aria-checked={bedOn && hour === bedHour}
              className={`sleep-hour ${bedOn && hour === bedHour ? 'is-active' : ''}`}
              onClick={() => chooseBedHour(hour)}
            >{pad(hour)}</button>)}
          </div>
          {bedHours.length === 0 && <p className='sleep-time-hint'>今天还没有可选的入睡时间。</p>}
          {precision === 'minute' && bedOn && bedMinutes.length > 0 && <div className='sleep-minute-row' role='radiogroup' aria-label='入睡分钟'>
            {bedMinutes.map(minute => <button
              key={`bed-m-${minute}`}
              type='button'
              role='radio'
              aria-checked={minute === bedMinute}
              className={`sleep-minute ${minute === bedMinute ? 'is-active' : ''}`}
              onClick={() => {
                if (minute === bedMinute) { setBedOn(false); return }
                setBedMinute(minute); setBedOn(true)
              }}
            >{pad(minute)}</button>)}
          </div>}
        </div>}
      </div>

      <div className='sleep-modal-footer'>
        {error && <p className='sleep-error' role='status'>{error}</p>}

        <div className='sleep-modal-actions'>
          {onDelete && targetEntry && <button type='button' className='sleep-action is-danger' disabled={saving} onClick={() => void remove()}>删除</button>}
          <button type='button' className='sleep-action' onClick={onClose} disabled={saving}>取消</button>
          <button type='button' className='sleep-action is-primary' disabled={saving || (!wakeOn && !bedOn)} onClick={() => void submit()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
      {toast && <div className='sleep-time-toast' role='status'>{toast}</div>}
    </div>
  </div>
}
