/**
 * 睡眠契约：一条记录只描述「同一天」。
 *
 * - `sleepDate = D`：D 早上的起床（wakeAt）+ D 晚上的入睡（bedAt）。
 * - 两个字段都可以为空，但至少有一个；只记起床或只记入睡都合法。
 * - 入睡允许落在次日凌晨（00:00–11:59），避免凌晨 1 点睡的人被迫记到后一天。
 * - 「一夜」= bed(D) + wake(D+1)，在图表上标为 D 日的睡眠，跨天只发生在展示层。
 * - 库里存 UTC，日界与时刻判定统一按 Asia/Shanghai。
 */

import { dailyNoteClock } from './daily-notes'

export const SLEEP_INPUT_PRECISIONS = ['hour', 'minute'] as const
export type SleepInputPrecision = (typeof SLEEP_INPUT_PRECISIONS)[number]

export const SLEEP_DEFAULT_REMIND_START_MINUTE = 12 * 60
export const SLEEP_DEFAULT_REMIND_END_MINUTE = 23 * 60 + 30

export const SLEEP_MIN_DURATION_MINUTES = 60
export const SLEEP_MAX_DURATION_MINUTES = 18 * 60
export const SLEEP_NOTE_MAX_LENGTH = 200

/** 午夜前后记录时允许的轻微未来时间：最多比现在晚 60 分钟。 */
export const SLEEP_FUTURE_TOLERANCE_MINUTES = 60

/** 记录时间是否可以略微晚于当前时间（用于 23:30 记 00:00 这类场景）。 */
export function isWithinSleepFutureTolerance(iso: string, now = Date.now()): boolean {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return false
  return time <= now + SLEEP_FUTURE_TOLERANCE_MINUTES * 60 * 1000
}

/** 图表纵轴：18:00 → 次日 12:00，时间自上而下流动，共 18 小时。 */
export const SLEEP_AXIS_START_MINUTE = 18 * 60
export const SLEEP_AXIS_MINUTES = 18 * 60
/** 00:00 在纵轴上的位置（18:00 起算 6 小时）。 */
export const SLEEP_MIDNIGHT_AXIS_MINUTE = 6 * 60

export interface SleepEntry {
  id: string
  /** 东八区日期 YYYY-MM-DD，记录所属的那一天。 */
  sleepDate: string
  /** 当天起床时刻（UTC ISO），00:00–11:59。 */
  wakeAt?: string
  /** 当晚入睡时刻（UTC ISO），当天 12:00–23:59 或次日 00:00–11:59。 */
  bedAt?: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** 写入补丁：字段缺省=保留原值，null=清除，字符串=设置为该时刻。 */
export interface SleepEntryPatch {
  wakeAt?: string | null
  bedAt?: string | null
  note?: string | null
}

export interface SleepSettings {
  remindEnabled: boolean
  remindStartMinute: number
  remindEndMinute: number
  inputPrecision: SleepInputPrecision
  lastPromptedDate?: string
}

export interface SleepSettingsWriteInput {
  remindEnabled: boolean
  remindStartMinute: number
  remindEndMinute: number
  inputPrecision: SleepInputPrecision
}

export interface SleepRepository {
  listRange(from?: string, to?: string): Promise<SleepEntry[]>
  /** 按日期取单行，用于合并写入。 */
  getByDate(sleepDate: string): Promise<SleepEntry | undefined>
  /** 整体写入两个字段（null 表示清空）。 */
  write(sleepDate: string, values: { wakeAt?: string; bedAt?: string; note?: string }): Promise<SleepEntry>
  remove(sleepDate: string): Promise<boolean>
  getSettings(): Promise<SleepSettings>
  saveSettings(input: SleepSettingsWriteInput): Promise<SleepSettings>
  ackReminder(date: string): Promise<SleepSettings>
}

export interface SleepBackupStore {
  exportBackup(): Promise<SleepEntry[]>
  replaceBackup(values: SleepEntry[]): Promise<void>
}

export const SLEEP_DEFAULT_SETTINGS: SleepSettings = {
  remindEnabled: true,
  remindStartMinute: SLEEP_DEFAULT_REMIND_START_MINUTE,
  remindEndMinute: SLEEP_DEFAULT_REMIND_END_MINUTE,
  inputPrecision: 'hour',
}

function parseIso(value: string): Date | undefined {
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? undefined : at
}

/** 东八区日期加减天数（纯日期字符串运算，不依赖进程时区）。 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** 时刻的东八区日期。 */
export function sleepDayOf(iso: string): string | undefined {
  return dailyNoteClock(iso)?.date
}

export function sleepClockLabel(iso: string): string | undefined {
  return dailyNoteClock(iso)?.label
}

/** 本地某天 HH:MM → UTC ISO。 */
export function sleepIsoAt(date: string, hour: number, minute: number): string | undefined {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return undefined
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000).toISOString()
}

/** 起床只要落在当天即可；跨天的先后关系由应用层结合前晚入睡校验。 */
export function isValidSleepWake(sleepDate: string, wakeAt: string): boolean {
  const clock = dailyNoteClock(wakeAt)
  return Boolean(clock && clock.date === sleepDate)
}

/**
 * 入睡的合法性取决于当天起床：
 * - 有起床：不早于起床，可以落在当天或次日（相等表示 0 小时）；
 * - 无起床：只能落在当天（没有参照物，不做顺延）。
 */
export function isValidSleepBed(sleepDate: string, bedAt: string, wakeAt?: string): boolean {
  const clock = dailyNoteClock(bedAt)
  if (!clock) return false
  if (!wakeAt) return clock.date === sleepDate
  if (clock.date !== sleepDate && clock.date !== addDays(sleepDate, 1)) return false
  return Date.parse(bedAt) >= Date.parse(wakeAt)
}

/** 当天分钟数（0..1439）。 */
export function sleepMinuteOfDay(iso: string): number | undefined {
  const clock = dailyNoteClock(iso)
  return clock ? clock.hour * 60 + clock.minute : undefined
}

/**
 * 根据「起床时刻」推导入睡的归属日：
 * 晚于起床 → 当天；早于或等于 → 次日（等于时由调用方报错，不静默吞掉）。
 */
export function bedDateForWake(sleepDate: string, bedMinuteOfDay: number, wakeMinuteOfDay?: number): string {
  if (wakeMinuteOfDay === undefined) return sleepDate
  return bedMinuteOfDay >= wakeMinuteOfDay ? sleepDate : addDays(sleepDate, 1)
}

/** 一夜时长（分钟）：入睡在前、起床在后且合法才返回数字。 */
export function sleepDurationMinutes(bedAt: string, wakeAt: string): number | undefined {
  const bed = parseIso(bedAt)
  const wake = parseIso(wakeAt)
  if (!bed || !wake || wake.getTime() <= bed.getTime()) return undefined
  const minutes = Math.round((wake.getTime() - bed.getTime()) / 60_000)
  return minutes >= SLEEP_MIN_DURATION_MINUTES && minutes <= SLEEP_MAX_DURATION_MINUTES ? minutes : undefined
}

/** 时长文案：`7h30m`；整小时省略分钟。 */
export function sleepDurationLabel(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h${String(rest).padStart(2, '0')}m` : `${hours}h`
}

/** 纵轴坐标：18:00 → 0，次日 12:00 → 1080（越界夹到端点）。 */
export function sleepAxisMinute(iso: string): number | undefined {
  const clock = dailyNoteClock(iso)
  if (!clock) return undefined
  let minute = clock.hour * 60 + clock.minute - SLEEP_AXIS_START_MINUTE
  if (minute < 0) minute += 24 * 60
  return Math.min(SLEEP_AXIS_MINUTES, Math.max(0, minute))
}

/** 本地分钟数 → HH:MM。 */
export function minuteOfDayLabel(minute: number): string {
  const safe = Math.min(1439, Math.max(0, Math.round(minute)))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/** 提醒窗口是否合法：同日区间，开始早于结束。 */
export function isValidSleepRemindWindow(startMinute: number, endMinute: number): boolean {
  return Number.isInteger(startMinute) && Number.isInteger(endMinute)
    && startMinute >= 0 && endMinute <= 1439 && startMinute < endMinute
}

export interface SleepPromptInput {
  nowMinute: number
  today: string
  entry?: SleepEntry
  settings: SleepSettings
}

/**
 * 打开应用/网页时是否提醒补记「今天几点起床」。
 * 入睡不催：晚上补记的摩擦小，早上容易忘；当天已提醒/关闭过就不再弹。
 */
export function shouldPromptSleep({ nowMinute, today, entry, settings }: SleepPromptInput): boolean {
  if (!settings.remindEnabled) return false
  if (settings.lastPromptedDate === today) return false
  if (!Number.isInteger(nowMinute) || nowMinute < 0 || nowMinute > 1439) return false
  if (nowMinute < settings.remindStartMinute || nowMinute > settings.remindEndMinute) return false
  if (entry?.wakeAt) return false
  return true
}
