import { useEffect } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { ExperimentalAiMarkdown } from '../../experimental-ai/components/experimental-ai-markdown'
import type { HomeAiCard } from '@knowledge-base/contracts'

interface HomeAiCardDetailModalProps {
  card: HomeAiCard
  content?: string
  loading?: boolean
  generating?: boolean
  error?: string
  onRefresh: () => void
  onDelete: () => void
  onClose: () => void
}

export function HomeAiCardDetailModal({ card, content, loading, generating, error, onRefresh, onDelete, onClose }: HomeAiCardDetailModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !generating) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, generating])

  return (
    <View className='home-ai-card-detail-backdrop' role='dialog' aria-modal='true' aria-label={card.cardTitle} onClick={(event) => { if (event.target === event.currentTarget && !generating) onClose() }}>
      <View className='home-ai-card-detail-card'>
        <View className='home-ai-card-detail-heading'>
          <Text className='home-ai-card-detail-title'>{card.cardTitle}</Text>
          <View className='home-ai-card-detail-close' onClick={() => { if (!generating) onClose() }}><Text>✕</Text></View>
        </View>

        <View className='home-ai-card-detail-body'>
          {loading ? (
            <Text className='home-ai-card-detail-hint'>加载中…</Text>
          ) : content ? (
            <View className='home-ai-card-detail-content'><ExperimentalAiMarkdown content={content} /></View>
          ) : error ? (
            <View className='home-ai-card-detail-empty'><Text className='home-ai-card-detail-error'>{error}</Text></View>
          ) : (
            <View className='home-ai-card-detail-empty'>
              <Text className='home-ai-card-detail-empty-text'>🔄等待生成</Text>
              <Text className='home-ai-card-detail-empty-hint'>点击下方按钮，让 AI 基于你的记录生成内容。</Text>
            </View>
          )}
        </View>

        <View className='home-ai-card-detail-actions'>
          <Button className='home-ai-card-detail-refresh' disabled={generating} onClick={onRefresh}>
            {generating ? '生成中…' : '刷新内容'}
          </Button>
          <Button className='home-ai-card-detail-delete' disabled={generating} onClick={onDelete}>删除卡片</Button>
        </View>
        <Text className='home-ai-card-detail-footnote'>内容由 AI 基于你的记录生成，可随时刷新。</Text>
      </View>
    </View>
  )
}