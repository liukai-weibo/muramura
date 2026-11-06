import { describe, expect, it } from 'vitest'
import {
  describeWeatherCode,
  formatFreshness,
  formatMonthDaySlash,
  formatObservedClock,
  formatTemperature,
  weatherDayLabel,
} from '../apps/client/src/pages/index/features/daily-notes/weather/weather-format'

describe('weather copy', () => {
  it('常见的现象码翻成中文与图标', () => {
    expect(describeWeatherCode(0)).toEqual({ label: '晴', icon: '☀️' })
    expect(describeWeatherCode(3).label).toBe('阴')
    expect(describeWeatherCode(61).label).toBe('小雨')
    expect(describeWeatherCode(75).label).toBe('大雪')
    expect(describeWeatherCode(95).label).toBe('雷阵雨')
  })

  it('没见过的码不瞎猜，说未知', () => {
    for (const code of [7, 11, 42, 118, 999, Number.NaN]) {
      expect(describeWeatherCode(code).label).toBe('天气未知')
    }
  })

  it('温度取整，不显示小数', () => {
    expect(formatTemperature(15.6)).toBe('16°')
    expect(formatTemperature(15.4)).toBe('15°')
    expect(formatTemperature(-0.4)).toBe('0°')
    expect(formatTemperature(-3.6)).toBe('-4°')
  })
})

describe('weather day labels', () => {
  it('今天、明天、后天用词，再往后数周几', () => {
    expect(weatherDayLabel('2026-11-03', '2026-11-03')).toBe('今天')
    expect(weatherDayLabel('2026-11-04', '2026-11-03')).toBe('明天')
    expect(weatherDayLabel('2026-11-05', '2026-11-03')).toBe('后天')
    // 2026-11-09 是周一。
    expect(weatherDayLabel('2026-11-09', '2026-11-03')).toBe('周一')
  })

  it('日期不合法时原样返回，不炸', () => {
    expect(weatherDayLabel('not-a-date', '2026-11-03')).toBe('not-a-date')
    expect(formatMonthDaySlash('2026-11-03')).toBe('11/03')
    expect(formatMonthDaySlash('oops')).toBe('oops')
  })
})

describe('weather clocks', () => {
  it('观测时刻只取时分', () => {
    expect(formatObservedClock('2026-11-03T21:45')).toBe('21:45')
    expect(formatObservedClock('garbage')).toBe('')
  })

  it('更新时间按新旧给一句话', () => {
    const fetchedAt = new Date('2026-11-03T13:00:00.000Z').toISOString()
    const at = Date.parse(fetchedAt)
    expect(formatFreshness(fetchedAt, at + 20_000)).toBe('刚刚更新')
    expect(formatFreshness(fetchedAt, at + 12 * 60_000)).toBe('12 分钟前更新')
    expect(formatFreshness(fetchedAt, at + 3 * 3_600_000)).toBe('3 小时前更新')
    expect(formatFreshness('nonsense')).toBe('')
  })
})
