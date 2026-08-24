import { useEffect, useRef, useState } from 'react'
import { Button, Text, Textarea, View } from '@tarojs/components'
import type { MoodEntry, MoodEntryInput, MoodLevel } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import { formatLocalDateCN } from '../calendar-utils'
import { moodLevelColors, moodLevelColorsDark, moodLevelConfigs, moodLevelLabels, todayLocalDate } from './mood-levels'

interface MoodRecordModalProps {
  initial?: MoodEntry
  /** 新建时预填的日期；未提供时默认今天（编辑模式沿用 initial.entryDate） */
  initialDate?: string
  colorTheme: ColorTheme
  onClose: () => void
  onSave: (input: MoodEntryInput) => Promise<void>
  onReloadData: () => void
}

export function MoodRecordModal({ initial, initialDate, colorTheme, onClose, onSave, onReloadData }: MoodRecordModalProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
  const [content, setContent] = useState(initial?.content ?? '')
  const [moodLevel, setMoodLevel] = useState<MoodLevel>(initial?.moodLevel ?? 3)
  const [response, setResponse] = useState(initial?.response ?? '')
  const [entryDate] = useState(initial?.entryDate ?? initialDate ?? todayLocalDate())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const [dirty, setDirty] = useState(false)

  const handleSubmit = async () => {
    if (!content.trim()) { setError('先写点什么再保存吧～'); return }
    setBusy(true); setError(''); setUnknownOutcome(false)
    try {
      await onSave({ content: content.trim(), moodLevel, response: response.trim() || undefined, entryDate })
      // parent closes modal on success
    } catch (e: unknown) {
      const err = e as any
      if (err?.status === undefined) {
        setUnknownOutcome(true)
        setError('提交结果未确认，请重新读取真实数据后确认是否已生效。')
      } else {
        setError(err?.message ?? '保存失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const submitRef = useRef(handleSubmit)
  submitRef.current = handleSubmit
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void submitRef.current()
      }
    }
    // 用捕获阶段：Taro Textarea 会把原生键盘事件在冒泡前拦截并重派发为 CustomEvent，
    // 冒泡到 window 时已丢失 key/ctrlKey，只有捕获阶段能看到可信的原生 KeyboardEvent。
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <View className='mood-modal-backdrop' role='dialog' aria-modal='true' aria-label={initial ? '编辑情绪记录' : '新建情绪记录'}>
      <View className='mood-modal-card'>
        <View className='mood-modal-heading'>
          <View className='mood-modal-heading-main'>
            <View className='mood-modal-heading-icon' aria-hidden='true'><Text className='mood-modal-heading-emoji'>💗</Text></View>
            <View className='mood-modal-title-wrap'>
              <Text className='mood-modal-title'>{initial ? '编辑情绪记录' : '新建情绪记录'}</Text>
              <Text className='mood-date-readonly'>{formatLocalDateCN(entryDate)}</Text>
            </View>
          </View>
          <View className='mood-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <View className='mood-field'>
          <Text className='mood-field-label'>发生了什么</Text>
          <Textarea className='mood-field-textarea' value={content} placeholder='简单记录一件小事～' onInput={e => { setContent(e.detail.value); setDirty(true) }} />
        </View>

        <View className='mood-field'>
          <Text className='mood-field-label'>今天状态怎么样？</Text>
          <View className='mood-pill-row'>
            {moodLevelConfigs.map(config => (
              <View
                key={config.level}
                className={'mood-pill' + (moodLevel === config.level ? ' selected' : '')}
                style={{ background: palette[config.level] }}
                onClick={() => { setMoodLevel(config.level); setDirty(true) }}
              >
                <Text>{moodLevelLabels[config.level]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='mood-field'>
          <Text className='mood-field-label'>补充感受与对策（可选）</Text>
          <Textarea className='mood-field-textarea' value={response} placeholder='当下的感受，下次怎么应对 / 延续' onInput={e => { setResponse(e.detail.value); setDirty(true) }} />
        </View>

        {error && <Text className='mood-form-error'>{error}</Text>}
        {unknownOutcome && (
          <View className='mood-unknown-outcome'>
            <Text>提交结果未确认，未自动重试。请重新读取真实数据后确认是否已生效。</Text>
            <View style={{ marginTop: 6 }}><Button onClick={onReloadData} style={{ fontSize: 11, minHeight: 30, padding: '0 10px' }}>重新读取真实数据</Button></View>
          </View>
        )}
        <View className='mood-modal-actions'>
          <Button onClick={onClose}>取消</Button>
          <Button className='primary' onClick={handleSubmit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
        </View>
      </View>
    </View>
  )
}
