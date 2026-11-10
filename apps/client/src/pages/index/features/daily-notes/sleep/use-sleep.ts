import { useCallback, useEffect, useState } from 'react'
import type { SleepEntry, SleepEntryPatch, SleepSettings, SleepSettingsWriteInput } from '@knowledge-base/contracts'
import { SLEEP_DEFAULT_SETTINGS, addDays } from '@knowledge-base/contracts'
import { apiClient } from '../../../api-client'
import { shanghaiDate } from '../daily-note-date'
import type { SleepChartStyle } from './sleep-chart'

export const SLEEP_CHANGED_EVENT = 'marumaru:sleep-changed'
/** 图表连线样式是显示偏好，按设备保存，不进数据库。 */
export const SLEEP_CHART_STYLE_STORAGE_KEY = 'marumaru.sleep-chart-style'

const readChartStyle = (): SleepChartStyle => {
  try { return window.localStorage.getItem(SLEEP_CHART_STYLE_STORAGE_KEY) === 'smooth' ? 'smooth' : 'linear' }
  catch { return 'linear' }
}

/** 睡眠写入后广播，卡片、提醒、图表都靠它刷新；跨页面用 window 事件，成本最低。 */
export function notifySleepChanged(): void {
  try { window.dispatchEvent(new CustomEvent(SLEEP_CHANGED_EVENT)) } catch { /* 事件失败不影响保存结果 */ }
}

export const SLEEP_LOAD_DAYS = 30

export interface SleepController {
  entries: SleepEntry[]
  settings: SleepSettings
  loading: boolean
  error: string
  range: 7 | 14 | 30
  setRange: (range: 7 | 14 | 30) => void
  chartStyle: SleepChartStyle
  setChartStyle: (style: SleepChartStyle) => void
  refresh: () => Promise<void>
  saveEntry: (sleepDate: string, patch: SleepEntryPatch) => Promise<{ deleted: boolean; entry?: SleepEntry }>
  removeEntry: (sleepDate: string) => Promise<void>
  saveSettings: (input: SleepSettingsWriteInput) => Promise<SleepSettings>
  acknowledge: (date: string) => Promise<void>
  todayEntry: SleepEntry | undefined
}

export function useSleep(): SleepController {
  const [entries, setEntries] = useState<SleepEntry[]>([])
  const [settings, setSettings] = useState<SleepSettings>(SLEEP_DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState<7 | 14 | 30>(14)
  const [chartStyle, setChartStyleState] = useState<SleepChartStyle>(readChartStyle)

  const setChartStyle = useCallback((style: SleepChartStyle) => {
    setChartStyleState(style)
    try { window.localStorage.setItem(SLEEP_CHART_STYLE_STORAGE_KEY, style) } catch { /* 记住样式失败不影响使用 */ }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const today = shanghaiDate()
      const [list, nextSettings] = await Promise.all([
        // 多取明天一天：晚上可能已经记了「今晚」的入睡，弹窗要能载入它。
        apiClient.listSleepEntries({ from: addDays(today, -(SLEEP_LOAD_DAYS - 1)), to: addDays(today, 1) }),
        apiClient.readSleepSettings(),
      ])
      setEntries(list)
      setSettings(nextSettings)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取睡眠记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const handler = () => { void refresh() }
    window.addEventListener(SLEEP_CHANGED_EVENT, handler)
    return () => window.removeEventListener(SLEEP_CHANGED_EVENT, handler)
  }, [refresh])

  const saveEntry = useCallback(async (sleepDate: string, patch: SleepEntryPatch) => {
    const result = await apiClient.saveSleepEntry(sleepDate, patch)
    notifySleepChanged()
    return result
  }, [])

  const removeEntry = useCallback(async (sleepDate: string) => {
    await apiClient.deleteSleepEntry(sleepDate)
    notifySleepChanged()
  }, [])

  const saveSettings = useCallback(async (input: SleepSettingsWriteInput) => {
    const saved = await apiClient.saveSleepSettings(input)
    setSettings(saved)
    setError('')
    return saved
  }, [])

  const acknowledge = useCallback(async (date: string) => {
    const saved = await apiClient.acknowledgeSleepReminder(date)
    setSettings(saved)
  }, [])

  const today = shanghaiDate()
  const todayEntry = entries.find(entry => entry.sleepDate === today)

  return {
    entries,
    settings,
    loading,
    error,
    range,
    setRange,
    chartStyle,
    setChartStyle,
    refresh,
    saveEntry,
    removeEntry,
    saveSettings,
    acknowledge,
    todayEntry,
  }
}
