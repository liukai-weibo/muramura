import { useState, useRef } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { MoodEntry, MoodEntryInput, MoodLevel } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import { moodLevelColors, moodLevelColorsDark, moodLevelConfigs, todayLocalDate } from './mood-levels'

interface MoodRecordModalProps {
  initial?: MoodEntry
  colorTheme: ColorTheme
  onClose: () => void
  onSave: (input: MoodEntryInput) => Promise<void>
  onReloadData: () => void
}

export function MoodRecordModal({ initial, colorTheme, onClose, onSave, onReloadData }: MoodRecordModalProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
  const [content, setContent] = useState(initial?.content ?? '')
  const [moodLevel, setMoodLevel] = useState<MoodLevel>(initial?.moodLevel ?? 3)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [response, setResponse] = useState(initial?.response ?? '')
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? todayLocalDate())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const [dirty, setDirty] = useState(false)

  const addTag = () => {
    const trimmed = tagInput.trim()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    setTags([...tags, trimmed.slice(0, 20)])
    setTagInput('')
    setDirty(true)
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
    setDirty(true)
  }

  const handleSubmit = async () => {
    if (!content.trim()) { setError('请填写事件内容'); return }
    setBusy(true); setError(''); setUnknownOutcome(false)
    try {
      await onSave({ content: content.trim(), moodLevel, tags: tags.length > 0 ? tags : undefined, response: response.trim() || undefined, entryDate })
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

  return (
    <View className='mood-modal-backdrop' role='dialog' aria-modal='true' aria-label={initial ? '编辑情绪记录' : '新建情绪记录'}>
      <View className='mood-modal-card'>
        <View className='mood-modal-heading'>
          <Text>{initial ? '编辑情绪记录' : '新建情绪记录'}</Text>
          <View className='mood-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <Input value={entryDate} placeholder='日期（YYYY-MM-DD）' onInput={e => { setEntryDate(e.detail.value); setDirty(true) }} />
        <Textarea value={content} placeholder='发生了什么？（必填）' onInput={e => { setContent(e.detail.value); setDirty(true) }} />
        <Text>感受等级</Text>
        <View className='mood-dot-row'>
          {moodLevelConfigs.map(config => (
            <View
              key={config.level}
              className={`mood-dot ${moodLevel === config.level ? 'selected' : ''}`}
              style={{ background: palette[config.level] }}
              onClick={() => { setMoodLevel(config.level); setDirty(true) }}
            />
          ))}
        </View>

        <Text>标签</Text>
        <View style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Input value={tagInput} placeholder='输入标签' onInput={e => setTagInput(e.detail.value)}
            onConfirm={addTag} style={{ flex: 1 }} />
          <Button className='primary' onClick={addTag} style={{ flex: '0 0 auto', minHeight: 34, padding: '0 12px', fontSize: 11, borderRadius: 9999 }}>添加</Button>
        </View>
        {tags.length > 0 && (
          <View style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tags.map(tag => (
              <View key={tag} className='mood-card-tag' onClick={() => removeTag(tag)}>
                <Text>#{tag} ✕</Text>
              </View>
            ))}
          </View>
        )}

        <Textarea value={response} placeholder='感受对策（可选）' onInput={e => { setResponse(e.detail.value); setDirty(true) }} />

        {error && <Text style={{ color: '#ad5965', fontSize: 11 }}>{error}</Text>}
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
