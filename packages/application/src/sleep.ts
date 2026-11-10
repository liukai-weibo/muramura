import type {
  ActivityAuditRecorder,
  SleepEntry,
  SleepEntryPatch,
  SleepRepository,
  SleepSettings,
  SleepSettingsWriteInput,
} from '@knowledge-base/contracts'
import {
  SLEEP_FUTURE_TOLERANCE_MINUTES,
  SLEEP_INPUT_PRECISIONS,
  SLEEP_NOTE_MAX_LENGTH,
  addDays,
  isWithinSleepFutureTolerance,
  isValidSleepBed,
  isValidSleepRemindWindow,
  isValidSleepWake,
  sleepClockLabel,
  sleepDayOf,
} from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const FUTURE_MESSAGE = `时间最多可以比现在晚 ${SLEEP_FUTURE_TOLERANCE_MINUTES} 分钟`

function invalid(message: string): BusinessError {
  return new BusinessError('SLEEP_ENTRY_INVALID', message)
}

function clockLabel(iso: string): string {
  return sleepClockLabel(iso) ?? iso
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function requireDate(value: string, label: string): void {
  if (!DATE_PATTERN.test(value)) throw invalid(`${label}格式无效`)
}

export interface SleepSaveResult {
  deleted: boolean
  entry?: SleepEntry
}

export class SleepApplicationService {
  constructor(private readonly repository: SleepRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  listRange(from?: string, to?: string): Promise<SleepEntry[]> {
    return this.repository.listRange(from, to)
  }

  /**
   * 合并写入一天：字段缺省保留、null 清除、字符串设置。
   * 两个字段都清空时删除整行，避免留下占位空记录。
   */
  async save(sleepDate: string, patch: SleepEntryPatch): Promise<SleepSaveResult> {
    requireDate(sleepDate, '日期')
    const today = sleepDayOf(new Date().toISOString())
    if (today && sleepDate > today) throw invalid('睡眠日期不能晚于今天')

    const existing = await this.repository.getByDate(sleepDate)

    const nextWake = patch.wakeAt === undefined
      ? existing?.wakeAt
      : patch.wakeAt === null ? undefined : patch.wakeAt
    const nextBed = patch.bedAt === undefined
      ? existing?.bedAt
      : patch.bedAt === null ? undefined : patch.bedAt
    const nextNoteRaw = patch.note === undefined ? existing?.note : patch.note ?? undefined
    const nextNote = typeof nextNoteRaw === 'string' ? nextNoteRaw.trim() : undefined

    if (nextWake !== undefined) {
      if (!isIsoTimestamp(nextWake)) throw invalid('起床时间无效')
      if (!isValidSleepWake(sleepDate, nextWake)) throw invalid('起床时间必须落在当天')
      if (!isWithinSleepFutureTolerance(nextWake)) throw invalid(FUTURE_MESSAGE)
      // 起床不能早于前晚入睡；相等表示 0 小时。
      const previous = await this.repository.getByDate(addDays(sleepDate, -1))
      if (previous?.bedAt) {
        if (Date.parse(nextWake) < Date.parse(previous.bedAt)) {
          throw invalid(`今天 ${clockLabel(previous.bedAt)} 才睡，起床不能早于 ${clockLabel(previous.bedAt)}`)
        }
        if (Date.parse(nextWake) - Date.parse(previous.bedAt) > 18 * 60 * 60 * 1000) {
          throw invalid('睡眠跨度不能超过 18 小时')
        }
      }
    }
    if (nextBed !== undefined) {
      if (!isIsoTimestamp(nextBed)) throw invalid('入睡时间无效')
      if (!isValidSleepBed(sleepDate, nextBed, nextWake)) {
        throw invalid(nextWake
          ? `入睡不能早于当天 ${clockLabel(nextWake)} 的起床`
          : '没有起床记录时，入睡只能记在当天')
      }
      if (!isWithinSleepFutureTolerance(nextBed)) throw invalid(FUTURE_MESSAGE)
      // 回头补记入睡时，也要早于次日已记录的起床。
      const following = await this.repository.getByDate(addDays(sleepDate, 1))
      if (following?.wakeAt) {
        if (Date.parse(nextBed) > Date.parse(following.wakeAt)) {
          throw invalid(`次日 ${clockLabel(following.wakeAt)} 已记起床，入睡不能晚于 ${clockLabel(following.wakeAt)}`)
        }
        if (Date.parse(following.wakeAt) - Date.parse(nextBed) > 18 * 60 * 60 * 1000) {
          throw invalid('睡眠跨度不能超过 18 小时')
        }
      }
    }
    if (nextNote !== undefined && nextNote.length > SLEEP_NOTE_MAX_LENGTH) {
      throw invalid(`备注不能超过 ${SLEEP_NOTE_MAX_LENGTH} 个字符`)
    }

    if (nextWake === undefined && nextBed === undefined) {
      const removed = await this.repository.remove(sleepDate)
      if (removed) {
        await safeAuditRecord(this.auditRecorder, {
          module: 'sleep',
          action: 'delete',
          snapshot: JSON.stringify({ sleepDate }),
        })
      }
      return { deleted: removed }
    }

    const saved = await this.repository.write(sleepDate, {
      ...(nextWake !== undefined ? { wakeAt: nextWake } : {}),
      ...(nextBed !== undefined ? { bedAt: nextBed } : {}),
      ...(nextNote !== undefined ? { note: nextNote } : {}),
    })
    await safeAuditRecord(this.auditRecorder, {
      module: 'sleep',
      action: 'update',
      entityId: saved.id,
      snapshot: JSON.stringify({
        sleepDate: saved.sleepDate,
        wakeAt: saved.wakeAt ?? null,
        bedAt: saved.bedAt ?? null,
        note: saved.note ?? null,
      }),
    })
    return { deleted: false, entry: saved }
  }

  async remove(sleepDate: string): Promise<boolean> {
    requireDate(sleepDate, '日期')
    const removed = await this.repository.remove(sleepDate)
    if (removed) {
      await safeAuditRecord(this.auditRecorder, {
        module: 'sleep',
        action: 'delete',
        snapshot: JSON.stringify({ sleepDate }),
      })
    }
    return removed
  }

  getSettings(): Promise<SleepSettings> {
    return this.repository.getSettings()
  }

  async saveSettings(input: SleepSettingsWriteInput): Promise<SleepSettings> {
    if (!input || typeof input !== 'object') throw invalid('睡眠设置格式无效')
    if (typeof input.remindEnabled !== 'boolean') throw invalid('提醒开关无效')
    if (!isValidSleepRemindWindow(input.remindStartMinute, input.remindEndMinute)) {
      throw invalid('提醒时间段无效：开始时间必须早于结束时间，且不能跨天')
    }
    if (!SLEEP_INPUT_PRECISIONS.includes(input.inputPrecision)) throw invalid('输入精度无效')
    return this.repository.saveSettings(input)
  }

  async acknowledgeReminder(date: string): Promise<SleepSettings> {
    requireDate(date, '日期')
    return this.repository.ackReminder(date)
  }
}
