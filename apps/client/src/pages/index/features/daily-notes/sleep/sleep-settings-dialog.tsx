import { useEffect, useState } from 'react'
import type { SleepSettings, SleepSettingsWriteInput } from '@knowledge-base/contracts'
import { minuteOfDayLabel } from '@knowledge-base/contracts'
import type { SleepChartStyle } from './sleep-chart'

export interface SleepSettingsDialogProps {
  settings: SleepSettings
  chartStyle: SleepChartStyle
  onChangeChartStyle: (style: SleepChartStyle) => void
  onSave: (input: SleepSettingsWriteInput) => Promise<unknown>
  onClose: () => void
}

/** 睡眠设置：提醒开关、提醒时间段、输入精度、图表连线样式。保存后立即作用于提醒与记录弹窗。 */
export function SleepSettingsDialog({ settings, chartStyle, onChangeChartStyle, onSave, onClose }: SleepSettingsDialogProps) {
  const [enabled, setEnabled] = useState(settings.remindEnabled)
  const [startHour, setStartHour] = useState(String(Math.floor(settings.remindStartMinute / 60)))
  const [startMinute, setStartMinute] = useState(String(settings.remindStartMinute % 60))
  const [endHour, setEndHour] = useState(String(Math.floor(settings.remindEndMinute / 60)))
  const [endMinute, setEndMinute] = useState(String(settings.remindEndMinute % 60))
  const [precision, setPrecision] = useState(settings.inputPrecision)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const toMinuteOfDay = (hour: string, minute: string): number | undefined => {
    const h = Number(hour)
    const m = Number(minute)
    if (!Number.isInteger(h) || h < 0 || h > 23) return undefined
    if (!Number.isInteger(m) || m < 0 || m > 59) return undefined
    return h * 60 + m
  }

  const startMinuteOfDay = toMinuteOfDay(startHour, startMinute)
  const endMinuteOfDay = toMinuteOfDay(endHour, endMinute)
  const windowValid = startMinuteOfDay !== undefined && endMinuteOfDay !== undefined && startMinuteOfDay < endMinuteOfDay

  const submit = async () => {
    if (!windowValid || startMinuteOfDay === undefined || endMinuteOfDay === undefined) {
      setError('提醒时间段无效：开始时间必须早于结束时间，且不能跨天')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        remindEnabled: enabled,
        remindStartMinute: startMinuteOfDay,
        remindEndMinute: endMinuteOfDay,
        inputPrecision: precision,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return <div className='capture-modal-backdrop' role='dialog' aria-modal='true' aria-label='睡眠设置' onClick={onClose}>
    <div className='capture-modal sleep-settings-modal' onClick={event => event.stopPropagation()}>
      <div className='capture-modal-heading'>
        <div className='sleep-modal-heading'>
          <span className='section-kicker'>睡眠设置</span>
          <span>提醒与输入方式</span>
        </div>
        <button type='button' className='capture-modal-close' onClick={onClose}>关闭</button>
      </div>

      <label className='sleep-checkbox is-strong'>
        <input type='checkbox' checked={enabled} onChange={event => setEnabled(event.target.checked)} />
        <span>打开应用时提醒填写睡眠</span>
      </label>
      <p className='sleep-settings-hint'>
        只在下面的时间段内、且今天还没有睡醒记录时弹一次；填过或关掉后当天不再提醒。
      </p>

      <div className='sleep-settings-row'>
        <span>提醒时间段</span>
        <div className='sleep-range-inputs'>
          <input type='number' min={0} max={23} value={startHour} aria-label='提醒开始小时' onChange={event => setStartHour(event.target.value)} />
          <span>:</span>
          <input type='number' min={0} max={59} step={5} value={startMinute} aria-label='提醒开始分钟' onChange={event => setStartMinute(event.target.value)} />
          <span className='sleep-range-dash'>–</span>
          <input type='number' min={0} max={23} value={endHour} aria-label='提醒结束小时' onChange={event => setEndHour(event.target.value)} />
          <span>:</span>
          <input type='number' min={0} max={59} step={5} value={endMinute} aria-label='提醒结束分钟' onChange={event => setEndMinute(event.target.value)} />
        </div>
      </div>
      {windowValid
        ? <p className='sleep-settings-hint'>每天 {minuteOfDayLabel(startMinuteOfDay!)}–{minuteOfDayLabel(endMinuteOfDay!)} 之间提醒</p>
        : <p className='sleep-error' role='status'>开始时间必须早于结束时间，且不能跨天</p>}

      <div className='sleep-settings-row'>
        <span>输入精度</span>
        <div className='sleep-precision-switch' role='radiogroup' aria-label='输入精度'>
          <button type='button' role='radio' aria-checked={precision === 'hour'} className={precision === 'hour' ? 'is-active' : ''} onClick={() => setPrecision('hour')}>整点</button>
          <button type='button' role='radio' aria-checked={precision === 'minute'} className={precision === 'minute' ? 'is-active' : ''} onClick={() => setPrecision('minute')}>精确到分钟</button>
        </div>
      </div>
      <p className='sleep-settings-hint'>整点更快；切到精确后记录弹窗会出现分钟选项。</p>

      <div className='sleep-settings-row'>
        <span>连线样式</span>
        <div className='sleep-precision-switch' role='radiogroup' aria-label='连线样式'>
          <button type='button' role='radio' aria-checked={chartStyle === 'linear'} className={chartStyle === 'linear' ? 'is-active' : ''} onClick={() => onChangeChartStyle('linear')}>折线</button>
          <button type='button' role='radio' aria-checked={chartStyle === 'smooth'} className={chartStyle === 'smooth' ? 'is-active' : ''} onClick={() => onChangeChartStyle('smooth')}>曲线</button>
        </div>
      </div>
      <p className='sleep-settings-hint'>折线是点到点；曲线更顺滑。切换立即生效，按设备记住。</p>

      {error && <p className='sleep-error' role='status'>{error}</p>}

      <div className='sleep-modal-actions'>
        <button type='button' className='sleep-action' onClick={onClose} disabled={saving}>取消</button>
        <button type='button' className='sleep-action is-primary' disabled={saving || !windowValid} onClick={() => void submit()}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  </div>
}
