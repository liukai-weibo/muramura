import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailySummary } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort } from '../../api-client'
import { SUMMARY_PROMPT } from './daily-summary-auto'
import { todayLocalDate } from '../mood/mood-levels'

interface DailySummaryDetailModalProps {
  /** 保留接口兼容（index.tsx 仍传入）；当前固定展示今天，忽略该值 */
  initialDate?: string
  onClose: () => void
  onChanged?: () => void
}

export function DailySummaryDetailModal({ initialDate, onClose, onChanged }: DailySummaryDetailModalProps) {
  const today = todayLocalDate()
  const [summary, setSummary] = useState<DailySummary | undefined>()
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [aiUnavailable, setAiUnavailable] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setAiUnavailable(false)
    setSummary(undefined)
    apiClient.getDailySummary(today)
      .then((value) => { if (!cancelled) setSummary(value ?? undefined) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today])

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    setError('')
    setAiUnavailable(false)
    const controller = new AbortController()
    let output = ''
    try {
      const status = await apiClient.getAiConfigStatus()
      if (!status.configured) { setAiUnavailable(true); return }
      for await (const event of apiClient.streamExperimentalAiChatEphemeral([{ role: 'user', content: SUMMARY_PROMPT }], controller.signal)) {
        if (event.type === 'token') output += event.content
        if (event.type === 'incomplete' || event.type === 'error') { setError('生成未完成，请稍后重试') ; return }
      }
      if (!output.trim()) { setError('生成结果为空，请稍后重试'); return }
      await apiClient.upsertDailySummary(today, output.trim())
      const saved = await apiClient.getDailySummary(today)
      setSummary(saved ?? undefined)
      onChanged?.()
    } catch (cause: unknown) {
      if (isApiClientAbort(cause) || (cause instanceof Error && cause.name === 'AbortError')) return
      setError(cause instanceof Error ? cause.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <View className='daily-summary-modal-backdrop' role='dialog' aria-modal='true' aria-label='近期状态小结' onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <View className='daily-summary-modal-card'>
        <View className='daily-summary-modal-heading'>
          <Text className='daily-summary-modal-title'>近期状态小结</Text>
          <View className='daily-summary-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <View className='daily-summary-modal-body'>
          {loading ? (
            <Text className='daily-summary-modal-hint'>加载中…</Text>
          ) : summary ? (
            <View className='daily-summary-modal-content'>{summary.content.split('\n').map((line, index) => <Text key={index} style={{ display: 'block' }}>{line || '\u00a0'}</Text>)}</View>
          ) : error ? (
            <View className='daily-summary-modal-empty'><Text className='daily-summary-modal-error'>{error}</Text></View>
          ) : aiUnavailable ? (
            <View className='daily-summary-modal-empty'><Text className='daily-summary-modal-error'>AI 尚未配置，无法生成状态小结。请在「我 → AI 参数」中配置后重试。</Text></View>
          ) : (
            <View className='daily-summary-modal-empty'>
              <Text className='daily-summary-modal-empty-text'>最近还没有状态小结。</Text>
              <Text className='daily-summary-modal-empty-hint'>可以基于你的手记/事项/复盘，自动生成一份近期状态小结。</Text>
            </View>
          )}
        </View>

        {!summary && !loading && !error && (
          <View className='daily-summary-modal-actions'>
            <Button className='daily-summary-modal-generate' disabled={generating} onClick={handleGenerate} style={{ width: '100%' }}>
              {generating ? '生成中…' : aiUnavailable ? '已配置后重试' : '生成近期状态小结'}
            </Button>
          </View>
        )}

        <Text className='daily-summary-modal-footnote'>小结由 AI 基于你的记录自动生成，可随时点按重新生成。</Text>
      </View>
    </View>
  )
}
