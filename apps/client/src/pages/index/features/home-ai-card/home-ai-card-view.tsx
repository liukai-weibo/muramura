import { Text, View } from '@tarojs/components'
import { ExperimentalAiMarkdown } from '../../experimental-ai/components/experimental-ai-markdown'
import type { HomeAiCard } from '@knowledge-base/contracts'

interface HomeAiCardViewProps {
  card: HomeAiCard
  /** 当日缓存内容；undefined 表示未生成 */
  preview?: string
  loading?: boolean
  failed?: boolean
  onOpen: () => void
  onEdit: () => void
}

const PREVIEW_LENGTH = 150

/** 截断预览：保留换行结构（供 Markdown 分段），断点回退到行尾，并剥离孤立的 ** 开标记避免残留。 */
function safePreview(raw: string, max: number): string {
  let cut = raw.replace(/[ \t]+/g, ' ').slice(0, max)
  const newline = cut.lastIndexOf('\n')
  if (newline > max * 0.6) cut = cut.slice(0, newline)
  const markers = cut.match(/\*\*/g)?.length ?? 0
  if (markers % 2 === 1) {
    const last = cut.lastIndexOf('**')
    if (last >= 0) cut = cut.slice(0, last)
  }
  return cut
}

export function HomeAiCardView({ card, preview, loading, failed, onOpen, onEdit }: HomeAiCardViewProps) {
  const themeClass = `theme-${card.cardTheme}`
  const sizeClass = `size-${card.cardSize}`
  const content = preview ? safePreview(preview, PREVIEW_LENGTH) : undefined
  return (
    <View className={`home-ai-card card-transition ${themeClass} ${sizeClass}${loading ? ' is-loading' : ''}`} role='button' aria-label={card.cardTitle} onClick={onOpen}>
      <View className='home-ai-card-glow' aria-hidden='true' />
      <View className='home-ai-card-copy'>
        <View className='home-ai-card-heading'>
          <Text className='home-ai-card-kicker'>{card.cardTitle}</Text>
          <View className='home-ai-card-edit' role='button' aria-label={`编辑${card.cardTitle}`} onClick={(event) => { event.stopPropagation(); onEdit() }}>
            <Text>⚙️</Text>
          </View>
        </View>
        {content ? (
          <View className='home-ai-card-content'><ExperimentalAiMarkdown content={content} />{preview && preview.length > PREVIEW_LENGTH ? <Text className='home-ai-card-content-more'>…</Text> : null}</View>
        ) : failed ? (
          <Text className='home-ai-card-failed'>❌生成失败，点击重试</Text>
        ) : loading ? (
          <Text className='home-ai-card-hint'>生成中…</Text>
        ) : (
          <Text className='home-ai-card-title'>🔄等待生成</Text>
        )}
        <Text className='home-ai-card-description'>{content ? '查看 →' : '点击查看详情'}</Text>
      </View>
    </View>
  )
}