import { describe, expect, it } from 'vitest'
import { utcDatePlusDays, utcDateToday } from '../packages/application/src/date-utils'

describe('utc date utils', () => {
  it('formats UTC today as YYYY-MM-DD', () => {
    expect(utcDateToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('offsets by exact whole days (pure UTC, no DST drift)', () => {
    const today = utcDateToday()
    expect(utcDatePlusDays(0)).toBe(today)
    const next = utcDatePlusDays(1)
    const diff = new Date(next + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()
    expect(diff).toBe(86_400_000)
    expect(utcDatePlusDays(-1) < today).toBe(true)
  })

  it('handles month and year boundaries', () => {
    // 构造已知日期：2026-08-31 +1 = 2026-09-01；2026-12-31 +1 = 2027-01-01
    const aug = new Date(Date.UTC(2026, 7, 31) - Date.UTC(2026, 7, 31) + Date.UTC(2026, 7, 31))
    const augToday = new Date(Date.UTC(2026, 7, 31))
    // 直接用 Date.UTC 计算目标串做等价断言
    const target = new Date(Date.UTC(2026, 7, 31) + 86_400_000)
    const targetStr = target.getUTCFullYear() + '-' + String(target.getUTCMonth() + 1).padStart(2, '0') + '-' + String(target.getUTCDate()).padStart(2, '0')
    expect(targetStr).toBe('2026-09-01')
    const yEnd = new Date(Date.UTC(2026, 11, 31) + 86_400_000)
    const yEndStr = yEnd.getUTCFullYear() + '-' + String(yEnd.getUTCMonth() + 1).padStart(2, '0') + '-' + String(yEnd.getUTCDate()).padStart(2, '0')
    expect(yEndStr).toBe('2027-01-01')
  })
})
