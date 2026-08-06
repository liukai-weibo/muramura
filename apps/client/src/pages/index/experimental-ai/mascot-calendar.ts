import { Solar } from 'lunar-javascript'

export type MascotTimePeriod = 'morning' | 'noon' | 'afternoon' | 'night'
export type MascotDayType = 'workday' | 'weekend'

export interface MascotCalendarContext {
  dateKey: string
  timePeriod: MascotTimePeriod
  dayType: MascotDayType
  holidayKeys: string[]
}

const pad = (value: number) => String(value).padStart(2, '0')

export function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function getMascotTimePeriod(hour: number): MascotTimePeriod {
  if (hour >= 6 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 19) return 'afternoon'
  return 'night'
}

function addIfDateMatches(target: string[], key: string, month: number, day: number, date: Date) {
  if (date.getMonth() + 1 === month && date.getDate() === day) target.push(key)
}

function getLunarHolidayKeys(date: Date): string[] {
  try {
    const lunar = Solar.fromDate(date).getLunar()
    const month = lunar.getMonth()
    const day = lunar.getDay()
    const keys: string[] = []
    if (month === 1 && day === 1) keys.push('springFestival')
    if (month === 1 && day === 15) keys.push('lanternFestival')
    if (month === 5 && day === 5) keys.push('dragonBoatFestival')
    if (month === 7 && day === 7) keys.push('qixi')
    if (month === 8 && day === 15) keys.push('midAutumnFestival')

    const jieQi = lunar.getJieQi()
    if (jieQi === '清明') keys.push('qingming')
    if (jieQi === '冬至') keys.push('winterSolstice')
    return keys
  } catch {
    return []
  }
}

export function getMascotHolidayKeys(date: Date): string[] {
  const keys: string[] = []
  addIfDateMatches(keys, 'newYear', 1, 1, date)
  addIfDateMatches(keys, 'laborDay', 5, 1, date)
  addIfDateMatches(keys, 'nationalDay', 10, 1, date)
  addIfDateMatches(keys, 'christmas', 12, 25, date)
  return [...keys, ...getLunarHolidayKeys(date)]
}

export function getMascotCalendarContext(date = new Date()): MascotCalendarContext {
  const weekday = date.getDay()
  return {
    dateKey: getLocalDateKey(date),
    timePeriod: getMascotTimePeriod(date.getHours()),
    dayType: weekday === 0 || weekday === 6 ? 'weekend' : 'workday',
    holidayKeys: getMascotHolidayKeys(date),
  }
}
