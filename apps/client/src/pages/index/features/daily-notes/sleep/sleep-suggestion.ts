import type { DailyNoteEntry } from '@knowledge-base/contracts'
import { dailyNoteClock } from '@knowledge-base/contracts'

export interface ClockSuggestion { hour: number; minute: number; nextDay?: boolean }

export interface SleepSuggestion {
  wake?: ClockSuggestion
  bed?: ClockSuggestion
}

/**
 * 从手记时间推断「当天几点起、当晚几点睡」。
 *
 * 只作为弹窗里的可选建议，推断结果永远不直接落库：
 * - 起床：当天 04:00–12:00 的第一条；
 * - 入睡：当天 18:00–24:00 与次日 00:00–04:00 中最晚的一条。
 *
 * 当天 00:00–04:00 属于前一晚的睡眠（会落到前一天的记录），不能当作当天入睡，
 * 所以这里刻意不读当天凌晨；次日凌晨会带 `nextDay: true`，保存时落到 D+1。
 * 手记是自由文本，没有睡眠语义，所以只取时刻、不做内容判断。
 */
export function inferSleepFromDay(entries: DailyNoteEntry[], nextDayEntries: DailyNoteEntry[] = []): SleepSuggestion {
  const dayClocks = clocksOf(entries)
  const nextClocks = clocksOf(nextDayEntries)

  const wakeClock = dayClocks
    .filter(clock => clock.hour >= 4 && clock.hour <= 12)
    .sort((left, right) => (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute))[0]

  const sameDayEvening = dayClocks
    .filter(clock => clock.hour >= 18)
    .sort((left, right) => (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute))
  const nextDayEarly = nextClocks
    .filter(clock => clock.hour < 4)
    .sort((left, right) => (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute))

  // 次日 00–04 一定晚于当天 18–24；两边都有时取次日凌晨的最后一条。
  const bedClock = nextDayEarly.length
    ? nextDayEarly[nextDayEarly.length - 1]
    : sameDayEvening[sameDayEvening.length - 1]

  return {
    ...(wakeClock ? { wake: { hour: wakeClock.hour, minute: wakeClock.minute } } : {}),
    ...(bedClock
      ? { bed: { hour: bedClock.hour, minute: bedClock.minute, ...(nextDayEarly.length ? { nextDay: true } : {}) } }
      : {}),
  }
}

function clocksOf(entries: DailyNoteEntry[]): Array<{ hour: number; minute: number }> {
  return entries
    .map(entry => dailyNoteClock(entry.recordedAt))
    .filter((clock): clock is NonNullable<ReturnType<typeof dailyNoteClock>> => Boolean(clock))
}
