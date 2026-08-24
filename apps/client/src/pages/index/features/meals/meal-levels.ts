import type { MealType } from '@knowledge-base/contracts'
import { formatLocalDate, todayLocalDate } from '../calendar-utils'

export const mealFeelingLabels: Record<number, string> = {
  1: '不太舒服',
  2: '平平淡淡',
  3: '刚刚好',
  4: '吃得开心',
  5: '超满足',
}

// 五档感受统一暖奶油低饱和色系：弹窗胶囊、日历圆点、图例共用一个色板。
// 1（不太舒服）→5（超满足）由冷灰过渡到柔粉。
export const mealFeelingColors: Record<number, string> = {
  1: '#E2E8F0',
  2: '#E5E1D8',
  3: '#F5F1E8',
  4: '#F8D7DA',
  5: '#F5B7B1',
}

export const mealFeelingColorsDark: Record<number, string> = {
  1: '#46506A',
  2: '#55534B',
  3: '#574F45',
  4: '#6B4A50',
  5: '#7D5248',
}

export const mealTypeOrder: MealType[] = ['breakfast', 'lunch', 'dinner']

export const mealTypeLabels: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
}

// 餐段手绘感图标用固定 emoji 表达，轻量不抢视觉重心。
export const mealTypeEmojis: Record<MealType, string> = {
  breakfast: '🥐',
  lunch: '🍱',
  dinner: '🍲',
}

export { formatLocalDate, todayLocalDate }
