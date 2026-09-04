import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import type { MealEntry, MealType } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { buildMonthDays, daysInMonth, formatLocalDate, todayLocalDate } from '../calendar-utils'
import type { ColorTheme } from '../../display-effect-preference'
import { mealFeelingColors, mealFeelingColorsDark, mealFeelingLabels, mealSatietyLevels, mealTypeLabels, mealTypeOrder } from './meal-levels'
import { MealDayModal } from './meal-day-modal'
import './meals-page.scss'

type MealView = 'month' | 'year'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

function useMealsByDate(entries: MealEntry[]) {
  return useMemo(() => {
    const map = new Map<string, Partial<Record<MealType, MealEntry>>>()
    for (const entry of entries) {
      const day = map.get(entry.entryDate) ?? {}
      day[entry.mealType] = entry
      map.set(entry.entryDate, day)
    }
    return map
  }, [entries])
}

export function MealsPage({ colorTheme }: { colorTheme: ColorTheme }) {
  const now = new Date()
  const [view, setView] = useState<MealView>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [entries, setEntries] = useState<MealEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [openDate, setOpenDate] = useState<string | undefined>()
  const palette = colorTheme === 'dark' ? mealFeelingColorsDark : mealFeelingColors
  const byDate = useMealsByDate(entries)

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const range = view === 'year'
        ? { from: formatLocalDate(year, 1, 1), to: formatLocalDate(year, 12, 31) }
        : { from: formatLocalDate(year, month, 1), to: formatLocalDate(year, month, daysInMonth(year, month)) }
      setEntries(await apiClient.listMealEntries(range))
    } catch (e: unknown) {
      setError((e as Error)?.message ?? '三餐记录读取失败')
    } finally {
      setLoading(false)
    }
  }, [view, year, month])

  useEffect(() => { void refresh() }, [refresh])

  const switchView = (next: MealView) => {
    setView(next)
    setOpenDate(undefined)
  }

  const changeYear = (delta: number) => { setYear(y => y + delta); setOpenDate(undefined) }
  const changeMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    setYear(next.getFullYear()); setMonth(next.getMonth() + 1); setOpenDate(undefined)
  }

  const periodHint = view === 'year'
    ? '当前年：' + year + ' 年'
    : '当前月：' + year + ' 年 ' + month + ' 月'

  const renderMonthCells = () => {
    const days = buildMonthDays(year, month)
    return days.map((cell, index) => {
      if (cell.isPlaceholder) {
        return <View key={index} className='meals-cell meals-cell-placeholder' aria-hidden='true' />
      }
      const dateStr = formatLocalDate(year, month, cell.day)
      const day = byDate.get(dateStr)
      return (
        <View key={index} className='meals-cell' onClick={() => setOpenDate(dateStr)}>
          <Text className='meals-cell-day'>{cell.day}</Text>
          <View className='meals-cell-dots'>
            {mealTypeOrder.map(type => {
              const entry = day?.[type]
              return <View key={type} className='meals-cell-dot' style={entry ? { background: palette[entry.feeling] } : undefined} />
            })}
          </View>
        </View>
      )
    })
  }

  const renderYearCalendar = () => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1)
    return (
      <View className='meals-year-wrap'>
        <View className='meals-year-grid' role='grid' aria-label={year + ' 年三餐概览'}>
          {months.map(m => (
            <View key={m} className='meals-year-month-card'>
              <View className='meals-year-month-title'><Text>{m} 月</Text></View>
              <View className='meals-year-weekday-row'>
                {weekdays.map(day => <View key={day} className='meals-year-weekday'><Text>{day}</Text></View>)}
              </View>
              <View className='meals-year-days'>
                {buildMonthDays(year, m).map((cell, index) => {
                  if (cell.isPlaceholder) {
                    return <View key={index} className='meals-year-cell meals-year-cell-placeholder' aria-hidden='true' />
                  }
                  const dateStr = formatLocalDate(year, m, cell.day)
                  const day = byDate.get(dateStr)
                  return (
                    <View key={index} className='meals-year-cell' onClick={() => setOpenDate(dateStr)}>
                      <Text className='meals-year-cell-day'>{cell.day}</Text>
                      <View className='meals-year-cell-dots'>
                        {mealTypeOrder.map(type => {
                          const entry = day?.[type]
                          return <View key={type} className='meals-year-cell-dot' style={entry ? { background: palette[entry.feeling] } : undefined} />
                        })}
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          ))}
        </View>
      </View>
    )
  }

  const recordedDays = useMemo(() => {
    const dates = [...byDate.keys()].sort()
    return dates
  }, [byDate])

  return (
    <View className='meals-page'>
      <View className='meals-toolbar'>
        <View className='meals-toolbar-actions'>
          <View className='meals-new-button' role='button' aria-label='记录今天三餐' onClick={() => setOpenDate(todayLocalDate())}>
            <Text>＋ 记录今天三餐</Text>
          </View>
          <View className='meals-view-toggle' role='tablist' aria-label='三餐视图切换'>
            <View role='tab' aria-selected={view === 'month'} className={'meals-view-toggle-item ' + (view === 'month' ? 'active' : '')} onClick={() => switchView('month')}><Text>月视图</Text></View>
            <View role='tab' aria-selected={view === 'year'} className={'meals-view-toggle-item ' + (view === 'year' ? 'active' : '')} onClick={() => switchView('year')}><Text>年视图</Text></View>
          </View>
        </View>
        <View className='meals-toolbar-actions'>
          <Text className='meals-toolbar-hint'>{periodHint}</Text>
          <View className='meals-calendar-nav'>
            <View className='meals-calendar-nav-button' aria-label='上一个' onClick={() => (view === 'year' ? changeYear(-1) : changeMonth(-1))}><Text>‹</Text></View>
            <View className='meals-calendar-nav-button' aria-label='下一个' onClick={() => (view === 'year' ? changeYear(1) : changeMonth(1))}><Text>›</Text></View>
          </View>
        </View>
      </View>

      {view === 'month' && (
        <View className='meals-calendar'>
          <View className='meals-weekday-row'>
            {weekdays.map(day => <View key={day} className='meals-weekday'><Text>{day}</Text></View>)}
          </View>
          <View className='meals-month-grid'>{renderMonthCells()}</View>
        </View>
      )}
      {view === 'year' && renderYearCalendar()}

      {loading && <View className='meals-empty'><Text>正在读取三餐记录…</Text></View>}
      {!loading && error && <View className='meals-empty'><Text>{error}</Text></View>}
      {!loading && !error && view === 'month' && recordedDays.length === 0 && (
        <View className='meals-empty'><Text>这个月还没有三餐记录，点上面「记录今天三餐」开始吧。</Text></View>
      )}

      {view === 'year' && !loading && !error && (
        <View className='meals-legend'>
          {mealSatietyLevels.map(level => (
            <View key={level} className='meals-legend-item'>
              <View className='meals-legend-swatch' style={{ background: palette[level] }} />
              <Text>{mealFeelingLabels[level]}</Text>
            </View>
          ))}
        </View>
      )}

      {openDate && (
        <MealDayModal
          initialDate={openDate}
          onClose={() => setOpenDate(undefined)}
          onSaved={() => { setOpenDate(undefined); void refresh() }}
        />
      )}
    </View>
  )
}
