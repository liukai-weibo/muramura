/**
 * 睡眠日期选择器的日历数学。
 *
 * 睡眠日界固定东八区，这里不依赖浏览器本地时区：所有运算都用 UTC 构造，
 * 只把 'YYYY-MM-DD' 当作纯日期处理，避免跨时区时星期几错位。
 */

export interface DateParts { year: number; month: number; day: number }

export interface MonthCell { date: string; inMonth: boolean }

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDate(date: string): DateParts | undefined {
  const match = DATE_PATTERN.exec(date)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined
  return { year, month, day }
}

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(date: string, days: number): string {
  const parts = parseDate(date)
  if (!parts) return date
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/** 0=周日 … 6=周六。 */
export function dayOfWeek(date: string): number {
  const parts = parseDate(date)
  if (!parts) return 0
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

/** 周一为一周起始。 */
export function startOfWeek(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7))
}

export function weekDates(date: string): string[] {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function shiftWeek(date: string, weeks: number): string {
  return addDays(date, weeks * 7)
}

export function monthOf(date: string): { year: number; month: number } | undefined {
  const parts = parseDate(date)
  return parts ? { year: parts.year, month: parts.month } : undefined
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 }
}

/** 42 格（6 行 × 7 列），周一起始；含相邻月的补位日期。 */
export function monthGrid(year: number, month: number): MonthCell[] {
  const firstOffset = (dayOfWeek(formatDate(year, month, 1)) + 6) % 7
  const start = addDays(formatDate(year, month, 1), -firstOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    const parts = parseDate(date)
    return { date, inMonth: Boolean(parts && parts.year === year && parts.month === month) }
  })
}

/** ISO 日期字符串可直接比较大小。 */
export function isFutureDate(date: string, today: string): boolean {
  return date > today
}

/** 周一 … 周日。 */
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function weekdayLabel(date: string): string {
  return WEEKDAY_LABELS[dayOfWeek(date)] ?? ''
}

/** `11/03 – 11/09` 这样的周范围文案。 */
export function weekRangeLabel(date: string): string {
  const start = startOfWeek(date)
  const end = addDays(start, 6)
  const format = (value: string) => {
    const parts = parseDate(value)
    return parts ? `${parts.month}/${String(parts.day).padStart(2, '0')}` : value
  }
  return `${format(start)} – ${format(end)}`
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}

export function dayLabel(date: string): string {
  const parts = parseDate(date)
  return parts ? String(parts.day) : ''
}
