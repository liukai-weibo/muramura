/**
 * 天气的展示换算：WMO 现象码 → 中文 + 图标，日期 → 今天／明天／周几。
 *
 * 全是纯函数，方便直接测；界面只负责摆位置。
 */
export interface WeatherDescriptor {
  label: string
  icon: string
}

const WEATHER_CODES: Record<number, WeatherDescriptor> = {
  0: { label: '晴', icon: '☀️' },
  1: { label: '晴间多云', icon: '🌤️' },
  2: { label: '多云', icon: '⛅' },
  3: { label: '阴', icon: '☁️' },
  45: { label: '雾', icon: '🌫️' },
  48: { label: '雾凇', icon: '🌫️' },
  51: { label: '小毛毛雨', icon: '🌦️' },
  53: { label: '毛毛雨', icon: '🌦️' },
  55: { label: '大毛毛雨', icon: '🌧️' },
  56: { label: '冻毛毛雨', icon: '🌧️' },
  57: { label: '强冻毛毛雨', icon: '🌧️' },
  61: { label: '小雨', icon: '🌧️' },
  63: { label: '中雨', icon: '🌧️' },
  65: { label: '大雨', icon: '🌧️' },
  66: { label: '冻雨', icon: '🌧️' },
  67: { label: '强冻雨', icon: '🌧️' },
  71: { label: '小雪', icon: '🌨️' },
  73: { label: '中雪', icon: '🌨️' },
  75: { label: '大雪', icon: '🌨️' },
  77: { label: '米雪', icon: '🌨️' },
  80: { label: '小阵雨', icon: '🌦️' },
  81: { label: '阵雨', icon: '🌦️' },
  82: { label: '强阵雨', icon: '🌧️' },
  85: { label: '小阵雪', icon: '🌨️' },
  86: { label: '大阵雪', icon: '🌨️' },
  95: { label: '雷阵雨', icon: '⛈️' },
  96: { label: '雷阵雨伴冰雹', icon: '⛈️' },
  99: { label: '强雷暴伴冰雹', icon: '⛈️' },
}

const UNKNOWN_WEATHER: WeatherDescriptor = { label: '天气未知', icon: '·' }

/** 未知码不猜，直接说未知，免得把「小雨」写成「晴」。 */
export function describeWeatherCode(code: number): WeatherDescriptor {
  return WEATHER_CODES[Math.round(code)] ?? UNKNOWN_WEATHER
}

/** 温度一律取整，避免「15.6°」这种多余精度。 */
export const formatTemperature = (value: number): string => `${Math.round(value)}°`

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** `YYYY-MM-DD` → 今天／明天／周几；日期不合法就原样返回。 */
export function weatherDayLabel(date: string, today: string): string {
  if (date === today) return '今天'
  const parsed = parseDate(date)
  const todayParsed = parseDate(today)
  if (parsed && todayParsed) {
    const diff = Math.round((parsed.getTime() - todayParsed.getTime()) / 86_400_000)
    if (diff === 1) return '明天'
    if (diff === 2) return '后天'
    return WEEKDAYS[parsed.getDay()] ?? date
  }
  return date
}

function parseDate(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return undefined
  const [, year, month, day] = match
  const parsed = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** `2026-11-03` → `11/03`，给窄卡片第二位信息用。 */
export function formatMonthDaySlash(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[1]}/${match[2]}` : date
}

/** 上游给的观测时刻是当地时间的 `YYYY-MM-DDTHH:mm`，只取时分显示。 */
export function formatObservedClock(observedAt: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(observedAt)
  return match ? `${match[1]}:${match[2]}` : ''
}

/** 取到数据的时刻 → 「刚刚／N 分钟前／HH:mm」，一眼看出新不新。 */
export function formatFreshness(fetchedAt: string, now = Date.now()): string {
  const at = Date.parse(fetchedAt)
  if (Number.isNaN(at)) return ''
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}
