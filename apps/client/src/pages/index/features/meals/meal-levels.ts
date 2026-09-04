import { MEAL_SATIETY_LEVELS, MEAL_SATIETY_LABELS, type MealType } from '@knowledge-base/contracts'
import { formatLocalDate, todayLocalDate } from '../calendar-utils'

// 饱腹度档位：仅 5/7/9 是可选项（0=未记录，不是可选档位）。
// 标签与色板统一使用 contracts 的 MEAL_SATIETY_LABELS / MEAL_SATIETY_LEVELS。
export const mealFeelingLabels: Record<number, string> = MEAL_SATIETY_LABELS

export const mealSatietyLevels: readonly number[] = MEAL_SATIETY_LEVELS

// 饱腹度统一暖奶油低饱和色系：弹窗胶囊、日历圆点、图例共用一个色板。
// 5（五分饱）→7（七分饱）→9（九分饱）由浅米色过渡到柔粉；0（未记录）为中性灰。
export const mealFeelingColors: Record<number, string> = {
  0: '#EAE7E1',
  5: '#F5F1E8',
  7: '#F8D7DA',
  9: '#F5B7B1',
}

export const mealFeelingColorsDark: Record<number, string> = {
  0: '#4A4843',
  5: '#574F45',
  7: '#6B4A50',
  9: '#7D5248',
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