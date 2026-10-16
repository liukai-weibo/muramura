import { useMemo } from 'react'
import { Text, View } from '@tarojs/components'
import type { MoodEntry, MoodLevel } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import {
  buildMonthDays,
  formatLocalDate,
  moodEventChecks,
  moodEventTier,
} from './mood-levels'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

export type MoodCalendarMode = 'year' | 'month'

interface MoodCalendarProps {
  mode: MoodCalendarMode
  year: number
  month: number
  entries: MoodEntry[]
  selectedDate?: string
  filterLevel: MoodLevel | 'all'
  colorTheme: ColorTheme
  onSelectDate: (date?: string) => void
  onMonthChange: (year: number, month: number) => void
}

/** 按日期聚合当天事件条数（状态档位已停止采集，不再参与着色）。 */
function useEntriesByDate(entries: MoodEntry[], filterLevel: MoodLevel | 'all') {
  return useMemo(() => {
    const map = new Map<string, MoodEntry[]>()
    for (const entry of entries) {
      if (filterLevel !== 'all' && entry.moodLevel !== filterLevel) continue
      const list = map.get(entry.entryDate) ?? []
      list.push(entry)
      map.set(entry.entryDate, list)
    }
    return map
  }, [entries, filterLevel])
}

export function MoodCalendar({ mode, year, month, entries, selectedDate, filterLevel, onSelectDate, onMonthChange }: MoodCalendarProps) {
  const byDate = useEntriesByDate(entries, filterLevel)

  const changeMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    onMonthChange(next.getFullYear(), next.getMonth() + 1)
  }

  const changeYear = (delta: number) => {
    onMonthChange(year + delta, 1)
  }

  const renderCells = (targetYear: number, targetMonth: number, mini: boolean) => {
    const days = buildMonthDays(targetYear, targetMonth)
    return days.map((cell, index) => {
      if (cell.isPlaceholder) {
        return <View key={index} className='mood-cell-placeholder' aria-hidden='true' />
      }
      const dateStr = formatLocalDate(targetYear, targetMonth, cell.day)
      const dayEntries = byDate.get(dateStr) ?? []
      const tier = moodEventTier(dayEntries.length)
      const checks = moodEventChecks(tier)
      const isSelected = selectedDate === dateStr
      let className = mini ? 'mood-calendar-cell mood-year-cell' : 'mood-calendar-cell'
      className += ` mood-tier-${tier}`
      if (isSelected) className += ' selected'
      const tooltip = checks > 0
        ? `${targetMonth}月${cell.day}日 · 共${dayEntries.length}条事件`
        : undefined
      return (
        <View
          key={index}
          className={className}
          onClick={() => {
            if (selectedDate === dateStr) onSelectDate(undefined)
            else onSelectDate(dateStr)
          }}
        >
          <Text>{cell.day}</Text>
          {checks > 0 && (
            <View className={mini ? 'mood-cell-checks mood-cell-checks-mini' : 'mood-cell-checks'} aria-hidden='true'>
              {Array.from({ length: checks }, (_, i) => <View key={i} className='mood-cell-check' />)}
            </View>
          )}
          {tooltip && <View className='mood-calendar-tooltip'><Text>{tooltip}</Text></View>}
        </View>
      )
    })
  }

  if (mode === 'year') {
    const months: number[] = Array.from({ length: 12 }, (_, i) => i + 1)
    return (
      <View className='mood-calendar'>
        <View className='mood-calendar-header'>
          <Text>{year} 年</Text>
          <View className='mood-calendar-nav'>
            <View className='mood-calendar-nav-button' onClick={() => changeYear(-1)} aria-label='上一年'><Text>‹</Text></View>
            <View className='mood-calendar-nav-button' onClick={() => changeYear(1)} aria-label='下一年'><Text>›</Text></View>
          </View>
        </View>
        <View className='mood-year-grid' role='grid' aria-label={`${year} 年情绪概览`}>
          {months.map(monthOfYear => (
            <View key={monthOfYear} className='mood-year-month-card'>
              <View className='mood-year-month-title' role='columnheader'><Text>{monthOfYear} 月</Text></View>
              <View className='mood-calendar-grid mood-year-weekday-row'>
                {weekdays.map(day => <View key={day} className='mood-calendar-weekday mood-year-weekday'><Text>{day}</Text></View>)}
              </View>
              <View className='mood-calendar-grid mood-year-days'>
                {renderCells(year, monthOfYear, true)}
              </View>
            </View>
          ))}
        </View>
        <View className='mood-legend'>
          <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-none' /><Text>未记录</Text></View>
          <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-one' /><Text>1–2 条</Text></View>
          <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-two' /><Text>3–10 条</Text></View>
          <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-three' /><Text>11 条以上</Text></View>
        </View>
      </View>
    )
  }

  return (
    <View className='mood-calendar'>
      <View className='mood-calendar-header'>
        <Text>{year} 年 {month} 月</Text>
        <View className='mood-calendar-nav'>
          <View className='mood-calendar-nav-button' onClick={() => changeMonth(-1)} aria-label='上个月'><Text>‹</Text></View>
          <View className='mood-calendar-nav-button' onClick={() => changeMonth(1)} aria-label='下个月'><Text>›</Text></View>
        </View>
      </View>
      <View className='mood-calendar-grid'>
        {weekdays.map(day => <View key={day} className='mood-calendar-weekday'><Text>{day}</Text></View>)}
        {renderCells(year, month, false)}
      </View>
      <View className='mood-legend'>
        <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-none' /><Text>未记录</Text></View>
        <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-one' /><Text>1–2 条</Text></View>
        <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-two' /><Text>3–10 条</Text></View>
        <View className='mood-legend-item'><View className='mood-legend-swatch mood-legend-swatch-three' /><Text>11 条以上</Text></View>
      </View>
    </View>
  )
}
