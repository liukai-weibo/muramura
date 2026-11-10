import type { SleepEntry } from '@knowledge-base/contracts'
import {
  addDays,
  sleepClockLabel,
  sleepDurationLabel,
  sleepDurationMinutes,
} from '@knowledge-base/contracts'

export type HomeSleepState = 'complete' | 'wake-only' | 'bed-only' | 'empty'

export interface HomeSleepSummary {
  state: HomeSleepState
  title: string
  description: string
  lastNight?: { bedAt: string; wakeAt: string; minutes: number }
}

const clock = (iso: string | undefined): string => (iso ? sleepClockLabel(iso) : undefined) ?? '--:--'

/**
 * 首页只看「昨晚 → 今早」这一个窗口：
 * 昨晚的入睡（today-1）配今天的起床，不能用更早的完整夜冒充昨晚。
 */
export function buildHomeSleepSummary(entries: SleepEntry[], today: string): HomeSleepSummary {
  const byDate = new Map(entries.map(entry => [entry.sleepDate, entry]))
  const bedAt = byDate.get(addDays(today, -1))?.bedAt
  const wakeAt = byDate.get(today)?.wakeAt

  if (bedAt && wakeAt) {
    const minutes = sleepDurationMinutes(bedAt, wakeAt)
    if (minutes !== undefined) {
      return {
        state: 'complete',
        title: `${clock(bedAt)} → ${clock(wakeAt)}`,
        description: `${sleepDurationLabel(minutes)} · 昨晚已记录`,
        lastNight: { bedAt, wakeAt, minutes },
      }
    }
  }
  if (wakeAt) return { state: 'wake-only', title: `今早 ${clock(wakeAt)} 起床`, description: '今晚待记录' }
  if (bedAt) return { state: 'bed-only', title: `昨晚 ${clock(bedAt)} 入睡`, description: '起床待补' }
  return { state: 'empty', title: '昨晚还没记录', description: '点一下补上' }
}
