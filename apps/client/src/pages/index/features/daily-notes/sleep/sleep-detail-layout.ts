/**
 * 睡眠详情弹窗的纯布局工具：自然月、逐小时轴、年份网格。
 * 轴与卡片图一致：06:00 → 次日 06:00，一分钟一格。
 */

import { addDays, sleepMinuteOfDay } from '@knowledge-base/contracts'
import { clampBed, clampWake } from './sleep-chart'
import { monthGrid } from './sleep-calendar'

export const DETAIL_AXIS_START_MINUTE = 6 * 60
export const DETAIL_AXIS_MINUTES = 24 * 60

export interface HourTick { minute: number; label: string }

export interface MonthCellInfo { date: string; inMonth: boolean }

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 }
}

export function monthDates(year: number, month: number): string[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`)
}

/** 一整年的日期（1/1–12/31），供年折线图使用。 */
export function yearDates(year: number): string[] {
  const dates: string[] = []
  for (let month = 1; month <= 12; month += 1) dates.push(...monthDates(year, month))
  return dates
}

export interface DateTick { index: number; label: string }

/** 月视图：只标月初、月中、月末。 */
export function monthDateTicks(dates: string[]): DateTick[] {
  if (dates.length === 0) return []
  const indexes = dates.length <= 2 ? dates.map((_, index) => index) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
  return indexes.map(index => ({ index, label: dates[index]!.slice(5).replace('-', '/') }))
}

/** 年视图：每个月标一个「N 月」。 */
export function yearMonthTicks(dates: string[]): DateTick[] {
  const ticks: DateTick[] = []
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]!
    if (!date.endsWith('-01')) continue
    ticks.push({ index, label: `${Number(date.slice(5, 7))} 月` })
  }
  return ticks
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}

export function detailMonthGrid(year: number, month: number): MonthCellInfo[] {
  return monthGrid(year, month)
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function weekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()] ?? ''
}

/** 25 个整点刻度：06、07 … 23、00 … 次日 06。 */
export function hourTicks(): HourTick[] {
  return Array.from({ length: 25 }, (_, index) => {
    const minute = index * 60
    const clock = (minute + DETAIL_AXIS_START_MINUTE) % DETAIL_AXIS_MINUTES
    return {
      minute,
      label: `${String(Math.floor(clock / 60)).padStart(2, '0')}`,
    }
  })
}

/** 某条记录在逐小时轴上的分钟位置。 */
export function entryAxisMinutes(entry: { wakeAt?: string; bedAt?: string } | undefined): { wake?: number; bed?: number } {
  if (!entry) return {}
  const wakeMinute = entry.wakeAt ? sleepMinuteOfDay(entry.wakeAt) : undefined
  const bedMinute = entry.bedAt ? sleepMinuteOfDay(entry.bedAt) : undefined
  return {
    ...(wakeMinute !== undefined ? { wake: clampWake(wakeMinute) } : {}),
    ...(bedMinute !== undefined ? { bed: clampBed(bedMinute) } : {}),
  }
}

export function shiftDate(date: string, days: number): string {
  return addDays(date, days)
}
