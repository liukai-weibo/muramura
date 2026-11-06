import { useMemo } from 'react'
import { shanghaiDate } from '../daily-note-date'
import {
  describeWeatherCode,
  formatFreshness,
  formatMonthDaySlash,
  formatObservedClock,
  formatTemperature,
  weatherDayLabel,
} from './weather-format'
import type { WeatherController } from './use-weather'
import { weatherCityLabel } from './weather-preference'

export interface WeatherWidgetProps {
  weather: WeatherController
  /** 打开城市设置；和工具栏的「天气设置」是同一个入口。 */
  onOpenSettings: () => void
}

/**
 * 手记页右侧的近七天天气：上面一行是此刻实况，下面按天列最高／最低。
 *
 * 只做展示：读不到就退化成一行动作提示，不影响写手记。
 */
export function WeatherWidget({ weather, onOpenSettings }: WeatherWidgetProps) {
  const { city, forecast, status, error, refresh } = weather
  const today = shanghaiDate()
  const current = forecast ? describeWeatherCode(forecast.current.weatherCode) : undefined
  const freshness = useMemo(() => (forecast ? formatFreshness(forecast.fetchedAt) : ''), [forecast])

  return <aside className='weather-card' aria-label='近七天天气'>
    <div className='weather-card-head'>
      <div className='weather-card-city-row'>
        <span className='weather-card-city' title={weatherCityLabel(city)}>{city.name}</span>
        <button type='button' className='weather-card-settings' onClick={onOpenSettings}>设置</button>
      </div>
      {forecast && current
        ? <div className='weather-card-now'>
          <span className='weather-card-icon' aria-hidden='true'>{current.icon}</span>
          <span className='weather-card-temperature'>{formatTemperature(forecast.current.temperature)}</span>
          <span className='weather-card-condition'>{current.label}</span>
        </div>
        : <div className='weather-card-now is-empty'>{status === 'error' ? '读不到天气' : '读取中…'}</div>}
      <p className='weather-card-meta'>
        {forecast
          ? [formatObservedClock(forecast.current.observedAt) && `${formatObservedClock(forecast.current.observedAt)} 观测`, freshness].filter(Boolean).join(' · ')
          : error || '外部天气只在有网络时更新'}
      </p>
    </div>

    {forecast
      ? <ul className='weather-card-days'>
        {forecast.days.map(day => {
          const described = describeWeatherCode(day.weatherCode)
          const isToday = day.date === today
          return <li key={day.date} className={`weather-card-day ${isToday ? 'is-today' : ''}`}>
            <span className='weather-card-day-label'>{weatherDayLabel(day.date, today)}</span>
            <span className='weather-card-day-date'>{formatMonthDaySlash(day.date)}</span>
            <span className='weather-card-day-icon' aria-hidden='true' title={described.label}>{described.icon}</span>
            <span className='weather-card-day-temp'>
              <span className='is-max'>{formatTemperature(day.temperatureMax)}</span>
              <span className='is-min'>{formatTemperature(day.temperatureMin)}</span>
            </span>
          </li>
        })}
      </ul>
      : null}

    <div className='weather-card-foot'>
      {forecast ? <span className='weather-card-source'>Open-Meteo</span> : <span className='weather-card-source'>{status === 'loading' ? '正在取天气…' : ''}</span>}
      <button type='button' className='weather-card-refresh' onClick={refresh} disabled={status === 'loading'}>
        {status === 'loading' ? '刷新中' : '刷新'}
      </button>
    </div>
  </aside>
}
