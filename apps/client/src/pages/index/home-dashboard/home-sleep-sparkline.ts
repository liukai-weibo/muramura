import type { SleepChartDay } from '../features/daily-notes/sleep/sleep-chart'

export interface SparkPoint { x: number; y: number }

export interface SparklineLayout {
  width: number
  height: number
  wakeSegments: SparkPoint[][]
  bedSegments: SparkPoint[][]
}

/**
 * 首页卡片的 7 天迷你趋势：两条线分别适度放大，起床在上、入睡在下。
 * 仅用于无刻度的小图；详细图仍使用真实的连续时间轴。
 * 缺数据断开，不插值；单点也会保留，画成一个小圆点。
 */
export function buildSleepSparkline(series: SleepChartDay[], width: number, height: number): SparklineLayout {
  const padding = 3
  const plotWidth = Math.max(1, width - padding * 2)
  const plotHeight = Math.max(1, height - padding * 2)
  const step = series.length > 1 ? plotWidth / (series.length - 1) : 0
  const xOf = (index: number) => padding + (series.length > 1 ? step * index : plotWidth / 2)
  const collect = (key: 'wakeMinute' | 'bedMinute'): SparkPoint[][] => {
    const values = series.map(day => day[key]).filter((value): value is number => value !== undefined)
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 0
    // 每条线使用至少四小时的局部窗口，避免几分钟差异被夸大成剧烈波动。
    const span = Math.max(240, max - min)
    const center = (min + max) / 2
    const bandHeight = plotHeight * 0.4
    const bandTop = key === 'wakeMinute' ? padding : padding + plotHeight * 0.6
    const yOf = (minute: number) => bandTop + ((minute - center) / span + 0.5) * bandHeight
    const segments: SparkPoint[][] = []
    let run: SparkPoint[] | undefined
    series.forEach((day, index) => {
      const minute = day[key]
      if (minute === undefined) { run = undefined; return }
      run = run ?? []
      if (run.length === 0) segments.push(run)
      run.push({ x: xOf(index), y: yOf(minute) })
    })
    return segments
  }

  return { width, height, wakeSegments: collect('wakeMinute'), bedSegments: collect('bedMinute') }
}
