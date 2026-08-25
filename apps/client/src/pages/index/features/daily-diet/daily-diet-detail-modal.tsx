import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DailyDietRecommendation } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort } from '../../api-client'
import { buildDietPrompt } from './daily-diet-auto'
import { todayLocalDate } from '../mood/mood-levels'

interface DailyDietDetailModalProps {
  /** 保留接口兼容（index.tsx 仍传入）；当前固定展示今天，忽略该值 */
  initialDate?: string
  onClose: () => void
  onChanged?: () => void
}

export function DailyDietDetailModal({ initialDate, onClose, onChanged }: DailyDietDetailModalProps) {
  const today = todayLocalDate()
  const [recommendation, setRecommendation] = useState<DailyDietRecommendation | undefined>()
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
    setRecommendation(undefined)
    apiClient.getDailyDietRecommendation(today)
      .then((value) => { if (!cancelled) setRecommendation(value ?? undefined) })
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
      for await (const event of apiClient.streamExperimentalAiChatEphemeral([{ role: 'user', content: await buildDietPrompt() }], controller.signal)) {
        if (event.type === 'token') output += event.content
        if (event.type === 'incomplete' || event.type === 'error') { setError('生成未完成，请稍后重试'); return }
      }
      if (!output.trim()) { setError('生成结果为空，请稍后重试'); return }
      await apiClient.upsertDailyDietRecommendation(today, output.trim())
      const saved = await apiClient.getDailyDietRecommendation(today)
      setRecommendation(saved ?? undefined)
      onChanged?.()
    } catch (cause: unknown) {
      if (isApiClientAbort(cause) || (cause instanceof Error && cause.name === 'AbortError')) return
      setError(cause instanceof Error ? cause.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

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
          ) : recommendation ? (
            <View className='daily-diet-modal-content'>{recommendation.content.split('\n').map((line, index) => <Text key={index} style={{ display: 'block' }}>{line || '\u00a0'}</Text>)}</View>
          ) : error ? (
            <View className='daily-diet-modal-empty'><Text className='daily-diet-modal-error'>{error}</Text></View>
          ) : aiUnavailable ? (
            <View className='daily-diet-modal-empty'><Text className='daily-diet-modal-error'>AI 尚未配置，无法生成今日推荐。请在「我 → AI 参数」中配置后重试。</Text></View>
          ) : (
            <View className='daily-diet-modal-empty'>
              <Text className='daily-diet-modal-empty-text'>今天还没有推荐。</Text>
              <Text className='daily-diet-modal-empty-hint'>可以基于你的记录（三餐/情绪/手记/事项），自动生成一份今日推荐。</Text>
            </View>
          )}
        </View>

        {!recommendation && !loading && !error && (
          <View className='daily-diet-modal-actions'>
            <Button className='daily-diet-modal-generate' disabled={generating} onClick={handleGenerate} style={{ width: '100%' }}>
              {generating ? '生成中…' : aiUnavailable ? '已配置后重试' : '生成今日推荐'}
            </Button>
          </View>
        )}

        <Text className='daily-diet-modal-footnote'>推荐由 AI 基于你的记录自动生成，可随时点按重新生成。</Text>
      </View>
    </View>
  )
}
