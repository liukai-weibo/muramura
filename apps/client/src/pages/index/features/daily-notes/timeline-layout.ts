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
/** 格内可以并排两列：侧宽低于它，每列不足 146px（约 9 个字），退回单列满宽。 */
export const TIMELINE_MIN_TWO_COLUMN_WIDTH = 300
/** 两列之间留 4px 缝隙，卡片各自再让 2px。 */
export const TIMELINE_COLUMN_GUTTER = 4

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
  columns: 1 | 2
  /** 每列最多几张。 */
  rows: number
  cardHeight: number
  gap: number
  /** 这一格显示几张卡片。 */
  visible: number
  /** 显示不下、折进「还有 N 条」的条数。 */
  hidden: number
}

export const bandColumns = (sideWidth: number): 1 | 2 =>
  sideWidth > 0 && sideWidth < TIMELINE_MIN_TWO_COLUMN_WIDTH ? 1 : 2

const CARD_HEIGHT_STEPS = [TIMELINE_CARD_HEIGHT, 20, 18, TIMELINE_CARD_MIN_HEIGHT]
const gapForRows = (rows: number): number => (rows > 1 ? TIMELINE_CARD_TIGHT_GAP : TIMELINE_CARD_GAP)

/** 两列时先填靠轴列，再填外侧列；折叠条占剩下的最后一格。 */
export function bandLayout(count: number, rowHeight: number, columns: 1 | 2 = 2): BandCardLayout {
  const total = Math.max(0, Math.floor(count))
  const usable = Math.max(1, rowHeight - TIMELINE_BAND_PADDING)
  if (total === 0) return { columns, rows: 0, cardHeight: TIMELINE_CARD_HEIGHT, gap: TIMELINE_CARD_GAP, visible: 0, hidden: 0 }

  const neededRows = Math.ceil(total / columns)
  const gap = gapForRows(neededRows)
  for (const cardHeight of CARD_HEIGHT_STEPS) {
    if (neededRows * cardHeight + (neededRows - 1) * gap <= usable) {
      return { columns, rows: neededRows, cardHeight, gap, visible: total, hidden: 0 }
    }
  }

  const tightGap = TIMELINE_CARD_TIGHT_GAP
  const maxRows = Math.max(1, Math.floor((usable + tightGap) / (TIMELINE_CARD_MIN_HEIGHT + tightGap)))
  const capacity = columns * maxRows
  const visible = Math.min(total, Math.max(0, capacity - 1))
  return { columns, rows: maxRows, cardHeight: TIMELINE_CARD_MIN_HEIGHT, gap: tightGap, visible, hidden: total - visible }
}

export interface BandSlot {
  column: number
  row: number
}

/** 按列填充：靠轴一列从上往下，再填外侧列。 */
export function bandSlot(index: number, layout: BandCardLayout): BandSlot {
  const rows = Math.max(1, layout.rows)
  const position = Math.max(0, Math.floor(index))
  return { column: Math.floor(position / rows), row: position % rows }
}

/** 第 index 张卡片在格子里的顶边偏移。 */
export const bandCardTop = (index: number, layout: BandCardLayout): number =>
  TIMELINE_BAND_PADDING + bandSlot(index, layout).row * (layout.cardHeight + layout.gap)

/** 折叠条紧跟最后一张卡片，落在它的下一个栅格槽位。 */
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
