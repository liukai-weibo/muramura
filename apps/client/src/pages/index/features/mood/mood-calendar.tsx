import { useMemo } from 'react'
import { Text, View } from '@tarojs/components'
import type { MoodEntry, MoodLevel } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import {
  buildMonthGrid,
  compositeMoodLevel,
  formatLocalDate,
  moodLevelColors,
  moodLevelColorsDark,
  moodLevelConfigs,
  moodLevelLabels,
} from './mood-levels'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

interface MoodCalendarProps {
  year: number
  month: number
  entries: MoodEntry[]
  selectedDate?: string
  filterLevel: MoodLevel | 'all'
  colorTheme: ColorTheme
  onSelectDate: (date?: string) => void
  onMonthChange: (year: number, month: number) => void
}

export function MoodCalendar({ year, month, entries, selectedDate, filterLevel, colorTheme, onSelectDate, onMonthChange }: MoodCalendarProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  const byDate = useMemo(() => {
    const map = new Map<string, MoodEntry[]>()
    for (const entry of entries) {
      if (filterLevel !== 'all' && entry.moodLevel !== filterLevel) continue
      const list = map.get(entry.entryDate) ?? []
      list.push(entry)
      map.set(entry.entryDate, list)
    }
    return map
  }, [entries, filterLevel])

  const changeMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    onMonthChange(next.getFullYear(), next.getMonth() + 1)
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
        {cells.map((cell, index) => {
          const dateStr = formatLocalDate(cell.year, cell.month, cell.day)
          const dayEntries = cell.isCurrentMonth ? (byDate.get(dateStr) ?? []) : []
          const composite = dayEntries.length > 0 ? compositeMoodLevel(dayEntries.map(entry => entry.moodLevel)) : undefined
          const isSelected = selectedDate === dateStr
          let className = 'mood-calendar-cell'
          if (!cell.isCurrentMonth || dayEntries.length === 0) className += ' empty-day'
          else if (composite) className += ' has-record'
          if (isSelected) className += ' selected'
          const tooltip = composite
            ? `${cell.month}月${cell.day}日 · 综合情绪：${moodLevelLabels[composite]} · 共${dayEntries.length}条记录`
            : undefined
          return (
            <View
              key={index}
              className={className}
              style={composite ? { background: palette[composite] } : undefined}
              onClick={() => { if (cell.isCurrentMonth) { if (isSelected) onSelectDate(undefined); else onSelectDate(dateStr) } }}
            >
              <Text>{cell.day}</Text>
              {tooltip && <View className='mood-calendar-tooltip'><Text>{tooltip}</Text></View>}
            </View>
          )
        })}
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
