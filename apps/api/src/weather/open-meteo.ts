import type { WeatherCity, WeatherDay, WeatherForecast } from '@knowledge-base/contracts'
import { WEATHER_FORECAST_DAY_COUNT } from '@knowledge-base/contracts'
import { ApiError } from '../api-errors'

/**
 * Open-Meteo 是唯一的外部依赖：不需要密钥，只读天气与地理编码。
 *
 * 这里做三件事：拼请求、严格校验上游结构、把成功结果短时缓存，
 * 让手记页刷新时不会每次都打到外网，外部挂了也只影响这一块展示。
 */
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_TIMEZONE = 'Asia/Shanghai'
const FORECAST_TTL_MS = 10 * 60 * 1000
const CITY_TTL_MS = 24 * 60 * 60 * 1000
const UPSTREAM_TIMEOUT_MS = 8000
const MAX_CACHE_ENTRIES = 64

export type WeatherFetcher = (input: string, init?: RequestInit) => Promise<Response>

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

const forecastCache = new Map<string, CacheEntry<WeatherForecast>>()
const cityCache = new Map<string, CacheEntry<WeatherCity[]>>()

/** 测试用：清掉进程内缓存。 */
export function clearWeatherCache(): void {
  forecastCache.clear()
  cityCache.clear()
}

const upstreamUnavailable = () => new ApiError(503, 'UPSTREAM_UNAVAILABLE', '天气服务暂时不可用，稍后再试')

function readEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= now) { cache.delete(key); return undefined }
  return entry.value
}

function writeEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number, now: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { expiresAt: now + ttl, value })
}

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readArray = (value: unknown): unknown[] | undefined => (Array.isArray(value) ? value : undefined)

/** 把上游 daily 的四个等长数组拼成逐日结构；长度不一致或关键字段缺失即视为上游异常。 */
export function normalizeForecast(payload: unknown, fetchedAt = new Date()): WeatherForecast {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const current = root.current && typeof root.current === 'object' ? root.current as Record<string, unknown> : {}
  const daily = root.daily && typeof root.daily === 'object' ? root.daily as Record<string, unknown> : {}
  const observedAt = readString(current.time)
  const temperature = readNumber(current.temperature_2m)
  const currentCode = readNumber(current.weather_code)
  const dates = readArray(daily.time)
  const codes = readArray(daily.weather_code)
  const maxes = readArray(daily.temperature_2m_max)
  const mins = readArray(daily.temperature_2m_min)
  if (!observedAt || temperature === undefined || currentCode === undefined || !dates || !codes || !maxes || !mins) {
    throw upstreamUnavailable()
  }
  const days: WeatherDay[] = []
  for (let index = 0; index < dates.length; index += 1) {
    const date = readString(dates[index])
    const code = readNumber(codes[index])
    const max = readNumber(maxes[index])
    const min = readNumber(mins[index])
    // 个别日子缺数据就跳过那一天，不因为一天把整块天气判成失败。
    if (!date || code === undefined || max === undefined || min === undefined) continue
    days.push({ date, weatherCode: code, temperatureMax: max, temperatureMin: min })
    if (days.length === WEATHER_FORECAST_DAY_COUNT) break
  }
  if (!days.length) throw upstreamUnavailable()
  return {
    timezone: readString(root.timezone) ?? WEATHER_TIMEZONE,
    fetchedAt: fetchedAt.toISOString(),
    current: { observedAt, temperature, weatherCode: currentCode },
    days,
  }
}

/** 地理编码结果 → 城市列表；过滤掉没有经纬度的残缺项。 */
export function normalizeCities(payload: unknown): WeatherCity[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const results = readArray(root.results) ?? []
  const cities: WeatherCity[] = []
  for (const item of results) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const name = readString(record.name)
    const latitude = readNumber(record.latitude)
    const longitude = readNumber(record.longitude)
    if (!name || latitude === undefined || longitude === undefined) continue
    const id = readNumber(record.id) ?? `${latitude},${longitude}`
    cities.push({
      id: String(id),
      name,
      region: readString(record.admin1) ?? '',
      country: readString(record.country) ?? '',
      latitude,
      longitude,
    })
  }
  return cities
}

async function fetchJson(url: string, fetcher: WeatherFetcher): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!response.ok) throw upstreamUnavailable()
    return await response.json() as unknown
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw upstreamUnavailable()
  } finally {
    clearTimeout(timer)
  }
}

export interface WeatherCallOptions {
  fetcher?: WeatherFetcher
  now?: () => number
}

/** 取 7 天预报：先看 10 分钟缓存，再打上游。 */
export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  options: WeatherCallOptions = {},
): Promise<WeatherForecast> {
  const now = options.now?.() ?? Date.now()
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`
  const cached = readEntry(forecastCache, key, now)
  if (cached) return cached
  const query = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: WEATHER_TIMEZONE,
    forecast_days: String(WEATHER_FORECAST_DAY_COUNT),
  })
  const payload = await fetchJson(`${FORECAST_ENDPOINT}?${query.toString()}`, options.fetcher ?? fetch)
  const forecast = normalizeForecast(payload)
  writeEntry(forecastCache, key, forecast, FORECAST_TTL_MS, now)
  return forecast
}

/** 按名字找城市：中文、拼音都能查，最多 8 条。 */
export async function searchWeatherCities(query: string, options: WeatherCallOptions = {}): Promise<WeatherCity[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const now = options.now?.() ?? Date.now()
  const cached = readEntry(cityCache, trimmed, now)
  if (cached) return cached
  const params = new URLSearchParams({ name: trimmed, language: 'zh', count: '8', format: 'json' })
  const payload = await fetchJson(`${GEOCODING_ENDPOINT}?${params.toString()}`, options.fetcher ?? fetch)
  const cities = normalizeCities(payload)
  writeEntry(cityCache, trimmed, cities, CITY_TTL_MS, now)
  return cities
}
