/**
 * 服务端日期工具（纯 UTC 运算，与进程本地时区无关）。
 * 用于“不能晚于今天”类校验的上界：客户端与服务器可能处于不同时区，
 * 用服务器本地时区判定“今天”会在凌晨窗口（东八区 00:00~07:59 = UTC 前一天）
 * 把用户当天记录误判为未来日期。
 */

/** UTC 当前日期串 YYYY-MM-DD。 */
export function utcDateToday(): string {
  const now = new Date()
  const day = String(now.getUTCDate()).padStart(2, '0')
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}-${day}`
}

/** UTC 当前日期偏移 offsetDays 天后的日期串 YYYY-MM-DD（Date.UTC 构造，避免 DST 干扰）。 */
export function utcDatePlusDays(offsetDays: number): string {
  const now = new Date()
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const shifted = new Date(base + offsetDays * 86_400_000)
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

/**
 * ISO 时间串转指定时区 HH:mm（24 小时制）。
 * timeZone 缺失或非法时回退服务器进程本地时区；iso 无效时返回空串。
 */
export function formatInTimeZone(iso: string | undefined, timeZone?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }
  try {
    return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone }).format(date).replace(/^24:/, '00:')
  } catch {
    return new Intl.DateTimeFormat('zh-CN', options).format(date).replace(/^24:/, '00:')
  }
}

/**
 * 当前时间锚点文本（AI prompt 使用），按指定时区生成；timeZone 缺失回退服务器本地。
 * 例：现在是 2026-08-27 星期四 13:20（用户本地时区 Asia/Shanghai）
 */
export function formatAnchorPrompt(timeZone?: string): string {
  const now = new Date()
  const render = (tz?: string): string => {
    try {
      return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(now)
    } catch {
      return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    }
  }
  const tz = timeZone?.trim()
  return `现在是 ${tz ? render(tz) : render()}${tz ? `（用户本地时区 ${tz}）` : ''}`
}
