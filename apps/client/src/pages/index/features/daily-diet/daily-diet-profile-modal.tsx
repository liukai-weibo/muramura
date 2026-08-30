import { useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import type { DailyDietProfile } from './daily-diet-profile'
import { ACTIVITY_OPTIONS, GENDER_OPTIONS, GOAL_OPTIONS, loadDietProfile, saveDietProfile } from './daily-diet-profile'

interface DailyDietProfileModalProps {
  onClose: () => void
}

function toOptionalRaw(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? n : Number.NaN
}

export function DailyDietProfileModal({ onClose }: DailyDietProfileModalProps) {
  const initial = loadDietProfile()
  const [height, setHeight] = useState(initial.heightCm != null ? String(initial.heightCm) : '')
  const [weight, setWeight] = useState(initial.weightKg != null ? String(initial.weightKg) : '')
  const [age, setAge] = useState(initial.age != null ? String(initial.age) : '')
  const [gender, setGender] = useState(initial.gender ?? '')
  const [goal, setGoal] = useState(initial.goal ?? '')
  const [activity, setActivity] = useState(initial.activity ?? '')
  const [healthNote, setHealthNote] = useState(initial.healthNote ?? '')
  const [error, setError] = useState('')

  const save = () => {
    const h = toOptionalRaw(height)
    const w = toOptionalRaw(weight)
    const a = toOptionalRaw(age)
    if ([h, w, a].some((v) => v !== undefined && Number.isNaN(v))) { setError('身高/体重/年龄需填有效数字（大于 0），或留空。'); return }
    const profile: DailyDietProfile = {}
    if (h !== undefined) profile.heightCm = Math.round(h)
    if (w !== undefined) profile.weightKg = Math.round(w * 10) / 10
    if (a !== undefined) profile.age = Math.round(a)
    if (gender) profile.gender = gender as DailyDietProfile['gender']
    if (goal) profile.goal = goal as DailyDietProfile['goal']
    if (activity) profile.activity = activity as DailyDietProfile['activity']
    const note = healthNote.trim()
    if (note) profile.healthNote = note
    saveDietProfile(profile)
    onClose()
  }

  const chip = (value: string, current: string, onChange: (next: string) => void) => (
    <View
      className={`daily-diet-profile-chip${current === value ? ' is-active' : ''}`}
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

        <View className='daily-diet-profile-hint'>以下信息只会用于今日饮食推荐，可按需填写；留空的项 AI 不会编造。保存后影响下一次生成的推荐。</View>

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

        {error && <Text className='daily-diet-profile-error'>{error}</Text>}

        <View className='daily-diet-profile-actions'>
          <Button className='daily-diet-profile-btn secondary' onClick={onClose}>取消</Button>
          <Button className='daily-diet-profile-btn primary' onClick={save}>保存</Button>
        </View>
      </View>
    </View>
  )
}

function labelFor(value: string): string {
  const all = [...GENDER_OPTIONS, ...GOAL_OPTIONS, ...ACTIVITY_OPTIONS]
  return all.find((o) => o.value === value)?.label ?? value
}
