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
export interface SleepSideSpan {
  /** 本列内的起始分钟（上午列 0–720 对应 00:00–12:00）。 */
  from: number
  /** 本列内的结束分钟。 */
  to: number
}

const SIDE_MINUTES = 12 * 60

/**
 * 纯视觉抬升：让阴影整体上移约 1/3 格（20 分钟），与小时刻度读起来更贴。
 * 只影响底色位置，图例与数据仍是真实时间。
 */
const SLEEP_SPAN_LIFT_MINUTES = 20

/**
 * 视觉上按整点吸附：只要某个小时被睡眠碰到，整格都算进来。
 * 6:30 入睡 → 从 6 点整开始；7:00 起床 → 连 7–8 这一格也算。
 * 图例仍用真实时间，这里只影响底色铺到哪。
 */
export function snapSleepWindowToHours(window: SleepShadeWindow): SleepShadeWindow {
  const startHour = Math.floor(clampMinute(window.startMinute) / 60)
  const endHour = Math.floor(clampMinute(window.endMinute) / 60)
  return {
    startMinute: startHour * 60,
    endMinute: Math.min(DAY_MINUTES, (endHour + 1) * 60),
    ...(window.estimated ? { estimated: true } : {}),
  }
}

/** 把睡眠窗口按 12:00 拆到上午列 / 下午列，供时间轴的分列遮罩使用。 */
export function sleepSideIntervals(windows: SleepShadeWindow[], side: 'am' | 'pm'): SleepSideSpan[] {
  const offset = side === 'pm' ? SIDE_MINUTES : 0
  const spans: SleepSideSpan[] = []
  for (const window of windows) {
    const snapped = snapSleepWindowToHours(window)
    const liftedStart = Math.max(0, snapped.startMinute - SLEEP_SPAN_LIFT_MINUTES)
    // 压着 24:00 的晚间区间保持到收口，不在末尾留出空档。
    const liftedEnd = snapped.endMinute >= DAY_MINUTES
      ? DAY_MINUTES
      : Math.max(liftedStart + 1, snapped.endMinute - SLEEP_SPAN_LIFT_MINUTES)
    const from = Math.max(offset, liftedStart) - offset
    const to = Math.min(offset + SIDE_MINUTES, liftedEnd) - offset
    if (to > from) spans.push({ from, to })
  }
  return spans
}

const pad = (value: number): string => String(value).padStart(2, '0')
const clock = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`

/** 图例文案：06:40–08:30；有两段时用 · 连接；全部为估计时追加说明。 */
export function sleepShadeLabel(windows: SleepShadeWindow[]): string {
  if (windows.length === 0) return ''
  const parts = windows.map(window => `${clock(clampMinute(window.startMinute))}–${clock(clampMinute(window.endMinute))}`)
  const estimated = windows.every(window => window.estimated)
  return `${parts.join(' · ')}${estimated ? ' · 估计' : ''}`
}