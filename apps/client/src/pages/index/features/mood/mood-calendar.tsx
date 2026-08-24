import { useMemo } from 'react'
import { Text, View } from '@tarojs/components'
import type { MoodEntry, MoodLevel } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import {
  buildMonthDays,
  compositeMoodLevel,
  formatLocalDate,
  moodLevelColors,
  moodLevelColorsDark,
  moodLevelConfigs,
  moodLevelLabels,
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

export function MoodCalendar({ mode, year, month, entries, selectedDate, filterLevel, colorTheme, onSelectDate, onMonthChange }: MoodCalendarProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
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
      const composite = dayEntries.length > 0 ? compositeMoodLevel(dayEntries.map(entry => entry.moodLevel)) : undefined
      const isSelected = selectedDate === dateStr
      let className = mini ? 'mood-calendar-cell mood-year-cell' : 'mood-calendar-cell'
      if (dayEntries.length === 0) className += ' empty-day'
      else if (composite) className += ' has-record'
      if (isSelected) className += ' selected'
      const tooltip = composite
        ? `${targetMonth}月${cell.day}日 · 综合情绪：${moodLevelLabels[composite]} · 共${dayEntries.length}条记录`
        : undefined
      return (
        <View
          key={index}
          className={className}
          style={composite ? { background: palette[composite] } : undefined}
          onClick={() => {
            if (selectedDate === dateStr) onSelectDate(undefined)
            else onSelectDate(dateStr)
          }}
        >
          <Text>{cell.day}</Text>
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
          {moodLevelConfigs.map(config => (
            <View key={config.level} className='mood-legend-item'>
              <View className='mood-legend-swatch' style={{ background: palette[config.level] }} />
              <Text>{config.label}</Text>
            </View>
          ))}
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
        {moodLevelConfigs.map(config => (
          <View key={config.level} className='mood-legend-item'>
            <View className='mood-legend-swatch' style={{ background: palette[config.level] }} />
            <Text>{config.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
