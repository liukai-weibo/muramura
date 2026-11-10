import type { DailyNoteEntry } from '@knowledge-base/contracts'
import { dailyNoteClock } from '@knowledge-base/contracts'

export interface ClockSuggestion { hour: number; minute: number }

export interface SleepSuggestion {
  wake?: ClockSuggestion
  bed?: ClockSuggestion
}

/**
 * 从同一天的手记时间推断「当天几点起、当晚几点睡」。
 *
 * 只作为弹窗里的可选建议，推断结果永远不直接落库：
 * 当天 04:00–12:00 的第一条 → 起床；当天 18:00–次日 04:00 的最后一条 → 入睡
 * （凌晨 00:00–04:00 按「次日」排在 18:00 之后）。
 * 手记是自由文本，没有睡眠语义，所以只取时刻、不做内容判断。
 */
export function inferSleepFromDay(entries: DailyNoteEntry[]): SleepSuggestion {
  const clocks = entries
    .map(entry => dailyNoteClock(entry.recordedAt))
    .filter((clock): clock is NonNullable<ReturnType<typeof dailyNoteClock>> => Boolean(clock))
    .sort((left, right) => (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute))

  const morning = clocks.filter(clock => clock.hour >= 4 && clock.hour <= 12)
  const evening = clocks
    .filter(clock => clock.hour >= 18 || clock.hour < 4)
    .sort((left, right) => eveningScore(left) - eveningScore(right))

  const wakeClock = morning[0]
  const bedClock = evening[evening.length - 1]
  return {
    ...(wakeClock ? { wake: { hour: wakeClock.hour, minute: wakeClock.minute } } : {}),
    ...(bedClock ? { bed: { hour: bedClock.hour, minute: bedClock.minute } } : {}),
  }
}

/** 18:00–24:00 记 0–6 小时，00:00–04:00 记 24–28 小时，保证凌晨排在深夜之后。 */
function eveningScore(clock: { hour: number; minute: number }): number {
  const minute = clock.hour * 60 + clock.minute
  return clock.hour < 4 ? minute + 24 * 60 : minute
}
