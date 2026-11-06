/**
 * 手记卡片的底色分配。
 *
 * 底色只是视觉区分，不承载业务语义，所以不落库、不进备份：
 * 由条目 id 稳定地算出一个色位；同一格里再把撞色的往后顺延一位，
 * 让上下堆叠的卡片一眼能分开，同时保证「同一份数据刷新后颜色不变」。
 */

/** 与 `.daily-note-timeline-card.is-tint-0` … `is-tint-4` 一一对应。 */
export const NOTE_TINT_COUNT = 5

const HASH_MODULO = 1_000_003

/** 条目 id → 0 … NOTE_TINT_COUNT-1，纯函数，空字符串也安全。 */
export function entryTintIndex(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % HASH_MODULO
  }
  return hash % NOTE_TINT_COUNT
}

/**
 * 一格里的几条各用什么底色：先按 id 算，撞上了就顺延一位。
 * 同一格最多显示 3 张、总数不超过色板（5 种），所以一定能错开。
 */
export function bandTintIndexes(ids: string[]): number[] {
  const taken: number[] = []
  return ids.map(id => {
    let index = entryTintIndex(id)
    let guard = 0
    while (taken.includes(index) && guard < NOTE_TINT_COUNT) {
      index = (index + 1) % NOTE_TINT_COUNT
      guard += 1
    }
    taken.push(index)
    return index
  })
}

/** 直接给 className 用的色位类名。 */
export const tintClassOf = (index: number): string => `is-tint-${index}`
