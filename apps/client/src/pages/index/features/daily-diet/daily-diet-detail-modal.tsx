import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailyDietRecommendation } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { ExperimentalAiMarkdown } from '../../experimental-ai/components/experimental-ai-markdown'
import { todayLocalDate } from '../mood/mood-levels'

interface DailyDietDetailModalProps {
  /** 保留接口兼容（index.tsx 仍传入）；当前固定展示今天，忽略该值 */
  initialDate?: string
  /** 页面级生成状态：弹窗关闭后生成仍在后台，重开弹窗继续显示实时草稿 */
  generating?: boolean
  draft?: string
  aiUnavailable?: boolean
  /** 页面内容变更信号：生成完成落库后递增，弹窗自动重拉最新记录 */
  refreshTick?: number
  onGenerate?: () => void
  onClose: () => void
  onChanged?: () => void
}

export function DailyDietDetailModal({ initialDate, onClose, onChanged, generating = false, draft, aiUnavailable = false, refreshTick = 0, onGenerate }: DailyDietDetailModalProps) {
  const today = todayLocalDate()
  const [recommendation, setRecommendation] = useState<DailyDietRecommendation | undefined>()
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
    setRecommendation(undefined)
    apiClient.getDailyDietRecommendation(today)
      .then((value) => { if (!cancelled) setRecommendation(value ?? undefined) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [today, refreshTick])

  // 生成交由页面级任务（onGenerate），弹窗只负责展示流式草稿与结果；关闭弹窗不会中断后台生成。

  return (
    <View className='daily-diet-modal-backdrop' role='dialog' aria-modal='true' aria-label='今日饮食推荐' onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <View className='daily-diet-modal-card'>
        <View className='daily-diet-modal-heading'>
          <Text className='daily-diet-modal-title'>今日饮食推荐</Text>
          <View className='daily-diet-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <View className='daily-diet-modal-body'>
          {loading ? (
            <Text className='daily-diet-modal-hint'>加载中…</Text>
          ) : draft ? (
            <View className='daily-diet-modal-live'>
              <Text className='daily-diet-modal-live-text'>{draft}</Text>
              <Text className='generation-cursor' aria-hidden='true'>▍</Text>
            </View>
          ) : recommendation ? (
            <View className='daily-diet-modal-content'><ExperimentalAiMarkdown content={recommendation.content} /></View>
          ) : error ? (
            <View className='daily-diet-modal-empty'><Text className='daily-diet-modal-error'>{error}</Text></View>
          ) : aiUnavailable ? (
            <View className='daily-diet-modal-empty'><Text className='daily-diet-modal-error'>AI 尚未配置，无法生成今日推荐。请在「我 → AI 参数」中配置后重试。</Text></View>
          ) : generating ? (
            <View className='daily-diet-modal-empty'><Text className='daily-diet-modal-hint'>生成中…</Text></View>
          ) : (
            <View className='daily-diet-modal-empty'>
              <Text className='daily-diet-modal-empty-text'>今天还没有推荐。</Text>
              <Text className='daily-diet-modal-empty-hint'>可以基于你的记录（三餐/情绪/手记/事项），自动生成一份今日推荐。</Text>
            </View>
          )}
        </View>

        {!loading && !error && (
          <View className='daily-diet-modal-actions'>
            <Button className='daily-diet-modal-generate' disabled={generating} onClick={onGenerate} style={{ width: '100%' }}>
              {generating ? '生成中…' : aiUnavailable ? '已配置后重试' : recommendation ? '重新生成' : '生成今日推荐'}
            </Button>
          </View>
        )}

      </View>
    </View>
  )
}
