import type { SleepEntry, SleepInputPrecision } from '@knowledge-base/contracts'
import { addDays, dailyNoteClock } from '@knowledge-base/contracts'

export interface SleepTimeChip {
  hour: number
  minute: number
  label: string
  count: number
}

export interface SleepRecommendations {
  wake: SleepTimeChip[]
  bed: SleepTimeChip[]
  /** 最近 14 天里带起床 / 入睡的记录条数；不足 10 条时界面不展示常用时间。 */
  wakeSamples: number
  bedSamples: number
  /** 最近 14 天里至少出现 3 次的起床时间；没有就不预选。 */
  defaultWake?: SleepTimeChip
}

/** 常用时间至少要有这么多条历史记录才展示。 */
export const SLEEP_FREQUENT_MIN_SAMPLES = 10

const pad = (value: number) => String(value).padStart(2, '0')
const chip = (hour: number, minute: number, count: number): SleepTimeChip => ({ hour, minute, label: `${pad(hour)}:${pad(minute)}`, count })

function clockOf(iso: string | undefined): { hour: number; minute: number } | undefined {
  if (!iso) return undefined
  const clock = dailyNoteClock(iso)
  return clock ? { hour: clock.hour, minute: clock.minute } : undefined
}

function aggregate(entries: SleepEntry[], read: (entry: SleepEntry) => string | undefined, precision: SleepInputPrecision): SleepTimeChip[] {
  const counts = new Map<string, SleepTimeChip>()
  for (const entry of entries) {
    const clock = clockOf(read(entry))
    if (!clock) continue
    const hour = clock.hour
    const minute = precision === 'hour' ? 0 : clock.minute
    const key = `${hour}:${minute}`
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, chip(hour, minute, 1))
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute))
    .slice(0, 3)
}

/**
 * 最近 14 天的高频起床/入睡时间，以及每个字段的记录条数。
 * 记录不足 10 条时，界面用条数判断是否展示常用时间。
 */
export function buildSleepRecommendations(
  entries: SleepEntry[],
  today: string,
  precision: SleepInputPrecision,
): SleepRecommendations {
  const from = addDays(today, -14)
  const recent = entries.filter(entry => entry.sleepDate >= from && entry.sleepDate < today)
  const wake = aggregate(recent, entry => entry.wakeAt, precision)
  const bed = aggregate(recent, entry => entry.bedAt, precision)
  const defaultWake = wake[0] && wake[0].count >= 3 ? wake[0] : undefined
  return {
    wake,
    bed,
    wakeSamples: recent.filter(entry => Boolean(entry.wakeAt)).length,
    bedSamples: recent.filter(entry => Boolean(entry.bedAt)).length,
    ...(defaultWake ? { defaultWake } : {}),
  }
}
