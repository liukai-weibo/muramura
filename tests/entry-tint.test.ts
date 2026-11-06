import { describe, expect, it } from 'vitest'
import {
  NOTE_TINT_COUNT,
  bandTintIndexes,
  entryTintIndex,
  tintClassOf,
} from '../apps/client/src/pages/index/features/daily-notes/entry-tint'

/** 库里真实的 id 都是 uuid v4，测试用同样的形状。 */
const uuid = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, '0')
  return `8f2c1a4b-9d3e-4f5a-8b6c-${hex}`
}

describe('entry tint', () => {
  it('同一个 id 永远落在同一个色位', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const id = uuid(seed)
      expect(entryTintIndex(id)).toBe(entryTintIndex(id))
      expect(tintClassOf(entryTintIndex(id))).toBe(`is-tint-${entryTintIndex(id)}`)
    }
  })

  it('色位永远落在 0 到 4', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const index = entryTintIndex(uuid(seed))
      expect(Number.isInteger(index)).toBe(true)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(NOTE_TINT_COUNT)
    }
  })

  it('空 id 与异常字符也不会越界', () => {
    expect(entryTintIndex('')).toBe(0)
    for (const id of ['中', 'a', '0', '9f8e7d6c-5b4a-4321-8765-0123456789ab']) {
      const index = entryTintIndex(id)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(NOTE_TINT_COUNT)
    }
  })

  it('一批不同 id 能覆盖全部色位，不会全挤在一种颜色上', () => {
    const seen = new Set<number>()
    for (let seed = 0; seed < 200; seed += 1) seen.add(entryTintIndex(uuid(seed)))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('同一格里的几条一定能错开颜色', () => {
    // 先找出三个天然撞色的 id（同一格最坏的情况），再确认顺延后会分开。
    const sameTint = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(uuid)
      .filter(id => entryTintIndex(id) === entryTintIndex(uuid(0)))
    expect(sameTint.length).toBeGreaterThanOrEqual(3)
    const band = bandTintIndexes(sameTint.slice(0, 3))
    expect(new Set(band).size).toBe(3)
  })

  it('一格最多三条，任何时候都互不相同', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const ids = [uuid(seed), uuid(seed + 1), uuid(seed + 2)]
      const tints = bandTintIndexes(ids)
      expect(tints).toHaveLength(3)
      expect(new Set(tints).size).toBe(3)
      for (const index of tints) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(NOTE_TINT_COUNT)
      }
    }
  })

  it('同一批条目算出来总是同一批颜色（刷新不变）', () => {
    const ids = [uuid(11), uuid(22), uuid(33)]
    expect(bandTintIndexes(ids)).toEqual(bandTintIndexes([...ids]))
  })

  it('空一格不炸', () => {
    expect(bandTintIndexes([])).toEqual([])
    expect(bandTintIndexes([''])).toEqual([0])
  })
})
