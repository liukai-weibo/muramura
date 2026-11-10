import { useCallback, useEffect, useRef, useState } from 'react'
import type { SleepEntry } from '@knowledge-base/contracts'
import { apiClient } from '../../../api-client'

/** 按年拉取睡眠记录，供详情弹窗的 30 天 / 全年视图共用；同一年只请求一次。 */
export function useSleepHistory(year: number) {
  const [entries, setEntries] = useState<SleepEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const cache = useRef(new Map<number, SleepEntry[]>())
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const cached = cache.current.get(year)
    if (cached) {
      setEntries(cached)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    apiClient.listSleepEntries({ from: `${year}-01-01`, to: `${year}-12-31` })
      .then(list => {
        if (cancelled) return
        cache.current.set(year, list)
        setEntries(list)
        setLoading(false)
      })
      .catch(cause => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : '读取睡眠记录失败')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [year, reloadKey])

  const reload = useCallback(() => {
    cache.current.delete(year)
    setReloadKey(key => key + 1)
  }, [year])

  return { entries, loading, error, reload }
}
