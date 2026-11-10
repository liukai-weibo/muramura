import { useEffect, useMemo, useState } from 'react'
import { SleepHistoryChart } from './sleep-history-chart'
import { monthDates, monthLabel, shiftMonth, yearDates } from './sleep-detail-layout'
import { useSleepHistory } from './use-sleep-history'

export interface SleepDetailModalProps {
  today: string
  onClose: () => void
}

type DetailView = 'month' | 'year'

/** 睡眠详情：30 天折线 / 全年折线，可翻月、翻年。 */
export function SleepDetailModal({ today, onClose }: SleepDetailModalProps) {
  const todayYear = Number(today.slice(0, 4))
  const todayMonth = Number(today.slice(5, 7))
  const [view, setView] = useState<DetailView>('month')
  const [year, setYear] = useState(todayYear)
  const [month, setMonth] = useState(todayMonth)
  const { entries, loading, error, reload } = useSleepHistory(year)

  const dates = useMemo(
    () => (view === 'month' ? monthDates(year, month) : yearDates(year)),
    [view, year, month],
  )

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const canGoNext = view === 'year'
    ? year < todayYear
    : year < todayYear || (year === todayYear && month < todayMonth)

  const shift = (delta: -1 | 1) => {
    if (view === 'year') {
      setYear(value => value + delta)
      return
    }
    const next = shiftMonth(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
  }

  const goToday = () => {
    setYear(todayYear)
    setMonth(todayMonth)
    setView('month')
  }

  return <div className='capture-modal-backdrop' role='dialog' aria-modal='true' aria-label='睡眠详情' onClick={onClose}>
    <div className='capture-modal sleep-detail-modal' onClick={event => event.stopPropagation()}>
      <div className='capture-modal-heading'>
        <div className='sleep-modal-heading'>
          <span className='section-kicker'>睡眠详情</span>
          <span>{view === 'month' ? '逐日折线，纵向是 06 → 次日 06 的整点轴' : '全年折线，横向每个刻度是一个月'}</span>
        </div>
        <button type='button' className='capture-modal-close' onClick={onClose}>关闭</button>
      </div>

      <div className='sleep-detail-toolbar'>
        <div className='sleep-detail-nav'>
          <button type='button' className='sleep-picker-arrow' aria-label={view === 'year' ? '上一年' : '上个月'} onClick={() => shift(-1)}>‹</button>
          <span className='sleep-detail-title'>{view === 'month' ? monthLabel(year, month) : `${year} 年`}</span>
          <button type='button' className='sleep-picker-arrow' aria-label={view === 'year' ? '下一年' : '下个月'} disabled={!canGoNext} onClick={() => shift(1)}>›</button>
        </div>
        <div className='sleep-detail-actions'>
          <div className='sleep-precision-switch' role='tablist' aria-label='详情视图'>
            <button type='button' role='tab' aria-selected={view === 'month'} className={view === 'month' ? 'is-active' : ''} onClick={() => setView('month')}>30 天</button>
            <button type='button' role='tab' aria-selected={view === 'year'} className={view === 'year' ? 'is-active' : ''} onClick={() => setView('year')}>全年</button>
          </div>
          <button type='button' className='sleep-picker-today' onClick={goToday}>今天</button>
        </div>
      </div>

      <div className='sleep-detail-body'>
        {loading && <p className='sleep-detail-status'>读取中…</p>}
        {!loading && error && <p className='sleep-error' role='status'>{error}<button type='button' className='sleep-tool' onClick={reload}>重试</button></p>}
        {!loading && !error && <SleepHistoryChart
          dates={dates}
          entries={entries}
          today={today}
          mode={view === 'month' ? 'month' : 'year'}
          ariaLabel={view === 'month' ? `${year} 年 ${month} 月睡眠折线` : `${year} 年睡眠折线`}
        />}
      </div>
    </div>
  </div>
}
