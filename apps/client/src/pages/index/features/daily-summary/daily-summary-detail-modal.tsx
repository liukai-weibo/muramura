import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailySummary } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { ExperimentalAiMarkdown } from '../../experimental-ai/components/experimental-ai-markdown'
import { todayLocalDate } from '../mood/mood-levels'

interface DailySummaryDetailModalProps {
  /** 保留接口兼容（index.tsx 仍传入）；当前固定展示今天，忽略该值 */
  initialDate?: string
  /** 页面级生成状态：弹窗关闭后生成仍在后台，重开弹窗继续显示实时草稿 */
  generating?: boolean
  draft?: string
  aiUnavailable?: boolean
  onGenerate?: () => void
  onClose: () => void
  onChanged?: () => void
}

export function DailySummaryDetailModal({ initialDate, onClose, onChanged, generating = false, draft, aiUnavailable = false, onGenerate }: DailySummaryDetailModalProps) {
  const today = todayLocalDate()
  const [summary, setSummary] = useState<DailySummary | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSummary(undefined)
    apiClient.getDailySummary(today)
      .then((value) => { if (!cancelled) setSummary(value ?? undefined) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today])

  // 生成交由页面级任务（onGenerate），弹窗只负责展示流式草稿与结果；关闭弹窗不会中断后台生成。

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
          ) : draft ? (
            <View className='daily-summary-modal-live'>
              <Text className='daily-summary-modal-live-text'>{draft}</Text>
              <Text className='generation-cursor' aria-hidden='true'>▍</Text>
            </View>
          ) : summary ? (
            <View className='daily-summary-modal-content'><ExperimentalAiMarkdown content={summary.content} /></View>
          ) : error ? (
            <View className='daily-summary-modal-empty'><Text className='daily-summary-modal-error'>{error}</Text></View>
          ) : aiUnavailable ? (
            <View className='daily-summary-modal-empty'><Text className='daily-summary-modal-error'>AI 尚未配置，无法生成状态小结。请在「我 → AI 参数」中配置后重试。</Text></View>
          ) : generating ? (
            <View className='daily-summary-modal-empty'><Text className='daily-summary-modal-hint'>生成中…</Text></View>
          ) : (
            <View className='daily-summary-modal-empty'>
              <Text className='daily-summary-modal-empty-text'>最近还没有状态小结。</Text>
              <Text className='daily-summary-modal-empty-hint'>可以基于你的手记/事项/复盘，自动生成一份近期状态小结。</Text>
            </View>
          )}
        </View>

        {!loading && !error && (
          <View className='daily-summary-modal-actions'>
            <Button className='daily-summary-modal-generate' disabled={generating} onClick={onGenerate} style={{ width: '100%' }}>
              {generating ? (draft ? '生成中…' : '生成中…') : aiUnavailable ? '已配置后重试' : summary ? '重新生成' : '生成近期状态小结'}
            </Button>
          </View>
        )}

        <Text className='daily-summary-modal-footnote'>小结由 AI 基于你的记录自动生成，可随时点按重新生成。</Text>
      </View>
    </View>
  )
}
