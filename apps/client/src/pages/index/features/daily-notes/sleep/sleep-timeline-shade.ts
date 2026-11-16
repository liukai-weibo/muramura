import type { SleepEntry } from '@knowledge-base/contracts'
import { addDays, sleepDayOf, sleepMinuteOfDay } from '@knowledge-base/contracts'

/**
 * 时间轴上的睡眠阴影：只表达「这一天里，人在什么时段睡着」。
 *
 * 数据模型是「D 日记录 = D 早上起床 + D 晚上入睡」，所以某一天 D 的阴影来自两段：
 * 1. 凌晨/上午：D 的 wakeAt，加上 D-1 记录的 bedAt（熬夜时会落在 D 当天）；
 * 2. 晚上：D 自己的 bedAt 到 24:00。
 * 只取与当天 00:00–24:00 相交的部分，重叠区间合并。
 */
export interface SleepShadeWindow {
  startMinute: number
  endMinute: number
  /** 只知道起床时间、没有入睡时间：从 00:00 起算，用更淡的阴影表示估计。 */
  estimated?: boolean
}

const DAY_MINUTES = 24 * 60

const clampMinute = (minute: number): number => Math.min(DAY_MINUTES, Math.max(0, Math.round(minute)))

const byDate = (entries: SleepEntry[]): Map<string, SleepEntry> => {
  const map = new Map<string, SleepEntry>()
  for (const entry of entries) map.set(entry.sleepDate, entry)
  return map
}

/** 把若干区间排序、裁剪并合并；只有全部为估计值时结果才标记为估计。 */
function mergeWindows(windows: SleepShadeWindow[]): SleepShadeWindow[] {
  const prepared = windows
    .map(window => ({
      startMinute: clampMinute(window.startMinute),
      endMinute: clampMinute(window.endMinute),
      estimated: Boolean(window.estimated),
    }))
    .filter(window => window.endMinute > window.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute)

  const merged: SleepShadeWindow[] = []
  for (const window of prepared) {
    const last = merged[merged.length - 1]
    if (last && window.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, window.endMinute)
      last.estimated = Boolean(last.estimated && window.estimated)
      continue
    }
    merged.push({ ...window })
  }
  return merged
}

export function sleepShadeWindows(entries: SleepEntry[], date: string): SleepShadeWindow[] {
  if (!date) return []
  const map = byDate(entries)
  const windows: SleepShadeWindow[] = []

  const wakeAt = map.get(date)?.wakeAt
  const wakeMinute = wakeAt ? sleepMinuteOfDay(wakeAt) : undefined
  if (wakeAt && wakeMinute !== undefined && wakeMinute > 0) {
    const previousBedAt = map.get(addDays(date, -1))?.bedAt
    if (previousBedAt) {
      // 入睡落在当天（熬夜到凌晨）就按真实时间起算；落在前一天说明跨过了午夜。
      const bedMinuteOnDate = sleepDayOf(previousBedAt) === date ? sleepMinuteOfDay(previousBedAt) : 0
      const startMinute = bedMinuteOnDate !== undefined && bedMinuteOnDate < wakeMinute ? bedMinuteOnDate : 0
      windows.push({ startMinute, endMinute: wakeMinute })
    } else {
      windows.push({ startMinute: 0, endMinute: wakeMinute, estimated: true })
    }
  }

  const bedAt = map.get(date)?.bedAt
  if (bedAt && sleepDayOf(bedAt) === date) {
    const bedMinute = sleepMinuteOfDay(bedAt)
    if (bedMinute !== undefined && bedMinute < DAY_MINUTES) {
      windows.push({ startMinute: bedMinute, endMinute: DAY_MINUTES })
    }
  }

  return mergeWindows(windows)
}

export interface SleepBandFill {
  /** 这一格里从什么比例开始压阴影（0 = 格子上沿）。 */
  from: number
  /** 到什么比例结束（1 = 格子下沿）。 */
  to: number
  estimated: boolean
}

/** 把睡眠区间摊到 24 个小时格上，得到每格要画的比例。 */
export function sleepBandFill(windows: SleepShadeWindow[]): Map<number, SleepBandFill> {
  const fills = new Map<number, SleepBandFill>()
  for (const window of windows) {
    const startMinute = clampMinute(window.startMinute)
    const endMinute = clampMinute(window.endMinute)
    if (endMinute <= startMinute) continue
    const firstHour = Math.floor(startMinute / 60)
    const lastHour = Math.min(23, Math.ceil(endMinute / 60) - 1)
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const hourStart = hour * 60
      const from = Math.max(0, (startMinute - hourStart) / 60)
      const to = Math.min(1, (endMinute - hourStart) / 60)
      if (to <= from) continue
      const current = fills.get(hour)
      if (!current) {
        fills.set(hour, { from, to, estimated: Boolean(window.estimated) })
        continue
      }
      fills.set(hour, {
        from: Math.min(current.from, from),
        to: Math.max(current.to, to),
        estimated: Boolean(current.estimated && window.estimated),
      })
    }
  }
  return fills
}
