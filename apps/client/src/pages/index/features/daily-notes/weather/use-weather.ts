import { useCallback, useEffect, useState } from 'react'
import type { WeatherCity, WeatherForecast } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort } from '../../../api-client'
import { readWeatherCache, readWeatherCity, saveWeatherCache, saveWeatherCity } from './weather-preference'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

export interface WeatherSnapshot {
  status: 'loading' | 'ready' | 'error'
  forecast?: WeatherForecast
  /** 有旧数据但这次没取到时，界面只提示一句，不把旧数据擦掉。 */
  error: string
}

export interface WeatherController extends WeatherSnapshot {
  city: WeatherCity
  refresh: () => void
  chooseCity: (city: WeatherCity) => void
}

function initialState(city: WeatherCity): WeatherSnapshot {
  const cached = readWeatherCache(city)
  return cached ? { status: 'ready', forecast: cached, error: '' } : { status: 'loading', error: '' }
}

/**
 * 天气读取：换城市或到点就重取一次，失败保留上一次结果。
 *
 * 外部天气挂了只影响这一块展示，绝不能让手记页跟着报错。
 */
export function useWeather(): WeatherController {
  const [city, setCity] = useState<WeatherCity>(() => readWeatherCity())
  const [snapshot, setSnapshot] = useState<WeatherSnapshot>(() => initialState(city))
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setSnapshot(previous => ({ ...previous, status: previous.forecast ? previous.status : 'loading', error: '' }))
    apiClient.getWeatherForecast(city.latitude, city.longitude, controller.signal)
      .then(forecast => {
        if (cancelled) return
        saveWeatherCache(city, forecast)
        setSnapshot({ status: 'ready', forecast, error: '' })
      })
      .catch(error => {
        if (cancelled || isApiClientAbort(error)) return
        setSnapshot(previous => ({
          ...previous,
          status: previous.forecast ? previous.status : 'error',
          error: '天气暂时取不到',
        }))
      })
    return () => { cancelled = true; controller.abort() }
  }, [city, reloadToken])

  useEffect(() => {
    const timer = window.setInterval(() => setReloadToken(token => token + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const refresh = useCallback(() => setReloadToken(token => token + 1), [])

  const chooseCity = useCallback((next: WeatherCity) => {
    saveWeatherCity(next)
    setCity(next)
    setSnapshot(() => {
      const cached = readWeatherCache(next)
      if (cached) return { status: 'ready', forecast: cached, error: '' }
      // 旧城市的天气不能挂在新城市名下，先清空再等新的。
      return { status: 'loading', error: '' }
    })
  }, [])

  return { city, refresh, chooseCity, ...snapshot }
}
