import type { SleepChartDay } from '../features/daily-notes/sleep/sleep-chart'

export interface SparkPoint { x: number; y: number }

export interface SparklineLayout {
  width: number
  height: number
  wakeSegments: SparkPoint[][]
  bedSegments: SparkPoint[][]
}

/**
 * 首页卡片的 7 天迷你曲线：x 按天等距，y 是 06 → 次日 06 的连续轴。
 * 缺数据断开，不插值；单点也会保留，画成一个小圆点。
 */
export function buildSleepSparkline(series: SleepChartDay[], width: number, height: number): SparklineLayout {
  const padding = 3
  const plotWidth = Math.max(1, width - padding * 2)
  const plotHeight = Math.max(1, height - padding * 2)
  const step = series.length > 1 ? plotWidth / (series.length - 1) : 0
  const xOf = (index: number) => padding + (series.length > 1 ? step * index : plotWidth / 2)
  const yOf = (minute: number) => padding + (minute / (24 * 60)) * plotHeight

  const collect = (key: 'wakeMinute' | 'bedMinute'): SparkPoint[][] => {
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
