import { useEffect, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { DietProfile, DietProfileInput } from '@knowledge-base/contracts'
import { ACTIVITY_OPTIONS, GENDER_OPTIONS, GOAL_OPTIONS, loadDietProfile, saveDietProfile } from './daily-diet-profile'
import { DEFAULT_DIET_AI_PROMPT } from './daily-diet-auto'

interface DailyDietProfileModalProps {
  onClose: () => void
}

function toOptionalRaw(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? n : Number.NaN
}

/** 合并：用户本次填写的字段优先，未填写的沿用服务端当前值，避免部分编辑抹掉已存字段。 */
function mergeInput(current: DietProfileInput | undefined, field: Partial<DietProfileInput>): DietProfileInput {
  const base = current && Object.keys(current).length > 0 ? { ...current } : {}
  return { ...base, ...field }
}

function isDefaultPrompt(value: string): boolean {
  return value.trim() === DEFAULT_DIET_AI_PROMPT.trim()
}

export function DailyDietProfileModal({ onClose }: DailyDietProfileModalProps) {
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [goal, setGoal] = useState('')
  const [activity, setActivity] = useState('')
  const [healthNote, setHealthNote] = useState('')
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_DIET_AI_PROMPT)
  const [currentProfile, setCurrentProfile] = useState<DietProfileInput>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadDietProfile().then((p) => {
      if (cancelled) return
      setCurrentProfile(p)
      setHeight(p.heightCm != null ? String(p.heightCm) : '')
      setWeight(p.weightKg != null ? String(p.weightKg) : '')
      setAge(p.age != null ? String(p.age) : '')
      setGender(p.gender ?? '')
      setGoal(p.goal ?? '')
      setActivity(p.activity ?? '')
      setHealthNote(p.healthNote ?? '')
      setAiPrompt(p.aiPrompt?.trim() || DEFAULT_DIET_AI_PROMPT)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const save = async () => {
    if (saving) return
    const h = toOptionalRaw(height)
    const w = toOptionalRaw(weight)
    const a = toOptionalRaw(age)
    if ([h, w, a].some((v) => v !== undefined && Number.isNaN(v))) { setError('身高/体重/年龄需填有效数字（大于 0），或留空。'); return }
    const field: Partial<DietProfileInput> = {}
    if (h !== undefined) field.heightCm = Math.round(h)
    if (w !== undefined) field.weightKg = Math.round(w * 10) / 10
    if (a !== undefined) field.age = Math.round(a)
    if (gender) field.gender = gender as DietProfileInput['gender']
    if (goal) field.goal = goal as DietProfileInput['goal']
    if (activity) field.activity = activity as DietProfileInput['activity']
    const note = healthNote.trim()
    if (note) field.healthNote = note
    field.aiPrompt = aiPrompt.trim() || DEFAULT_DIET_AI_PROMPT
    const input = mergeInput(currentProfile, field)
    setSaving(true)
    setError('')
    try {
      await saveDietProfile(input)
      onClose()
    } catch {
      setError('保存失败，请稍后重试。')
      setSaving(false)
    }
  }

  const promptCustom = !isDefaultPrompt(aiPrompt)

  const chip = (value: string, current: string, onChange: (next: string) => void) => (
    <View
      className={'daily-diet-profile-chip' + (current === value ? ' is-active' : '')}
      onClick={() => onChange(current === value ? '' : value)}
      role='radio'
      aria-checked={current === value}
    >
      <Text>{labelFor(value)}</Text>
    </View>
  )

  return (
    <View className='daily-diet-modal-backdrop' role='dialog' aria-modal='true' aria-label='今日饮食推荐 · 个人档案' onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <View className='daily-diet-modal-card daily-diet-profile-card'>
        <View className='daily-diet-modal-heading'>
          <Text className='daily-diet-modal-title'>个人档案</Text>
          <View className='daily-diet-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <View className='daily-diet-profile-hint'>以下信息只会用于今日饮食推荐，可按需填写；留空的项 AI 不会编造。保存后影响下一次生成的推荐，并同步到服务端。</View>

        <View className='daily-diet-profile-field-row'>
          <View className='daily-diet-profile-field'>
            <Text className='daily-diet-profile-label'>身高（cm）</Text>
            <Input className='daily-diet-profile-input' type='number' value={height} placeholder='如 178' onInput={(e) => setHeight(e.detail.value)} maxlength={4} />
          </View>
          <View className='daily-diet-profile-field'>
            <Text className='daily-diet-profile-label'>体重（kg）</Text>
            <Input className='daily-diet-profile-input' type='number' value={weight} placeholder='如 81' onInput={(e) => setWeight(e.detail.value)} maxlength={5} />
          </View>
          <View className='daily-diet-profile-field'>
            <Text className='daily-diet-profile-label'>年龄（岁）</Text>
            <Input className='daily-diet-profile-input' type='number' value={age} placeholder='如 30' onInput={(e) => setAge(e.detail.value)} maxlength={3} />
          </View>
        </View>

        <View className='daily-diet-profile-field'>
          <Text className='daily-diet-profile-label'>性别</Text>
          <View className='daily-diet-profile-chips'>{GENDER_OPTIONS.map((o) => chip(o.value, gender, setGender))}</View>
        </View>

        <View className='daily-diet-profile-field'>
          <Text className='daily-diet-profile-label'>目标</Text>
          <View className='daily-diet-profile-chips'>{GOAL_OPTIONS.map((o) => chip(o.value, goal, setGoal))}</View>
        </View>

        <View className='daily-diet-profile-field'>
          <Text className='daily-diet-profile-label'>日常活动量</Text>
          <View className='daily-diet-profile-chips'>{ACTIVITY_OPTIONS.map((o) => chip(o.value, activity, setActivity))}</View>
        </View>

        <View className='daily-diet-profile-field'>
          <Text className='daily-diet-profile-label'>健康状态 / 忌口 / 过敏 / 慢病（可留空）</Text>
          <Textarea className='daily-diet-profile-textarea' value={healthNote} onInput={(e) => setHealthNote(e.detail.value)} placeholder='如：乳糖不耐受、血压偏高、不吃辣…' autoHeight />
        </View>

        <View className='daily-diet-profile-field'>
          <View className='daily-diet-profile-label-row'>
            <Text className='daily-diet-profile-label'>AI 提示词</Text>
            <View className={'daily-diet-profile-badge' + (promptCustom ? ' is-custom' : '')}>
              <Text>{promptCustom ? '自定义' : '默认'}</Text>
            </View>
            {promptCustom && (
              <Button className='daily-diet-profile-reset' onClick={() => setAiPrompt(DEFAULT_DIET_AI_PROMPT)}>恢复默认</Button>
            )}
          </View>
          <Textarea className='daily-diet-profile-textarea' value={aiPrompt} onInput={(e) => setAiPrompt(e.detail.value)} placeholder='默认使用内置提示词，可在这里修改…' autoHeight maxlength={2000} />
          <Text className='daily-diet-profile-hint'>默认即内置提示词；修改后为自定义状态，AI 生成按你的提示词进行。「恢复默认」可随时回到内置那一套。</Text>
        </View>

        {error && <Text className='daily-diet-profile-error'>{error}</Text>}

        <View className='daily-diet-profile-actions'>
          <Button className='daily-diet-profile-btn secondary' onClick={onClose}>取消</Button>
          <Button className='daily-diet-profile-btn primary' onClick={() => { void save() }} disabled={saving || loading}>{saving ? '保存中…' : '保存'}</Button>
        </View>
      </View>
    </View>
)
}

function labelFor(value: string): string {
  const all = [...GENDER_OPTIONS, ...GOAL_OPTIONS, ...ACTIVITY_OPTIONS]
  return all.find((o) => o.value === value)?.label ?? value
}
