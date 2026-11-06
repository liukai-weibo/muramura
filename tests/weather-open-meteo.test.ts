import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWeatherCache,
  fetchWeatherForecast,
  normalizeCities,
  normalizeForecast,
  searchWeatherCities,
} from '../apps/api/src/weather/open-meteo'

/** 上游真实返回的裁剪版：字段名与嵌套层级保持一致。 */
const forecastPayload = {
  latitude: 30.25,
  longitude: 120.125,
  timezone: 'Asia/Shanghai',
  current: { time: '2026-11-03T21:45', interval: 900, temperature_2m: 15.6, weather_code: 81 },
  daily: {
    time: ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'],
    weather_code: [81, 3, 61, 0, 2, 45, 95],
    temperature_2m_max: [18.4, 19.1, 16.2, 17.8, 20.3, 21.1, 18.7],
    temperature_2m_min: [12.1, 11.4, 10.8, 9.9, 12.6, 13.4, 12.2],
  },
}

const offline = () => { throw new Error('network down') }

afterEach(() => clearWeatherCache())

describe('open-meteo forecast', () => {
  it('把上游结构整理成 7 天预报', () => {
    const forecast = normalizeForecast(forecastPayload, new Date('2026-11-03T13:45:00.000Z'))
    expect(forecast.days).toHaveLength(7)
    expect(forecast.days[0]).toEqual({ date: '2026-11-03', weatherCode: 81, temperatureMax: 18.4, temperatureMin: 12.1 })
    expect(forecast.current).toEqual({ observedAt: '2026-11-03T21:45', temperature: 15.6, weatherCode: 81 })
    expect(forecast.timezone).toBe('Asia/Shanghai')
    expect(forecast.fetchedAt).toBe('2026-11-03T13:45:00.000Z')
  })

  it('结构缺字段就判成上游异常，不返回半截数据', () => {
    expect(() => normalizeForecast({})).toThrow(/天气服务/)
    expect(() => normalizeForecast({ ...forecastPayload, current: {} })).toThrow(/天气服务/)
    expect(() => normalizeForecast({ ...forecastPayload, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } })).toThrow(/天气服务/)
  })

  it('个别日子缺数据时跳过那天，其余照常', () => {
    const payload = {
      ...forecastPayload,
      daily: {
        time: ['2026-11-03', '2026-11-04'],
        weather_code: [3, null],
        temperature_2m_max: [18, 19],
        temperature_2m_min: [11, 12],
      },
    }
    const forecast = normalizeForecast(payload)
    expect(forecast.days.map(day => day.date)).toEqual(['2026-11-03'])
  })

  it('10 分钟内重复读取不再打上游，超时后重新取', async () => {
    let calls = 0
    const fetcher = async () => { calls += 1; return new Response(JSON.stringify(forecastPayload), { status: 200 }) }
    let clock = 1_000
    const options = { fetcher, now: () => clock }
    await fetchWeatherForecast(30.2741, 120.1551, options)
    await fetchWeatherForecast(30.2741, 120.1551, options)
    expect(calls).toBe(1)
    clock += 11 * 60 * 1000
    await fetchWeatherForecast(30.2741, 120.1551, options)
    expect(calls).toBe(2)
  })

  it('上游不通时给 503 业务错误，而不是把原始异常抛给前端', async () => {
    await expect(fetchWeatherForecast(30.2741, 120.1551, { fetcher: offline, now: () => Date.now() }))
      .rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' })
    await expect(fetchWeatherForecast(30.2741, 120.1551, {
      fetcher: async () => new Response('oops', { status: 500 }),
      now: () => Date.now(),
    })).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' })
  })
})

describe('open-meteo cities', () => {
  it('地理编码结果只保留有坐标的城市', () => {
    const cities = normalizeCities({
      results: [
        { id: 1808926, name: '杭州', admin1: '浙江', country: '中国', latitude: 30.29365, longitude: 120.16142 },
        { name: '坏数据' },
        { id: 9, name: '上海', latitude: 31.23, longitude: 121.47 },
      ],
    })
    expect(cities).toHaveLength(2)
    expect(cities[0]).toMatchObject({ id: '1808926', name: '杭州', region: '浙江', country: '中国' })
    expect(cities[1]).toMatchObject({ name: '上海', region: '', country: '' })
    expect(normalizeCities({})).toEqual([])
    expect(normalizeCities(null)).toEqual([])
  })

  it('没有结果不报错，空查询不打上游', async () => {
    const fetcher = async () => new Response(JSON.stringify({}), { status: 200 })
    expect(await searchWeatherCities('  ', { fetcher, now: () => Date.now() })).toEqual([])
    expect(await searchWeatherCities('不存在的地方', { fetcher, now: () => Date.now() })).toEqual([])
  })

  it('查询结果按名字缓存', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return new Response(JSON.stringify({ results: [{ id: 1, name: '杭州', latitude: 30.29, longitude: 120.16 }] }), { status: 200 })
    }
    const options = { fetcher, now: () => 5_000 }
    await searchWeatherCities('杭州', options)
    await searchWeatherCities('杭州', options)
    expect(calls).toBe(1)
  })
})
