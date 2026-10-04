import type { MealType } from '@knowledge-base/contracts'
import { formatLocalDate, todayLocalDate } from '../calendar-utils'

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
