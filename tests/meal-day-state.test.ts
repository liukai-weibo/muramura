import { describe, expect, it } from 'vitest'
import { mealDayState, mealTypeOrder } from '../apps/client/src/pages/index/features/meals/meal-levels'

describe('meal calendar day state', () => {
  it('treats a day with no records as empty', () => {
    expect(mealDayState(0)).toBe('empty')
  })

  it('treats a day with negative counts as empty rather than partial', () => {
    // 记录数量理论上不会是负数，这里锁定「非正数不显示橙黄」的降级行为。
    expect(mealDayState(-1)).toBe('empty')
  })

  it('treats one or two records as partial', () => {
    expect(mealDayState(1)).toBe('partial')
    expect(mealDayState(2)).toBe('partial')
  })

  it('treats all meal slots as complete', () => {
    expect(mealDayState(mealTypeOrder.length)).toBe('complete')
  })

  it('keeps complete stable when records exceed the slot count', () => {
    // 同一天同一餐段只可能有一条记录；超出时仍应视为完成，不回退成 partial。
    expect(mealDayState(mealTypeOrder.length + 1)).toBe('complete')
  })

  it('derives the completion threshold from the slot list instead of a hardcoded three', () => {
    const partialCount = mealTypeOrder.length - 1
    expect(mealDayState(partialCount)).toBe('partial')
    expect(mealDayState(mealTypeOrder.length)).toBe('complete')
  })
})
