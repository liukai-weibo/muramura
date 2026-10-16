/**
 * 事件日历的分档逻辑。
 *
 * 状态档位（原五档「今天状态怎么样」）已停止采集：
 * 弹窗不再询问，写入固定为中性值，五档标签与色板一并移除。
 * 日历改为按「当天事件条数」着色，复用三餐日历的对勾体系。
 */

/**
 * 日历按「当天事件条数」着色，不再按状态档位。
 * 三档对勾以绿色实底表达积累程度：
 *   0 条      → none（保持空白）
 *   1–2 条    → one（✓）
 *   3–10 条   → two（✓✓）
 *   11 条及以上 → three（✓✓✓）
 */
export type MoodEventTier = 'none' | 'one' | 'two' | 'three'

export function moodEventTier(entryCount: number): MoodEventTier {
  if (entryCount <= 0) return 'none'
  if (entryCount <= 2) return 'one'
  if (entryCount <= 10) return 'two'
  return 'three'
}

/** 与 tier 对应的对勾数量，供渲染层复用避免重复判断。 */
export function moodEventChecks(tier: MoodEventTier): number {
  return tier === 'none' ? 0 : tier === 'one' ? 1 : tier === 'two' ? 2 : 3
}

export { buildMonthDays, buildMonthGrid, formatLocalDate, todayLocalDate } from '../calendar-utils'
