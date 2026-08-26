import { useEffect, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { HomeAiCard, HomeAiCardInput, HomeAiCardRefreshMode, HomeAiCardSize, HomeAiCardTheme } from '@knowledge-base/contracts'
import { HOME_AI_CARD_TITLE_MAX_LENGTH, HOME_AI_CARD_PROMPT_MAX_LENGTH } from '@knowledge-base/contracts'

interface HomeAiCardEditorModalProps {
  /** 编辑时传入；新增时 undefined */
  card?: HomeAiCard
  saving?: boolean
  error?: string
  onSave: (input: HomeAiCardInput) => void
  onClose: () => void
}

const sizeLabels: Record<HomeAiCardSize, string> = { small: '小（紧凑）', medium: '中（标准）', large: '大（整行）' }
const themeLabels: Record<HomeAiCardTheme, string> = { cream: '浅奶油', green: '浅绿', beige: '浅米黄' }

export function HomeAiCardEditorModal({ card, saving, error, onSave, onClose }: HomeAiCardEditorModalProps) {
  const [cardTitle, setCardTitle] = useState(card?.cardTitle ?? '')
  const [aiPrompt, setAiPrompt] = useState(card?.aiPrompt ?? '')
  const [cardSize, setCardSize] = useState<HomeAiCardSize>(card?.cardSize ?? 'medium')
  const [cardTheme, setCardTheme] = useState<HomeAiCardTheme>(card?.cardTheme ?? 'cream')
  const [refreshMode, setRefreshMode] = useState<HomeAiCardRefreshMode>(card?.refreshMode ?? 'daily')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const titleTrimmed = cardTitle.trim()
  const promptTrimmed = aiPrompt.trim()
  const canSave = Boolean(titleTrimmed && promptTrimmed && !saving)

  const handleSave = () => {
    if (!canSave) return
    onSave({ cardTitle: titleTrimmed, aiPrompt: promptTrimmed, cardSize, cardTheme, refreshMode })
  }

  return (
    <View className='home-ai-card-editor-backdrop' role='dialog' aria-modal='true' aria-label={card ? '编辑AI卡片' : '新增AI卡片'} onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <View className='home-ai-card-editor-card'>
        <View className='home-ai-card-editor-heading'>
          <Text className='home-ai-card-editor-title'>{card ? '编辑AI卡片' : '新增AI卡片'}</Text>
          <View className='home-ai-card-editor-close' onClick={() => { if (!saving) onClose() }}><Text>✕</Text></View>
        </View>

        <View className='home-ai-card-editor-body'>
          <View className='home-ai-card-editor-field'>
            <Text className='home-ai-card-editor-label'>卡片标题</Text>
            <Input
              className='home-ai-card-editor-input'
              value={cardTitle}
              maxlength={HOME_AI_CARD_TITLE_MAX_LENGTH}
              placeholder='例如：本周复盘'
              onInput={(event) => setCardTitle(event.detail.value)}
            />
          </View>

          <View className='home-ai-card-editor-field'>
            <Text className='home-ai-card-editor-label'>AI 提示指令</Text>
            <Textarea
              className='home-ai-card-editor-textarea'
              value={aiPrompt}
              maxlength={HOME_AI_CARD_PROMPT_MAX_LENGTH}
              placeholder='例如：读取我近7天情绪记录，总结我的情绪变化，给出简短建议'
              onInput={(event) => setAiPrompt(event.detail.value)}
            />
            <Text className='home-ai-card-editor-hint'>AI 会自动结合你的手记/事项/情绪/三餐记录来回答。</Text>
          </View>

          <View className='home-ai-card-editor-field'>
            <Text className='home-ai-card-editor-label'>卡片尺寸</Text>
            <View className='home-ai-card-editor-options'>
              {(Object.keys(sizeLabels) as HomeAiCardSize[]).map(size => (
                <View key={size} className={`home-ai-card-editor-option${cardSize === size ? ' selected' : ''}`} onClick={() => setCardSize(size)}>
                  <Text>{sizeLabels[size]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='home-ai-card-editor-field'>
            <Text className='home-ai-card-editor-label'>卡片底色</Text>
            <View className='home-ai-card-editor-options'>
              {(Object.keys(themeLabels) as HomeAiCardTheme[]).map(theme => (
                <View key={theme} className={`home-ai-card-editor-option theme-option-${theme}${cardTheme === theme ? ' selected' : ''}`} onClick={() => setCardTheme(theme)}>
                  <Text>{themeLabels[theme]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='home-ai-card-editor-field'>
            <Text className='home-ai-card-editor-label'>刷新方式</Text>
            <View className='home-ai-card-editor-options'>
              <View className={`home-ai-card-editor-option${refreshMode === 'daily' ? ' selected' : ''}`} onClick={() => setRefreshMode('daily')}>
                <Text>☀️ 每日打开自动刷新</Text>
              </View>
              <View className={`home-ai-card-editor-option${refreshMode === 'manual' ? ' selected' : ''}`} onClick={() => setRefreshMode('manual')}>
                <Text>🔄 仅手动点击刷新</Text>
              </View>
            </View>
          </View>

          {error ? <Text className='home-ai-card-editor-error'>{error}</Text> : null}
        </View>

        <View className='home-ai-card-editor-actions'>
          <Button className='home-ai-card-editor-cancel' disabled={saving} onClick={onClose}>取消</Button>
          <Button className='home-ai-card-editor-save' disabled={!canSave} onClick={handleSave}>{saving ? '保存中…' : '保存'}</Button>
        </View>
      </View>
    </View>
  )
}