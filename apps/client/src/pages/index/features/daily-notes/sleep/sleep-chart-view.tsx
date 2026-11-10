import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SleepChartDay, SleepChartStyle } from './sleep-chart'
import { sleepClockLabel } from '@knowledge-base/contracts'
import { axisClockLabel, columnAtX, columnCenterX, sleepChartLayout, smoothSegmentPath } from './sleep-chart'

const CHART_WIDTH = 264
const CHART_HEIGHT = 148

export interface SleepChartProps {
  series: SleepChartDay[]
  /** 东八区今天，用来在横轴标出「今天」。 */
  today?: string
  style?: SleepChartStyle
  /** 点击图表或按 Enter 时打开详情。 */
  onExpand?: () => void
  /** 供读屏与测试定位；默认「睡眠折线图」。 */
  ariaLabel?: string
}

const formatMonthDay = (date: string) => date.slice(5).replace('-', '/')

/**
 * 睡眠折线图：单根连续轴 06:00 → 次日 06:00，起床在上、入睡在下。
 * 鼠标悬停显示当天两个时间；点击打开 30 天 / 全年详情。
 */
export function SleepChart({ series, today, style = 'linear', onExpand, ariaLabel = '睡眠折线图' }: SleepChartProps) {
  const layout = sleepChartLayout(series, { width: CHART_WIDTH, height: CHART_HEIGHT })
  const [active, setActive] = useState<number>()

  const points = (segment: Array<{ x: number; y: number }>) => segment.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')

  const renderSegment = (segment: NonNullable<typeof layout.wakeSegments[number]>, key: string, kind: 'wake' | 'bed') => {
    if (segment.length < 2) return null
    const className = `sleep-chart-line is-${kind}`
    if (style === 'smooth') {
      return <path key={key} d={smoothSegmentPath(segment, layout.height, undefined, 0.8)} className={className} fill='none' />
    }
    return <polyline key={key} points={points(segment)} className={className} fill='none' />
  }

  const clockOf = (point: { at?: string; minute: number }) =>
    (point.at ? sleepClockLabel(point.at) : undefined) ?? axisClockLabel(point.minute)

  const activeDay = active !== undefined ? series[active] : undefined
  const activeX = active !== undefined ? columnCenterX(layout, active) : 0
  const tooltipLeft = Math.min(86, Math.max(14, (activeX / layout.width) * 100))

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const x = ((event.clientX - rect.left) / rect.width) * layout.width
    setActive(columnAtX(layout, x))
  }

  return <div
    className='sleep-chart-wrap'
    role='button'
    tabIndex={0}
    aria-label='打开睡眠详情'
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onExpand?.()
    }}
  >
    <svg
      className='sleep-chart'
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role='img'
      aria-label={`${ariaLabel}，点击查看 30 天详情`}
      preserveAspectRatio='none'
      onMouseMove={handleMove}
      onMouseLeave={() => setActive(undefined)}
      onClick={() => onExpand?.()}
    >
      {layout.grid.map(line => <g key={`grid-${line.minute}`}>
        <line x1={30} x2={layout.width - 8} y1={line.y} y2={line.y} className='sleep-chart-grid' />
        {line.label && <text x={2} y={line.y + 3} className='sleep-chart-axis'>{line.label}</text>}
      </g>)}
      <text x={2} y={layout.plotBottom + 11} className='sleep-chart-axis'>次日</text>

      {layout.ticks.map(tick => <g key={`tick-${tick.date}`}>
        <line x1={tick.x} x2={tick.x} y1={layout.plotTop} y2={layout.plotBottom} className='sleep-chart-tick-line' />
        <text x={tick.x} y={layout.height - 13} textAnchor={tick.anchor} className='sleep-chart-tick'>{tick.label}</text>
        {today === tick.date && <text x={tick.x} y={layout.height - 3} textAnchor={tick.anchor} className='sleep-chart-tick is-today'>今天</text>}
      </g>)}

      <line
        x1={30}
        x2={layout.width - 8}
        y1={layout.midnightY}
        y2={layout.midnightY}
        className='sleep-chart-midnight'
      />
      <text x={2} y={layout.midnightY + 3} className='sleep-chart-midnight-label'>00:00</text>

      {active !== undefined && <line
        x1={activeX}
        x2={activeX}
        y1={layout.plotTop}
        y2={layout.plotBottom}
        className='sleep-chart-cursor'
      />}

      {layout.wakeSegments.map((segment, index) => renderSegment(segment, `wake-${index}`, 'wake'))}
      {layout.bedSegments.map((segment, index) => renderSegment(segment, `bed-${index}`, 'bed'))}

      {layout.wakeDots.map(point => <circle key={`wake-${point.date}`} cx={point.x} cy={point.y} r={3} className='sleep-chart-dot is-wake'>
        <title>{`${point.date} ${clockOf(point)} 起床`}</title>
      </circle>)}
      {layout.bedDots.map(point => <circle key={`bed-${point.date}`} cx={point.x} cy={point.y} r={3} className='sleep-chart-dot is-bed'>
        <title>{`${point.date}${point.nextDay ? ' 夜 · 次日' : ''} ${clockOf(point)} 入睡`}</title>
      </circle>)}
    </svg>

    {activeDay && <div className='sleep-chart-tooltip' style={{ left: `${tooltipLeft}%` }}>
      <span className='sleep-chart-tooltip-date'>{formatMonthDay(activeDay.date)}</span>
      <span>起床 {activeDay.wakeAt ? (sleepClockLabel(activeDay.wakeAt) ?? '—') : '—'}</span>
      <span>入睡 {activeDay.bedAt ? (activeDay.bedNextDay ? `次日 ${sleepClockLabel(activeDay.bedAt) ?? ''}` : (sleepClockLabel(activeDay.bedAt) ?? '—')) : '未记录'}</span>
    </div>}
  </div>
}
