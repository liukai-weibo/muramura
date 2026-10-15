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

/**
 * 三餐完成度。日历格子只表达这三种状态，不再逐餐显示圆点。
 * - empty：当天没有记录，保持空白
 * - partial：记了至少一餐但没记满，用橙黄毛玻璃底
 * - complete：三餐全部记录，用白底绿色对勾
 */
export type MealDayState = 'empty' | 'partial' | 'complete'

/**
 * 由「当天已记录的餐次」推导状态。完成门槛取 mealTypeOrder.length，
 * 不硬编码 3，新增餐段时无需改动此处。
 */
export function mealDayState(recordedCount: number): MealDayState {
  if (recordedCount <= 0) return 'empty'
  return recordedCount >= mealTypeOrder.length ? 'complete' : 'partial'
}
