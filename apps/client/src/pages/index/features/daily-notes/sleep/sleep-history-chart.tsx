import { useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SleepEntry } from '@knowledge-base/contracts'
import { sleepClockLabel } from '@knowledge-base/contracts'
import {
  DETAIL_AXIS_MINUTES,
  entryAxisMinutes,
  monthDateTicks,
  yearMonthTicks,
} from './sleep-detail-layout'
import { smoothSegmentPath } from './sleep-chart'

const VIEW_WIDTH = 840
const VIEW_HEIGHT = 360
const LEFT = 40
const RIGHT = 16
const TOP = 12
const BOTTOM = 36

export interface SleepHistoryChartProps {
  dates: string[]
  entries: SleepEntry[]
  today: string
  mode: 'month' | 'year'
  ariaLabel: string
}

interface ChartPoint { x: number; y: number; index: number }

/**
 * 详情折线图：月视图 30 多个点、年视图 365 个点，都是同一根 06 → 次日 06 轴。
 * 起床橙线在上、入睡紫线在下；缺数据的日期断线，不插值。
 */
export function SleepHistoryChart({ dates, entries, today, mode, ariaLabel }: SleepHistoryChartProps) {
  const byDate = useMemo(() => new Map(entries.map(entry => [entry.sleepDate, entry])), [entries])
  const [hovered, setHovered] = useState<number>()
  const count = Math.max(1, dates.length)
  const plotWidth = VIEW_WIDTH - LEFT - RIGHT
  const plotHeight = VIEW_HEIGHT - TOP - BOTTOM
  const step = plotWidth / count
  const xOf = (index: number) => LEFT + step * (index + 0.5)
  const yOf = (minute: number) => TOP + (minute / DETAIL_AXIS_MINUTES) * plotHeight

  const wakeSegments: ChartPoint[][] = []
  const bedSegments: ChartPoint[][] = []
  let wakeRun: ChartPoint[] | undefined
  let bedRun: ChartPoint[] | undefined

  dates.forEach((date, index) => {
    const minutes = entryAxisMinutes(byDate.get(date))
    if (minutes.wake !== undefined) {
      const point = { x: xOf(index), y: yOf(minutes.wake), index }
      wakeRun = wakeRun ?? []
      if (wakeRun.length === 0) wakeSegments.push(wakeRun)
      wakeRun.push(point)
    } else {
      wakeRun = undefined
    }
    if (minutes.bed !== undefined) {
      const point = { x: xOf(index), y: yOf(minutes.bed), index }
      bedRun = bedRun ?? []
      if (bedRun.length === 0) bedSegments.push(bedRun)
      bedRun.push(point)
    } else {
      bedRun = undefined
    }
  })

  const hourly = mode === 'month'
  const gridMinutes = hourly
    ? Array.from({ length: 25 }, (_, index) => index * 60)
    : [0, 360, 720, 1080, 1440]
  const gridLabel = (minute: number): string | undefined => {
    if (hourly) return String(Math.floor(((minute + 6 * 60) % 1440) / 60)).padStart(2, '0')
    if (minute === 0) return '06'
    if (minute === 360) return '12'
    if (minute === 720) return '18'
    if (minute === 1080) return '00'
    if (minute === 1440) return '06'
    return undefined
  }

  const ticks = hourly ? monthDateTicks(dates) : yearMonthTicks(dates)
  const hoveredDate = hovered !== undefined ? dates[hovered] : undefined
  const hoveredEntry = hoveredDate ? byDate.get(hoveredDate) : undefined
  const tooltipLeft = hovered !== undefined ? Math.min(90, Math.max(10, (xOf(hovered) / VIEW_WIDTH) * 100)) : 0
  const pointRadius = hourly ? 3 : 1.2
  const lineWidth = hourly ? 2.2 : 1.6
  const lineOpacity = hourly ? 0.82 : 0.55
  const curveTension = hourly ? 0.8 : 0.65

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH
    const index = Math.floor((x - LEFT) / step)
    setHovered(index >= 0 && index < dates.length ? index : undefined)
  }

  const clock = (iso?: string) => (iso ? sleepClockLabel(iso) : undefined) ?? '—'

  return <div className='sleep-history-chart-wrap'>
    <svg
      className='sleep-history-chart'
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role='img'
      aria-label={ariaLabel}
      preserveAspectRatio='xMidYMid meet'
      onMouseMove={handleMove}
      onMouseLeave={() => setHovered(undefined)}
    >
      {gridMinutes.map(minute => {
        const label = gridLabel(minute)
        return <g key={`grid-${minute}`}>
          <line x1={LEFT} x2={VIEW_WIDTH - RIGHT} y1={yOf(minute)} y2={yOf(minute)} className='sleep-history-grid' />
          {label && <text x={2} y={yOf(minute) + 3} className='sleep-history-axis'>{label}</text>}
        </g>
      })}
      <text x={2} y={TOP + plotHeight + 12} className='sleep-history-axis'>次日</text>

      <line
        x1={LEFT}
        x2={VIEW_WIDTH - RIGHT}
        y1={yOf(18 * 60)}
        y2={yOf(18 * 60)}
        className='sleep-history-midnight'
      />
      <text x={2} y={yOf(18 * 60) + 3} className='sleep-history-midnight-label'>00:00</text>

      {ticks.map(tick => <text
        key={`tick-${tick.index}`}
        x={xOf(tick.index)}
        y={VIEW_HEIGHT - 14}
        textAnchor={tick.index === 0 ? 'start' : tick.index === dates.length - 1 ? 'end' : 'middle'}
        className={`sleep-history-date ${dates[tick.index] === today ? 'is-today' : ''}`}
      >{tick.label}</text>)}
      {today && dates.includes(today) && <text
        x={xOf(dates.indexOf(today))}
        y={VIEW_HEIGHT - 4}
        textAnchor='middle'
        className='sleep-history-today'
      >今天</text>}

      {hovered !== undefined && <line
        x1={xOf(hovered)}
        x2={xOf(hovered)}
        y1={TOP}
        y2={TOP + plotHeight}
        className='sleep-history-cursor'
      />}

      {wakeSegments.map((segment, index) => segment.length > 1
        ? <path key={`wake-${index}`} d={smoothSegmentPath(segment, VIEW_HEIGHT, { top: TOP, bottom: VIEW_HEIGHT - BOTTOM }, curveTension)} className='sleep-history-line is-wake' fill='none' strokeWidth={lineWidth} strokeOpacity={lineOpacity} />
        : null)}
      {bedSegments.map((segment, index) => segment.length > 1
        ? <path key={`bed-${index}`} d={smoothSegmentPath(segment, VIEW_HEIGHT, { top: TOP, bottom: VIEW_HEIGHT - BOTTOM }, curveTension)} className='sleep-history-line is-bed' fill='none' strokeWidth={lineWidth} strokeOpacity={lineOpacity} />
        : null)}

      {wakeSegments.flat().map(point => <circle key={`wake-dot-${point.index}`} cx={point.x} cy={point.y} r={pointRadius} className='sleep-history-dot is-wake' />)}
      {bedSegments.flat().map(point => <circle key={`bed-dot-${point.index}`} cx={point.x} cy={point.y} r={pointRadius} className='sleep-history-dot is-bed' />)}
    </svg>

    {hoveredDate && <div className='sleep-chart-tooltip' style={{ left: `${tooltipLeft}%` }}>
      <span className='sleep-chart-tooltip-date'>{hoveredDate}</span>
      <span>起床 {hoveredEntry?.wakeAt ? clock(hoveredEntry.wakeAt) : '—'}</span>
      <span>入睡 {hoveredEntry?.bedAt ? clock(hoveredEntry.bedAt) : '未记录'}</span>
    </div>}
  </div>
}
