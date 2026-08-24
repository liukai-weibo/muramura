import type { MoodLevel } from '@knowledge-base/contracts'

export interface MoodLevelConfig {
  level: MoodLevel
  label: string
  score: number
  color: string
  colorDark: string
}

// 五档情绪统一采用暖奶油低饱和色系：弹窗胶囊、日历热力图、图例共用一个色板。
// 1（状态偏低）→5（充实畅快）由冷灰过渡到柔粉。
export const moodLevelConfigs: MoodLevelConfig[] = [
  { level: 1, label: '状态偏低', score: 1, color: '#E2E8F0', colorDark: '#46506A' },
  { level: 2, label: '有点疲惫', score: 2, color: '#E5E1D8', colorDark: '#55534B' },
  { level: 3, label: '平静如常', score: 3, color: '#F5F1E8', colorDark: '#574F45' },
  { level: 4, label: '轻松愉悦', score: 4, color: '#F8D7DA', colorDark: '#6B4A50' },
  { level: 5, label: '充实畅快', score: 5, color: '#F5B7B1', colorDark: '#7D5248' },
]

export const moodLevelColors: Record<MoodLevel, string> = {
  1: '#E2E8F0',
  2: '#E5E1D8',
  3: '#F5F1E8',
  4: '#F8D7DA',
  5: '#F5B7B1',
}

export const moodLevelColorsDark: Record<MoodLevel, string> = {
  1: '#46506A',
  2: '#55534B',
  3: '#574F45',
  4: '#6B4A50',
  5: '#7D5248',
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

export { buildMonthDays, buildMonthGrid, formatLocalDate, todayLocalDate } from '../calendar-utils'
