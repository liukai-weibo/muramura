/** 手记的日期一律按东八区算，与后端 `entry_date` 的口径一致。 */
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

export const shanghaiDate = (at: Date = new Date()): string => formatter.format(at)

/** 东八区日期算术：上海无夏令时，直接按天偏移即准确。 */
export const shanghaiDateOffset = (days: number): string => formatter.format(new Date(Date.now() + days * 86_400_000))

export const isShanghaiToday = (date: string): boolean => date === shanghaiDate()

/** `'2026-10-28'` → `'10月28日'`，用于跨天搬移的提示文案。 */
export function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-')
  return month && day ? `${Number(month)}月${Number(day)}日` : date
}
