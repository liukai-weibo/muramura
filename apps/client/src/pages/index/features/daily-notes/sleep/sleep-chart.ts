import type { SleepEntry } from '@knowledge-base/contracts'
import {
  addDays,
  sleepDayOf,
  sleepDurationMinutes,
  sleepMinuteOfDay,
} from '@knowledge-base/contracts'

/**
 * 图表按「天」取数：D 这一列只有「D 当天起床」和「D 当天入睡」，
 * 不再向后找 D+1，所以不会出现「一列跨两天」和日期标错的问题。
 */
export interface SleepChartDay {
  date: string
  /** 起床在纵轴上的分钟数（06:00 起算，0..360）。 */
  wakeMinute?: number
  /** 入睡在纵轴上的分钟数（06:00 起算，720..1439）。 */
  bedMinute?: number
  wakeAt?: string
  bedAt?: string
  /** 入睡落在次日凌晨（属于当天记录，但时钟已经过了午夜）。 */
  bedNextDay?: boolean
}

export interface SleepChartPoint {
  x: number
  y: number
  date: string
  minute: number
  at?: string
  nextDay?: boolean
}

export interface SleepChartGridLine { y: number; label?: string; minute: number }

/** 横轴日期刻度：只标首/中/末三个点，避免 264px 宽度下拥挤。 */
export interface SleepChartTick { x: number; date: string; label: string; anchor: 'start' | 'middle' | 'end' }

export interface SleepChartLayout {
  width: number
  height: number
  wakeSegments: SleepChartPoint[][]
  bedSegments: SleepChartPoint[][]
  wakeDots: SleepChartPoint[]
  bedDots: SleepChartPoint[]
  grid: SleepChartGridLine[]
  ticks: SleepChartTick[]
  plotTop: number
  plotBottom: number
  midnightY: number
  /** 命中测试用的列宽与左边界。 */
  left: number
  step: number
  columnCount: number
}

export interface SleepChartOptions { width: number; height: number }

/** 纵轴：06:00（上）→ 次日 06:00（下）。 */
export const CHART_AXIS_START_MINUTE = 6 * 60
export const CHART_AXIS_MINUTES = 24 * 60
export const CHART_MIDNIGHT_MINUTE = 18 * 60

const PADDING = { left: 30, right: 8, top: 8, bottom: 30 }

/** 连线样式：直线段或平滑曲线。 */
export type SleepChartStyle = 'linear' | 'smooth'

/** 当地时钟 → 从 06:00 起算的分钟数（绕回 24 小时）。 */
function sinceSix(minuteOfDay: number): number {
  return (minuteOfDay - CHART_AXIS_START_MINUTE + CHART_AXIS_MINUTES) % CHART_AXIS_MINUTES
}

/**
 * 起床落在 06–12 区（0..360），入睡落在 18–次日 06 区（720..1439）。
 * 异常时刻夹到所属区域边缘，tooltip 仍显示真实时刻。
 */
function clampWake(minuteOfDay: number): number {
  if (minuteOfDay < CHART_AXIS_START_MINUTE) return 0
  return Math.min(360, sinceSix(minuteOfDay))
}

function clampBed(minuteOfDay: number): number {
  if (minuteOfDay >= 18 * 60) return sinceSix(minuteOfDay)
  if (minuteOfDay < 6 * 60) return sinceSix(minuteOfDay)
  // 12:00–18:00 属于白天：夹到入睡区顶部；06:00–12:00 视为次日早晨，夹到底部。
  return minuteOfDay < 12 * 60 ? 1439 : 720
}

export { clampBed, clampWake, sinceSix }

/** 按天生成序列：只读当天的 wakeAt / bedAt。 */
export function buildSleepSeries(entries: SleepEntry[], days: number, today: string): SleepChartDay[] {
  const byDate = new Map(entries.map(entry => [entry.sleepDate, entry]))
  const series: SleepChartDay[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset)
    const entry = byDate.get(date)
    if (!entry) { series.push({ date }); continue }
    const wakeMinuteOfDay = entry.wakeAt ? sleepMinuteOfDay(entry.wakeAt) : undefined
    const bedMinuteOfDay = entry.bedAt ? sleepMinuteOfDay(entry.bedAt) : undefined
    const bedNextDay = Boolean(entry.bedAt && sleepDayOf(entry.bedAt) === addDays(date, 1))
    series.push({
      date,
      ...(wakeMinuteOfDay !== undefined ? { wakeMinute: clampWake(wakeMinuteOfDay), wakeAt: entry.wakeAt } : {}),
      ...(bedMinuteOfDay !== undefined ? { bedMinute: clampBed(bedMinuteOfDay), bedAt: entry.bedAt, bedNextDay } : {}),
    })
  }
  return series
}

function yOf(minute: number, height: number): number {
  const plotHeight = height - PADDING.top - PADDING.bottom
  return PADDING.top + (minute / CHART_AXIS_MINUTES) * plotHeight
}

/** 纯几何：两套点各自成线，互不相连。 */
export function sleepChartLayout(series: SleepChartDay[], options: SleepChartOptions): SleepChartLayout {
  const width = Math.max(120, options.width)
  const height = Math.max(80, options.height)
  const plotWidth = width - PADDING.left - PADDING.right
  const step = plotWidth / Math.max(1, series.length)
  const xOf = (index: number) => PADDING.left + step * (index + 0.5)

  const wakeSegments: SleepChartPoint[][] = []
  const bedSegments: SleepChartPoint[][] = []
  const wakeDots: SleepChartPoint[] = []
  const bedDots: SleepChartPoint[] = []
  let currentWake: SleepChartPoint[] | undefined
  let currentBed: SleepChartPoint[] | undefined

  series.forEach((day, index) => {
    if (day.wakeMinute !== undefined) {
      const point: SleepChartPoint = {
        x: xOf(index), y: yOf(day.wakeMinute, height), date: day.date, minute: day.wakeMinute,
        ...(day.wakeAt ? { at: day.wakeAt } : {}),
      }
      wakeDots.push(point)
      currentWake = currentWake ?? []
      if (currentWake.length === 0) wakeSegments.push(currentWake)
      currentWake.push(point)
    } else {
      currentWake = undefined
    }

    if (day.bedMinute !== undefined) {
      const point: SleepChartPoint = {
        x: xOf(index), y: yOf(day.bedMinute, height), date: day.date, minute: day.bedMinute,
        ...(day.bedAt ? { at: day.bedAt } : {}),
        ...(day.bedNextDay ? { nextDay: true } : {}),
      }
      bedDots.push(point)
      currentBed = currentBed ?? []
      if (currentBed.length === 0) bedSegments.push(currentBed)
      currentBed.push(point)
    } else {
      currentBed = undefined
    }
  })

  const gridMinutes = [0, 360, 720, 1080, 1440]
  const labels: Record<number, string> = { 0: '06', 360: '12', 720: '18', 1080: '00', 1440: '06' }
  const grid = gridMinutes.map(minute => ({
    minute,
    y: yOf(minute, height),
    ...(labels[minute] ? { label: labels[minute] } : {}),
  }))

  // 首/中/末三个日期点，让「左旧右新」有明确的锚点。
  const tickIndexes = series.length <= 3
    ? series.map((_, index) => index)
    : [0, Math.floor((series.length - 1) / 2), series.length - 1]
  const ticks: SleepChartTick[] = tickIndexes.map((index, position) => {
    const date = series[index]?.date ?? ''
    return {
      x: xOf(index),
      date,
      label: date.slice(5).replace('-', '/'),
      anchor: position === 0 ? 'start' : position === tickIndexes.length - 1 ? 'end' : 'middle',
    }
  })

  return {
    width,
    height,
    wakeSegments,
    bedSegments,
    wakeDots,
    bedDots,
    grid,
    ticks,
    plotTop: PADDING.top,
    plotBottom: height - PADDING.bottom,
    midnightY: yOf(CHART_MIDNIGHT_MINUTE, height),
    left: PADDING.left,
    step,
    columnCount: series.length,
  }
}

/** 把 SVG 内的 x 坐标换算成日期列下标。 */
export function columnAtX(layout: SleepChartLayout, x: number): number | undefined {
  if (layout.step <= 0) return undefined
  const index = Math.floor((x - layout.left) / layout.step)
  return index >= 0 && index < layout.columnCount ? index : undefined
}

/** 某一列的中心 x。 */
export function columnCenterX(layout: SleepChartLayout, index: number): number {
  return layout.left + layout.step * (index + 0.5)
}

/**
 * 一段连续点的平滑曲线：Catmull-Rom 转三次贝塞尔。
 * `tension` 越小越接近折线；0.5 为常规平滑，0.75–0.9 更圆润。
 * 控制点钳制在绘图区内，避免曲线过冲画出图表。
 */
export function smoothSegmentPath(
  points: Array<{ x: number; y: number }>,
  height: number,
  bounds?: { top: number; bottom: number },
  tension = 0.5,
): string {
  if (points.length < 2) return ''
  const top = bounds?.top ?? PADDING.top
  const bottom = bounds?.bottom ?? height - PADDING.bottom
  const clampY = (y: number) => Math.min(bottom, Math.max(top, y))
  const factor = Math.max(0, Math.min(1, tension)) / 3
  const at = (index: number): { x: number; y: number } => points[Math.max(0, Math.min(points.length - 1, index))]!
  const commands: string[] = [`M ${points[0]!.x.toFixed(1)} ${clampY(points[0]!.y).toFixed(1)}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = at(index - 1)
    const current = at(index)
    const next = at(index + 1)
    const after = at(index + 2)
    const control1 = {
      x: current.x + (next.x - previous.x) * factor,
      y: clampY(current.y + (next.y - previous.y) * factor),
    }
    const control2 = {
      x: next.x - (after.x - current.x) * factor,
      y: clampY(next.y - (after.y - current.y) * factor),
    }
    commands.push(
      `C ${control1.x.toFixed(1)} ${control1.y.toFixed(1)} ${control2.x.toFixed(1)} ${control2.y.toFixed(1)} ${next.x.toFixed(1)} ${clampY(next.y).toFixed(1)}`,
    )
  }
  return commands.join(' ')
}

/** 最近一个完整夜：bed(D) + wake(D+1)，只用于卡片摘要。 */
export function latestCompleteNight(entries: SleepEntry[], today: string): { date: string; bedAt: string; wakeAt: string; minutes: number } | undefined {
  const byDate = new Map(entries.map(entry => [entry.sleepDate, entry]))
  for (let offset = 0; offset <= 60; offset += 1) {
    const date = addDays(today, -offset)
    const bedAt = byDate.get(date)?.bedAt
    const wakeAt = byDate.get(addDays(date, 1))?.wakeAt
    if (!bedAt || !wakeAt) continue
    const minutes = sleepDurationMinutes(bedAt, wakeAt)
    if (minutes !== undefined) return { date, bedAt, wakeAt, minutes }
  }
  return undefined
}

/** 纵轴坐标 → 时钟文案（06:00 起算，绕回次日）。 */
export function axisClockLabel(minute: number): string {
  const clockMinute = (Math.round(minute) + CHART_AXIS_START_MINUTE) % (24 * 60)
  return `${String(Math.floor(clockMinute / 60)).padStart(2, '0')}:${String(clockMinute % 60).padStart(2, '0')}`
}
