import { useEffect, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import type { MealDayInput, MealEntry, MealType } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { formatLocalDateCN } from '../calendar-utils'
import { mealFeelingColors, mealFeelingLabels, mealSatietyLevels, mealTypeEmojis, mealTypeLabels, mealTypeOrder, todayLocalDate } from './meal-levels'

interface MealDayModalProps {
  initialDate: string
  onClose: () => void
  onSaved: () => void
}

interface SlotDraft {
  content: string
  feeling: number
}

const emptySlots = (): Record<MealType, SlotDraft> => ({
  breakfast: { content: '', feeling: 0 },
  lunch: { content: '', feeling: 0 },
  dinner: { content: '', feeling: 0 },
})

export function MealDayModal({ initialDate, onClose, onSaved }: MealDayModalProps) {
  const [entryDate] = useState(initialDate || todayLocalDate())
  const [slots, setSlots] = useState<Record<MealType, SlotDraft>>(emptySlots)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknownOutcome, setUnknownOutcome] = useState(false)

  useEffect(() => {
    let active = true
    void apiClient.listMealEntries({ from: entryDate, to: entryDate }).then(entries => {
      if (!active) return
      const next = emptySlots()
      for (const entry of entries) {
        next[entry.mealType] = { content: entry.content, feeling: entry.feeling }
      }
      setSlots(next)
      setLoading(false)
    }).catch((e: unknown) => {
      if (!active) return
      setError((e as Error)?.message ?? '三餐记录读取失败')
      setLoading(false)
    })
    return () => { active = false }
  }, [entryDate])

  const setContent = (type: MealType, value: string) => {
    setSlots(prev => ({ ...prev, [type]: { ...prev[type], content: value } }))
  }

  const setFeeling = (type: MealType, value: number) => {
    setSlots(prev => ({ ...prev, [type]: { ...prev[type], feeling: value } }))
  }

  const handleSubmit = async () => {
    const meals: MealDayInput['meals'] = mealTypeOrder
      .map(mealType => ({ mealType, content: slots[mealType].content.trim(), feeling: slots[mealType].feeling }))
      .filter(slot => slot.content.length > 0 || slot.feeling !== 0)
    setBusy(true); setError(''); setUnknownOutcome(false)
    try {
      await apiClient.saveMealDay({ entryDate, meals })
      onSaved()
    } catch (e: unknown) {
      const err = e as any
      if (err?.status === undefined) {
        setUnknownOutcome(true)
        setError('提交结果未确认，请重新打开后确认是否已生效。')
      } else {
        setError(err?.message ?? '保存失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const hasAny = mealTypeOrder.some(type => slots[type].content.trim().length > 0 || slots[type].feeling !== 0)

  return (
    <View className='meal-modal-backdrop' role='dialog' aria-modal='true' aria-label='记录一日三餐'>
      <View className='meal-modal-card'>
        <View className='meal-modal-heading'>
          <View className='meal-modal-heading-main'>
            <View className='meal-modal-heading-icon' aria-hidden='true'><Text className='meal-modal-heading-emoji'>🍚</Text></View>
            <View className='meal-modal-title-wrap'>
              <Text className='meal-modal-title'>记录一日三餐</Text>
              <Text className='meal-date-readonly'>{formatLocalDateCN(entryDate)}</Text>
            </View>
          </View>
          <View className='meal-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        {loading && <Text className='meal-loading'>正在读取当天记录…</Text>}

        {!loading && mealTypeOrder.map(mealType => (
          <View key={mealType} className='meal-slot'>
            <View className='meal-slot-head'>
              <Text className='meal-slot-emoji' aria-hidden='true'>{mealTypeEmojis[mealType]}</Text>
              <Text className='meal-slot-label'>{mealTypeLabels[mealType]}</Text>
            </View>
            <Input
              className='meal-slot-input'
              value={slots[mealType].content}
              placeholder='吃了什么？（可简写）'
              maxlength={1000}
              onInput={e => setContent(mealType, e.detail.value)}
            />
            <View className='meal-feel-row'>
              <Text className='meal-feel-caption'>饱腹度</Text>
              <View className='meal-feel-pills'>
                {mealSatietyLevels.map(level => (
                  <View
                    key={level}
                    className={'meal-feel-pill' + (slots[mealType].feeling === level ? ' selected' : '')}
                    style={{ background: mealFeelingColors[level] }}
                    onClick={() => setFeeling(mealType, slots[mealType].feeling === level ? 0 : level)}
                  >
                    <Text>{mealFeelingLabels[level]}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))}

        {error && <Text style={{ color: '#ad5965', fontSize: 11 }}>{error}</Text>}
        {unknownOutcome && (
          <View className='meal-unknown-outcome'>
            <Text>提交结果未确认，未自动重试。请关闭后重新打开确认是否已生效。</Text>
          </View>
        )}

        <View className='meal-modal-actions'>
          <Button onClick={onClose}>取消</Button>
          <Button className='primary' onClick={handleSubmit} disabled={busy}>{busy ? '保存中…' : hasAny ? '保存' : '清空当天记录'}</Button>
        </View>
      </View>
    </View>
  )
}
