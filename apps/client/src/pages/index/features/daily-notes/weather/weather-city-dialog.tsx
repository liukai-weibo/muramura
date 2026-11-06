import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WeatherCity } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort } from '../../../api-client'
import { WEATHER_CITY_PRESETS, weatherCityLabel } from './weather-preference'

export interface WeatherCityDialogProps {
  current: WeatherCity
  onSelect: (city: WeatherCity) => void
  onClose: () => void
}

const sameCity = (left: WeatherCity, right: WeatherCity): boolean =>
  left.id === right.id
  || (Math.abs(left.latitude - right.latitude) < 0.001 && Math.abs(left.longitude - right.longitude) < 0.001)

/**
 * 天气设置：默认给几个常用城市，也可以直接搜（中文或拼音）。
 * 选中即保存并关闭，不额外点「确定」。
 */
export function WeatherCityDialog({ current, onSelect, onClose }: WeatherCityDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherCity[]>([])
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) { setResults([]); setFailed(''); setSearching(false); return }
    const controller = new AbortController()
    setSearching(true)
    setFailed('')
    const timer = window.setTimeout(() => {
      apiClient.searchWeatherCities(trimmed, controller.signal)
        .then(cities => { setResults(cities); setSearching(false) })
        .catch(error => {
          if (isApiClientAbort(error)) return
          setResults([])
          setSearching(false)
          setFailed('暂时搜不到，稍后再试')
        })
    }, 320)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])

  const shown = query.trim() ? results : WEATHER_CITY_PRESETS

  return <div className='capture-modal-backdrop' role='dialog' aria-modal='true' aria-label='天气设置' onClick={onClose}>
    <div className='capture-modal weather-city-dialog' onClick={event => event.stopPropagation()}>
      <div className='capture-modal-heading'>
        <div className='weather-city-heading'>
          <span className='section-kicker'>天气设置</span>
          <span>现在是 {weatherCityLabel(current)}</span>
        </div>
        <button type='button' className='capture-modal-close' onClick={onClose}>关闭</button>
      </div>

      <label className='weather-city-search'>
        <span className='weather-city-search-label'>搜城市</span>
        <input
          ref={inputRef}
          type='search'
          className='weather-city-input'
          value={query}
          placeholder='输入城市名，比如 杭州 / shanghai'
          onChange={event => setQuery(event.target.value)}
        />
      </label>

      {failed ? <p className='weather-city-error' role='status'>{failed}</p> : null}

      <div className='weather-city-list' role='listbox' aria-label='候选城市'>
        {shown.length
          ? shown.map(city => {
            const active = sameCity(city, current)
            return <button
              key={`${city.id}-${city.latitude}-${city.longitude}`}
              type='button'
              role='option'
              aria-selected={active}
              className={`weather-city-option ${active ? 'is-active' : ''}`}
              onClick={() => { onSelect(city); onClose() }}
            >
              <span className='weather-city-name'>{city.name}</span>
              <span className='weather-city-region'>{[city.region, city.country].filter(Boolean).join(' · ')}</span>
              {active ? <span className='weather-city-current'>当前</span> : null}
            </button>
          })
          : <p className='weather-city-empty'>{searching ? '正在搜…' : query.trim() ? '没有匹配的城市' : '常用城市'}</p>}
      </div>
    </div>
  </div>
}
