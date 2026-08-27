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
