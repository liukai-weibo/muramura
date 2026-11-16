/** 长期探索置顶是按账户隔离的本机显示偏好，不修改业务更新时间。 */
export const explorationPinStorageKey = (userId: string): string =>
  `marumaru.exploration-pins.v1.${encodeURIComponent(userId)}`

export function parseExplorationPins(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : []
  } catch { return [] }
}

export function toggleExplorationPin(pinnedIds: readonly string[], id: string): string[] {
  return pinnedIds.includes(id) ? pinnedIds.filter(value => value !== id) : [id, ...pinnedIds]
}

/** 置顶组按置顶次序排列，其余项保持服务端顺序；先排序再分页。 */
export function orderPinnedExplorations<T extends { track: { id: string } }>(
  entries: readonly T[],
  pinnedIds: readonly string[],
): T[] {
  const ranks = new Map(pinnedIds.map((id, index) => [id, index]))
  return entries.map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const a = ranks.get(left.entry.track.id)
      const b = ranks.get(right.entry.track.id)
      if (a !== undefined && b !== undefined) return a - b
      if (a !== undefined) return -1
      if (b !== undefined) return 1
      return left.index - right.index
    })
    .map(({ entry }) => entry)
}
