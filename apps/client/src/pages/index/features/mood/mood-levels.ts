import type { MoodLevel } from '@knowledge-base/contracts'

export interface MoodLevelConfig {
  level: MoodLevel
  label: string
  score: number
  color: string
  colorDark: string
}

export const moodLevelConfigs: MoodLevelConfig[] = [
  { level: 1, label: '状态偏低', score: 1, color: '#E9E2D6', colorDark: '#4F4942' },
  { level: 2, label: '有点疲惫', score: 2, color: '#E5E1D8', colorDark: '#5C554D' },
  { level: 3, label: '平静如常', score: 3, color: '#F5F1E8', colorDark: '#6B655B' },
  { level: 4, label: '轻松愉悦', score: 4, color: '#F8D7DA', colorDark: '#8B5A5F' },
  { level: 5, label: '充实畅快', score: 5, color: '#F5B7B1', colorDark: '#9E5E58' },
]

export const moodLevelColors: Record<MoodLevel, string> = {
  1: '#E9E2D6',
  2: '#E5E1D8',
  3: '#F5F1E8',
  4: '#F8D7DA',
  5: '#F5B7B1',
}

export const moodLevelColorsDark: Record<MoodLevel, string> = {
  1: '#4F4942',
  2: '#5C554D',
  3: '#6B655B',
  4: '#8B5A5F',
  5: '#9E5E58',
}

export const moodLevelLabels: Record<MoodLevel, string> = {
  1: '状态偏低',
  2: '有点疲惫',
  3: '平静如常',
  4: '轻松愉悦',
  5: '充实畅快',
}

/**
 * 综合分 = 四舍五入取整数平均，clamp 1-5；空数组返回 undefined。
 */
export function compositeMoodLevel(levels: MoodLevel[]): MoodLevel | undefined {
  if (levels.length === 0) return undefined
  const sum = levels.reduce((a, b) => a + b, 0)
  const avg = Math.round(sum / levels.length)
  return Math.max(1, Math.min(5, avg)) as MoodLevel
}

/**
 * 生成某月的日历网格数据（周一为每周起始）。
 * 返回长度为 42 的数组（6 行 × 7 列），每项为 { year, month, day, isCurrentMonth }。
 */
export function buildMonthGrid(year: number, month: number): Array<{ year: number; month: number; day: number; isCurrentMonth: boolean }> {
  // month is 1-based
  const firstDay = new Date(year, month - 1, 1)
  // 0=Sun, 1=Mon, ... 6=Sat → 周一=0: (d.getDay() + 6) % 7
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: Array<{ year: number; month: number; day: number; isCurrentMonth: boolean }> = []
  // Previous month padding
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate()
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ year: prevYear, month: prevMonth, day: daysInPrevMonth - i, isCurrentMonth: false })
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, isCurrentMonth: true })
  }
  // Next month padding
  const remaining = 42 - cells.length
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  for (let d = 1; d <= remaining; d++) {
    cells.push({ year: nextYear, month: nextMonth, day: d, isCurrentMonth: false })
  }
  return cells
}

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayLocalDate(): string {
  const d = new Date()
  return formatLocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
