import { useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { useSleep } from '../features/daily-notes/sleep/use-sleep'
import { SleepEntryModal } from '../features/daily-notes/sleep/sleep-entry-modal'
import { SleepDetailModal } from '../features/daily-notes/sleep/sleep-detail-modal'
import { buildSleepSeries, smoothSegmentPath } from '../features/daily-notes/sleep/sleep-chart'
import { shanghaiDate } from '../features/daily-notes/daily-note-date'
import { buildSleepSparkline } from './home-sleep-sparkline'
import { buildHomeSleepSummary } from './home-sleep-summary'

/**
 * 首页睡眠卡：最近一晚摘要 + 7 天小条。
 * 点卡片进详情，点右上「记录」打开当天记录弹窗；保存后由 SLEEP_CHANGED_EVENT 自动刷新。
 */
export function HomeSleepCard() {
  const today = shanghaiDate()
  const sleep = useSleep()
  const [recordOpen, setRecordOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const summary = useMemo(() => buildHomeSleepSummary(sleep.entries, today), [sleep.entries, today])
  const week = useMemo(() => buildSleepSeries(sleep.entries, 7, today), [sleep.entries, today])
  const spark = useMemo(() => buildSleepSparkline(week, 96, 40), [week])
  const sparkPath = (points: Array<{ x: number; y: number }>) => smoothSegmentPath(points, 40, { top: 0, bottom: 40 }, 0.8)

  const openRecord = () => setRecordOpen(true)

  return <>
    <View
      className={`home-sleep-card card-transition is-${summary.state}`}
      role='button'
      aria-label='睡眠'
      onClick={() => setDetailOpen(true)}
    >
      <View className='home-sleep-card-glow' aria-hidden='true' />
      <View className='home-sleep-card-copy'>
        <Text className='home-sleep-card-kicker'>睡眠</Text>
        <Text className='home-sleep-card-title'>{summary.title}</Text>
        <Text className='home-sleep-card-description'>{summary.description}</Text>
      </View>
      <View className='home-sleep-card-side'>
        <svg className='home-sleep-spark' viewBox={`0 0 ${spark.width} ${spark.height}`} aria-hidden='true'>
          {spark.wakeSegments.map((segment, index) => segment.length > 1
            ? <path key={`wake-${index}`} d={sparkPath(segment)} className='home-sleep-spark-line is-wake' fill='none' />
            : null)}
          {spark.bedSegments.map((segment, index) => segment.length > 1
            ? <path key={`bed-${index}`} d={sparkPath(segment)} className='home-sleep-spark-line is-bed' fill='none' />
            : null)}
          {spark.wakeSegments.flat().map((point, index) => <circle key={`wake-dot-${index}`} cx={point.x} cy={point.y} r={1.8} className='home-sleep-spark-dot is-wake' />)}
          {spark.bedSegments.flat().map((point, index) => <circle key={`bed-dot-${index}`} cx={point.x} cy={point.y} r={1.8} className='home-sleep-spark-dot is-bed' />)}
        </svg>
        <Text className='home-sleep-card-action'>查看 →</Text>
      </View>
      <View
        className='home-sleep-record control-transition'
        role='button'
        aria-label='记录睡眠'
        onClick={event => { event.stopPropagation(); openRecord() }}
      >记录</View>
    </View>

    {recordOpen && <SleepEntryModal
      initialDate={today}
      {...(sleep.todayEntry ? { entry: sleep.todayEntry } : {})}
      entries={sleep.entries}
      precision={sleep.settings.inputPrecision}
      onClose={() => setRecordOpen(false)}
      onSave={(date, patch) => sleep.saveEntry(date, patch)}
      onDelete={(date: string) => sleep.removeEntry(date)}
    />}

    {detailOpen && <SleepDetailModal today={today} onClose={() => setDetailOpen(false)} />}
  </>
}
