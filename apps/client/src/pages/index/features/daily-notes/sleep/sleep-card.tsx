import { sleepClockLabel, sleepDurationLabel } from '@knowledge-base/contracts'
import { shanghaiDate } from '../daily-note-date'
import type { SleepController } from './use-sleep'
import { buildSleepSeries, latestCompleteNight } from './sleep-chart'
import { SleepChart } from './sleep-chart-view'

export interface SleepCardProps {
  sleep: SleepController
  onRecord: () => void
  onSettings: () => void
  onExpand: () => void
}

/**
 * 右侧睡眠卡：最近一夜摘要 + 按夜折线图 + 记录/设置入口。
 * 一次记录只描述一天（当天起床 + 当晚入睡），「一夜」由相邻两天的记录拼出来。
 */
export function SleepCard({ sleep, onRecord, onSettings, onExpand }: SleepCardProps) {
  const today = shanghaiDate()
  const series = buildSleepSeries(sleep.entries, sleep.range, today)
  const night = latestCompleteNight(sleep.entries, today)
  const todayEntry = sleep.entries.find(entry => entry.sleepDate === today)

  const summary = night
    ? `${sleepClockLabel(night.bedAt) ?? '--:--'} → ${sleepClockLabel(night.wakeAt) ?? '--:--'} · ${sleepDurationLabel(night.minutes)}`
    : todayEntry?.wakeAt
      ? `今早 ${sleepClockLabel(todayEntry.wakeAt) ?? '--:--'} 起床 · 今晚待记录`
      : '还没有睡眠记录'

  const hasData = sleep.entries.some(entry => entry.wakeAt || entry.bedAt)

  return <aside className='sleep-card' aria-label='睡眠'>
    <div className='sleep-card-head'>
      <div className='sleep-card-title-row'>
        <span className='sleep-card-title'>睡眠</span>
        <div className='sleep-card-title-actions'>
          <button type='button' className='sleep-card-expand' onClick={onExpand}>放大</button>
          <button type='button' className='sleep-card-settings' onClick={onSettings}>设置</button>
        </div>
      </div>
      <p className={`sleep-card-summary ${night || todayEntry?.wakeAt ? '' : 'is-empty'}`}>{sleep.loading ? '读取中…' : summary}</p>
    </div>

    <div className='sleep-range-tabs' role='tablist' aria-label='图表范围'>
      {([7, 14, 30] as const).map(days => <button
        key={days}
        type='button'
        role='tab'
        aria-selected={sleep.range === days}
        className={`sleep-range-tab ${sleep.range === days ? 'is-active' : ''}`}
        onClick={() => sleep.setRange(days)}
      >{days} 天</button>)}
    </div>

    {hasData
      ? <SleepChart series={series} today={today} style={sleep.chartStyle} onExpand={onExpand} ariaLabel={`近 ${sleep.range} 天睡眠折线图`} />
      : <p className='sleep-card-empty'>记下当天起床和入睡后，这里会出现按天的折线。</p>}

    <div className='sleep-card-legend'>
      <span className='sleep-legend is-wake'>起床</span>
      <span className='sleep-legend is-bed'>入睡</span>
    </div>

    {sleep.error && <p className='sleep-error' role='status'>{sleep.error}</p>}

    <div className='sleep-card-foot'>
      <button type='button' className='sleep-card-record' onClick={onRecord}>记录睡眠</button>
    </div>
  </aside>
}
