import { useEffect, useMemo, useState } from 'react'
import type { SleepEntry } from '@knowledge-base/contracts'
import {
  dayLabel,
  isFutureDate,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  shiftWeek,
  startOfWeek,
  weekDates,
  weekRangeLabel,
  weekdayLabel,
} from './sleep-calendar'

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']

export interface SleepDatePickerProps {
  value: string
  today: string
  entries: SleepEntry[]
  onChange: (date: string) => void
}

/**
 * 睡眠日期选择：默认一排七天（本周），可展开成月历。
 * 展开状态只存在组件内，关闭弹窗或刷新页面后回到七天视图。
 */
export function SleepDatePicker({ value, today, entries, onChange }: SleepDatePickerProps) {
  const [expanded, setExpanded] = useState(false)
  const [viewDate, setViewDate] = useState(value)

  // 选中日期变化时，把视图对齐到它（收起草稿与展开月历都跟随）。
  useEffect(() => { setViewDate(value) }, [value])

  const recorded = useMemo(() => {
    const dates = new Set<string>()
    for (const entry of entries) {
      if (entry.wakeAt || entry.bedAt) dates.add(entry.sleepDate)
    }
    return dates
  }, [entries])

  const view = monthOf(viewDate) ?? monthOf(value) ?? { year: 2026, month: 1 }
  const todayMonth = monthOf(today) ?? view
  const canGoNextMonth = view.year < todayMonth.year || (view.year === todayMonth.year && view.month < todayMonth.month)
  const canGoNextWeek = startOfWeek(shiftWeek(viewDate, 1)) <= today
  const week = weekDates(viewDate)
  const cells = monthGrid(view.year, view.month)

  const changeView = (direction: -1 | 1) => {
    if (expanded) {
      const next = shiftMonth(view.year, view.month, direction)
      setViewDate(`${next.year}-${String(next.month).padStart(2, '0')}-01`)
      return
    }
    setViewDate(shiftWeek(viewDate, direction))
  }

  const collapse = () => {
    setExpanded(false)
    setViewDate(value)
  }

  const dayClassName = (date: string, extra = '') => {
    const classes = ['sleep-picker-day', extra]
    if (date === value) classes.push('is-selected')
    if (date === today) classes.push('is-today')
    if (recorded.has(date)) classes.push('has-record')
    return classes.filter(Boolean).join(' ')
  }

  return <div className='sleep-picker'>
    <div className='sleep-picker-head'>
      <div className='sleep-picker-nav'>
        <button
          type='button'
          className='sleep-picker-arrow'
          aria-label={expanded ? '上个月' : '上一周'}
          onClick={() => changeView(-1)}
        >‹</button>
        <span className='sleep-picker-title'>{expanded ? monthLabel(view.year, view.month) : weekRangeLabel(viewDate)}</span>
        <button
          type='button'
          className='sleep-picker-arrow'
          aria-label={expanded ? '下个月' : '下一周'}
          disabled={expanded ? !canGoNextMonth : !canGoNextWeek}
          onClick={() => changeView(1)}
        >›</button>
      </div>
      <div className='sleep-picker-actions'>
        {value !== today && <button type='button' className='sleep-picker-today' onClick={() => onChange(today)}>今天</button>}
        <button
          type='button'
          className='sleep-picker-toggle'
          aria-expanded={expanded}
          onClick={() => (expanded ? collapse() : setExpanded(true))}
        >{expanded ? '收起' : '展开'}<span className='sleep-picker-caret' aria-hidden='true'>{expanded ? '⌃' : '⌄'}</span></button>
      </div>
    </div>

    {!expanded && <div className='sleep-picker-week' role='group' aria-label='本周日期'>
      {week.map(date => <button
        key={date}
        type='button'
        className={dayClassName(date, 'is-week-cell')}
        aria-pressed={date === value}
        aria-label={`${date} 周${weekdayLabel(date)}`}
        onClick={() => onChange(date)}
      >
        <span className='sleep-picker-weekday'>周{weekdayLabel(date)}</span>
        <span className='sleep-picker-day-number'>{dayLabel(date)}</span>
        <span className='sleep-picker-dot' aria-hidden='true' />
      </button>)}
    </div>}

    <div className={`sleep-picker-month ${expanded ? 'is-open' : ''}`} aria-hidden={!expanded}>
      <div className='sleep-picker-month-inner'>
        <div className='sleep-picker-weekdays' aria-hidden='true'>
          {WEEKDAY_HEADERS.map(day => <span key={day}>{day}</span>)}
        </div>
        <div className='sleep-picker-grid' role='grid' aria-label='月历'>
          {cells.map(cell => {
            const future = isFutureDate(cell.date, today)
            const classes = dayClassName(cell.date, cell.inMonth ? '' : 'is-outside')
            return <button
              key={cell.date}
              type='button'
              className={classes}
              aria-pressed={cell.date === value}
              aria-label={`${cell.date} 周${weekdayLabel(cell.date)}${future ? '（未来）' : ''}`}
              disabled={future}
              tabIndex={expanded ? 0 : -1}
              onClick={() => onChange(cell.date)}
            >
              <span className='sleep-picker-day-number'>{dayLabel(cell.date)}</span>
              <span className='sleep-picker-dot' aria-hidden='true' />
            </button>
          })}
        </div>
      </div>
    </div>
  </div>
}
