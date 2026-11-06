import type { WeatherCity, WeatherForecast } from '@knowledge-base/contracts'

/**
 * 天气的城市选择是本机显示偏好：只存在 localStorage，不落库、不进备份，
 * 换台机器或清缓存就回到默认的杭州。
 */
export const DEFAULT_WEATHER_CITY: WeatherCity = {
  id: 'hangzhou',
  name: '杭州',
  region: '浙江',
  country: '中国',
  latitude: 30.2741,
  longitude: 120.1551,
}

/** 打开设置先给几个常用城市，不用打字也能换。 */
export const WEATHER_CITY_PRESETS: WeatherCity[] = [
  DEFAULT_WEATHER_CITY,
  { id: 'beijing', name: '北京', region: '北京', country: '中国', latitude: 39.9042, longitude: 116.4074 },
  { id: 'shanghai', name: '上海', region: '上海', country: '中国', latitude: 31.2304, longitude: 121.4737 },
  { id: 'guangzhou', name: '广州', region: '广东', country: '中国', latitude: 23.1291, longitude: 113.2644 },
  { id: 'shenzhen', name: '深圳', region: '广东', country: '中国', latitude: 22.5431, longitude: 114.0579 },
  { id: 'chengdu', name: '成都', region: '四川', country: '中国', latitude: 30.5728, longitude: 104.0668 },
  { id: 'wuhan', name: '武汉', region: '湖北', country: '中国', latitude: 30.5928, longitude: 114.3055 },
  { id: 'xian', name: '西安', region: '陕西', country: '中国', latitude: 34.3416, longitude: 108.9398 },
]

const cityStorageKey = 'marumaru.weather-city.v1'
const cacheStorageKey = 'marumaru.weather-cache.v1'

const readStorage = (): Storage | undefined => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined
    return window.localStorage
  } catch {
    return undefined
  }
}

const isCity = (value: unknown): value is WeatherCity => {
  if (!value || typeof value !== 'object') return false
  const city = value as Record<string, unknown>
  return typeof city.name === 'string' && city.name.trim().length > 0
    && typeof city.latitude === 'number' && Number.isFinite(city.latitude) && Math.abs(city.latitude) <= 90
    && typeof city.longitude === 'number' && Number.isFinite(city.longitude) && Math.abs(city.longitude) <= 180
}

export function readWeatherCity(): WeatherCity {
  try {
    const raw = readStorage()?.getItem(cityStorageKey)
    if (!raw) return DEFAULT_WEATHER_CITY
    const parsed: unknown = JSON.parse(raw)
    if (!isCity(parsed)) return DEFAULT_WEATHER_CITY
    const city = parsed as WeatherCity
    return {
      id: typeof city.id === 'string' && city.id ? city.id : `${city.latitude},${city.longitude}`,
      name: city.name,
      region: typeof city.region === 'string' ? city.region : '',
      country: typeof city.country === 'string' ? city.country : '',
      latitude: city.latitude,
      longitude: city.longitude,
    }
  } catch {
    return DEFAULT_WEATHER_CITY
  }
}

export function saveWeatherCity(city: WeatherCity): void {
  try {
    readStorage()?.setItem(cityStorageKey, JSON.stringify(city))
  } catch {
    // 存不下也不该影响看天气。
  }
}

/** `杭州 · 浙江`；缺省份时只显示城市名。 */
export const weatherCityLabel = (city: WeatherCity): string =>
  (city.region && city.region !== city.name ? `${city.name} · ${city.region}` : city.name)

const sameCity = (left: WeatherCity, right: WeatherCity): boolean =>
  (left.id && right.id ? left.id === right.id : false)
  || (Math.abs(left.latitude - right.latitude) < 0.001 && Math.abs(left.longitude - right.longitude) < 0.001)

const isForecast = (value: unknown): value is WeatherForecast => {
  if (!value || typeof value !== 'object') return false
  const forecast = value as Record<string, unknown>
  const current = forecast.current as Record<string, unknown> | undefined
  return Boolean(current) && typeof current?.temperature === 'number' && typeof current?.weatherCode === 'number'
    && Array.isArray(forecast.days) && forecast.days.length > 0
    && typeof forecast.fetchedAt === 'string'
}

/** 上次成功的天气缓存：冷启动先显示旧的，再等网络更新。 */
export function readWeatherCache(city: WeatherCity): WeatherForecast | undefined {
  try {
    const raw = readStorage()?.getItem(cacheStorageKey)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { city?: WeatherCity; forecast?: unknown }
    if (!parsed || !isCity(parsed.city)) return undefined
    if (!sameCity(parsed.city as WeatherCity, city)) return undefined
    return isForecast(parsed.forecast) ? parsed.forecast : undefined
  } catch {
    return undefined
  }
}

export function saveWeatherCache(city: WeatherCity, forecast: WeatherForecast): void {
  try {
    readStorage()?.setItem(cacheStorageKey, JSON.stringify({ city, forecast }))
  } catch {
    // 缓存只是锦上添花。
  }
}
