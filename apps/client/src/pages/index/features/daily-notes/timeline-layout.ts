import { MINUTES_PER_DAY } from '@knowledge-base/contracts'

/**
 * 时间轴按「每小时一格」排布：中轴左右各一列，左列 00–11 点，右列 12–23 点。
 * 一格就是一段大约的时间，格子本身表达时刻，卡片上不再写时间。
 */
export const TIMELINE_BAND_COUNT = 12
export const TIMELINE_BAND_SIDES = ['am', 'pm'] as const
export type TimelineBandSide = (typeof TIMELINE_BAND_SIDES)[number]

/** 卡片一行字 22px；同格拥挤时压到 16px 仍是一行，再挤就换成「还有 N 条」。 */
export const TIMELINE_CARD_HEIGHT = 22
export const TIMELINE_CARD_MIN_HEIGHT = 16
export const TIMELINE_CARD_GAP = 3
export const TIMELINE_CARD_TIGHT_GAP = 2
/** 格子离行顶留一点，别压住分隔线。 */
export const TIMELINE_BAND_PADDING = 2
/** 一格里放不下时，最后那块「还有 N 条」的高度。 */
export const TIMELINE_MORE_HEIGHT = 14

export const clampMinute = (minute: number): number => Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minute)))
export const hourOfMinute = (minute: number): number => Math.floor(clampMinute(minute) / 60)
export const minuteOfHour = (minute: number): number => clampMinute(minute) % 60

export const bandSideOfHour = (hour: number): TimelineBandSide => (hour >= 12 ? 'pm' : 'am')
export const bandRowOfHour = (hour: number): number => Math.min(23, Math.max(0, Math.floor(hour))) % TIMELINE_BAND_COUNT
export const bandHourOf = (row: number, side: TimelineBandSide): number =>
  (Math.min(TIMELINE_BAND_COUNT - 1, Math.max(0, Math.floor(row))) + (side === 'pm' ? 12 : 0))
export const bandKey = (side: TimelineBandSide, row: number): string => `${side}-${row}`

export interface BandPosition {
  hour: number
  side: TimelineBandSide
  row: number
  key: string
}

/** 当天分钟数 → 落在哪个格子。 */
export function bandOfMinute(minute: number): BandPosition {
  const hour = hourOfMinute(minute)
  const side = bandSideOfHour(hour)
  const row = bandRowOfHour(hour)
  return { hour, side, row, key: bandKey(side, row) }
}

/** 一屏 12 行，行高就是可用高度除以 12。 */
export const bandRowHeight = (height: number): number => Math.max(1, height) / TIMELINE_BAND_COUNT

/** 纵向偏移 → 行号，越界夹到首尾行（拖拽落点用）。 */
export const bandRowAt = (offsetY: number, rowHeight: number): number =>
  Math.min(
    TIMELINE_BAND_COUNT - 1,
    Math.max(0, Math.floor(offsetY / Math.max(rowHeight, 1e-6))),
  )

export interface BandCardLayout {
  cardHeight: number
  gap: number
  /** 这一格显示几张卡片。 */
  visible: number
  /** 显示不下、折进「还有 N 条」的条数。 */
  hidden: number
}

/**
 * 一格里的卡片怎么摆：先按 22px 正常排；排不下就把间距收到 2px、卡片压到 18/16px；
 * 连 16px 都放不下时保留尽可能多的卡片，剩下的折进「还有 N 条」，绝不越出格子。
 */
export function bandLayout(count: number, rowHeight: number): BandCardLayout {
  const total = Math.max(0, Math.floor(count))
  const usable = Math.max(1, rowHeight - TIMELINE_BAND_PADDING)
  if (total === 0) return { cardHeight: TIMELINE_CARD_HEIGHT, gap: TIMELINE_CARD_GAP, visible: 0, hidden: 0 }

  // 16px + 2px 间距下最多能塞几张，这是「全都显示」的上限。
  const maxFull = Math.max(
    1,
    Math.floor((usable + TIMELINE_CARD_TIGHT_GAP) / (TIMELINE_CARD_MIN_HEIGHT + TIMELINE_CARD_TIGHT_GAP)),
  )
  if (total <= maxFull) {
    const gap = total > 1 ? TIMELINE_CARD_TIGHT_GAP : TIMELINE_CARD_GAP
    const fit = Math.floor((usable - (total - 1) * gap) / total)
    return {
      cardHeight: Math.min(TIMELINE_CARD_HEIGHT, Math.max(TIMELINE_CARD_MIN_HEIGHT, fit)),
      gap,
      visible: total,
      hidden: 0,
    }
  }

  // 放不下：卡片统一压到最小高度，末尾再留一块「还有 N 条」。
  let visible = 0
  for (let candidate = maxFull; candidate >= 0; candidate -= 1) {
    const used = candidate * TIMELINE_CARD_MIN_HEIGHT + candidate * TIMELINE_CARD_TIGHT_GAP + TIMELINE_MORE_HEIGHT
    if (candidate === 0 || used <= usable) { visible = candidate; break }
  }
  return {
    cardHeight: TIMELINE_CARD_MIN_HEIGHT,
    gap: TIMELINE_CARD_TIGHT_GAP,
    visible,
    hidden: total - visible,
  }
}

/** 第 index 张卡片在格子里的顶边偏移。 */
export const bandCardTop = (index: number, layout: BandCardLayout): number =>
  TIMELINE_BAND_PADDING + Math.max(0, index) * (layout.cardHeight + layout.gap)

/** 「还有 N 条」那块小片在格子里的顶边偏移：紧跟最后一张卡片。 */
export const bandMoreTop = (layout: BandCardLayout): number => bandCardTop(layout.visible, layout)

export interface BandEntry {
  id: string
  minute: number
}

/** 按格子归组，格子内按分钟、再按 id 排序。 */
export function groupByBand<T extends BandEntry>(entries: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  const ordered = [...entries].sort((left, right) => left.minute - right.minute || left.id.localeCompare(right.id))
  for (const entry of ordered) {
    const key = bandOfMinute(entry.minute).key
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }
  return groups
}
