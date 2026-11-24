import type { SleepApplicationService } from './sleep'
import { addDays, dailyNoteClock } from '@knowledge-base/contracts'

/**
 * 手记里写「起床」/「睡觉」时自动补睡眠记录：
 * - 起床：按当天最早的一次算（03:00 起，更早的不当成起床），更晚的记录不覆盖已有的更早值；
 * - 睡觉：按 20:00→次日 12:00 最晚的一次算，更早的记录不覆盖已有的更晚值。
 * 时间取这条手记的时间（recordedAt），不是正文里的数字。
 */
export type SleepKeyword = 'wake' | 'bed'

export function parseSleepKeyword(content: string): SleepKeyword | undefined {
  const hasWake = content.includes('起床')
  const hasBed = content.includes('睡觉')
  if (hasWake === hasBed) return undefined
  return hasWake ? 'wake' : 'bed'
}

const WAKE_EARLIEST_MINUTE = 3 * 60
const BED_WINDOW_START_MINUTE = 20 * 60
const BED_WINDOW_END_MINUTE = 12 * 60

export class SleepNoteSyncService {
  constructor(private readonly sleep: Pick<SleepApplicationService, 'listRange' | 'save'>) {}

  async syncFromNote(content: string, recordedAt: string): Promise<void> {
    const keyword = parseSleepKeyword(content)
    if (!keyword) return
    const clock = dailyNoteClock(recordedAt)
    if (!clock) return
    const minute = clock.hour * 60 + clock.minute
    const at = Date.parse(recordedAt)
    if (Number.isNaN(at)) return

    if (keyword === 'wake') {
      if (minute < WAKE_EARLIEST_MINUTE) return
      const existing = (await this.sleep.listRange(clock.date, clock.date))[0]
      if (existing?.wakeAt && Date.parse(existing.wakeAt) <= at) return
      await this.sleep.save(clock.date, { wakeAt: recordedAt })
      return
    }

    if (minute >= BED_WINDOW_END_MINUTE && minute < BED_WINDOW_START_MINUTE) return
    const sleepDate = minute >= BED_WINDOW_START_MINUTE ? clock.date : addDays(clock.date, -1)
    const existing = (await this.sleep.listRange(sleepDate, sleepDate))[0]
    if (existing?.bedAt && Date.parse(existing.bedAt) >= at) return
    await this.sleep.save(sleepDate, { bedAt: recordedAt })
  }
}
