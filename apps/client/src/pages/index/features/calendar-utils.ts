/**
 * 通用本地日期与月历网格工具。情绪与三餐模块共用。
 */

export function formatLocalDate(year: number, month: number, day: number): string {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

export function todayLocalDate(): string {
  const d = new Date()
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

const CN_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 将一个 ISO 本地日期（YYYY-MM-DD）格式化为「M 月 D 日 周X」的生活化中文展示。
 * 仅用于展示，不参与任何业务写入或比较。
 */
export function formatLocalDateCN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const weekday = CN_WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${month} 月 ${day} 日 ${weekday}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * 生成某月仅当月日期的网格数据（周一为每周起始）。
 * 返回长度 = offset + 当月天数；前 offset 项为 isPlaceholder=true 的占位（跨月位置），
 * 其余为当月日期。用于日历只显示当月号、跨月空占位的渲染。
 */
export function buildMonthDays(year: number, month: number): Array<{ day: number; isPlaceholder: boolean }> {
  const firstDay = new Date(year, month - 1, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const days = daysInMonth(year, month)
  const cells: Array<{ day: number; isPlaceholder: boolean }> = []
  for (let i = 0; i < startOffset; i++) cells.push({ day: 0, isPlaceholder: true })
  for (let d = 1; d <= days; d++) cells.push({ day: d, isPlaceholder: false })
  return cells
}

/**
 * 生成某月的日历网格数据（周一为每周起始），返回 42 项（6 行 × 7 列）。
 */
export function buildMonthGrid(year: number, month: number): Array<{ year: number; month: number; day: number; isCurrentMonth: boolean }> {
  const firstDay = new Date(year, month - 1, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const days = daysInMonth(year, month)
  const cells: Array<{ year: number; month: number; day: number; isCurrentMonth: boolean }> = []
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrevMonth = daysInMonth(prevYear, prevMonth)
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ year: prevYear, month: prevMonth, day: daysInPrevMonth - i, isCurrentMonth: false })
  }
  for (let d = 1; d <= days; d++) cells.push({ year, month, day: d, isCurrentMonth: true })
  const remaining = 42 - cells.length
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  for (let d = 1; d <= remaining; d++) cells.push({ year: nextYear, month: nextMonth, day: d, isCurrentMonth: false })
  return cells
}
