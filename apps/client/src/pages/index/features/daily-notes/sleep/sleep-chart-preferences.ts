import { useEffect, useState } from 'react'
import type { SleepChartStyle } from './sleep-chart'

export const SLEEP_CHART_STYLE_STORAGE_KEY = 'marumaru.sleep-chart-style'
export const SLEEP_CURVE_STORAGE_KEY = 'marumaru.sleep-curve-roundness.v1'
export const SLEEP_CURVE_DEFAULT = 0.95
const CHANGED = 'marumaru:sleep-chart-preferences'

export function normalizeSleepRoundness(value: unknown): number {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? Math.min(1, Math.max(0.3, number)) : SLEEP_CURVE_DEFAULT
}

export function sleepStylePreference(value: string | null): SleepChartStyle {
  return value === 'linear' ? 'linear' : 'smooth'
}

const readStyle = () => {
  try { return sleepStylePreference(window.localStorage.getItem(SLEEP_CHART_STYLE_STORAGE_KEY)) }
  catch { return 'smooth' as const }
}
const readRoundness = () => {
  try {
    const raw = window.localStorage.getItem(SLEEP_CURVE_STORAGE_KEY)
    return raw === null ? SLEEP_CURVE_DEFAULT : normalizeSleepRoundness(Number(raw))
  } catch { return SLEEP_CURVE_DEFAULT }
}

/** 同设备即时共享，小图/月图/年图统一；首页迷你图保持独立。 */
export function useSleepChartPreferences() {
  const [chartStyle, setStyle] = useState<SleepChartStyle>(readStyle)
  const [curveRoundness, setRoundness] = useState(readRoundness)
  useEffect(() => {
    const reload = () => { setStyle(readStyle()); setRoundness(readRoundness()) }
    window.addEventListener(CHANGED, reload)
    window.addEventListener('storage', reload)
    return () => { window.removeEventListener(CHANGED, reload); window.removeEventListener('storage', reload) }
  }, [])
  const setChartStyle = (value: SleepChartStyle) => {
    try {
      window.localStorage.setItem(SLEEP_CHART_STYLE_STORAGE_KEY, value)
      window.dispatchEvent(new Event(CHANGED))
    } catch { /* 存储不可用时仍作用于当前图 */ }
    setStyle(value)
  }
  const setCurveRoundness = (value: number) => {
    const normalized = normalizeSleepRoundness(value)
    try {
      window.localStorage.setItem(SLEEP_CURVE_STORAGE_KEY, String(normalized))
      window.dispatchEvent(new Event(CHANGED))
    } catch { /* 存储不可用时仍作用于当前图 */ }
    setRoundness(normalized)
  }
  return { chartStyle, setChartStyle, curveRoundness, setCurveRoundness }
}
