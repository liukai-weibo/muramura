import { Text, View } from '@tarojs/components'
import type { MoodEntry } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import { moodLevelColors, moodLevelColorsDark } from './mood-levels'

function firstLine(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line || value
}

function formatMonthDay(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

interface MoodCardProps {
  entry: MoodEntry
  colorTheme: ColorTheme
  onOpen: (entry: MoodEntry) => void
}

export function MoodCard({ entry, colorTheme, onOpen }: MoodCardProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
  return (
    <View className='mood-card' onClick={() => onOpen(entry)}>
      <View className='mood-card-header'>
        <View className='mood-card-dot' style={{ background: palette[entry.moodLevel] }} />
        <Text className='mood-card-title'>{firstLine(entry.content)}</Text>
        <Text className='mood-card-date'>{formatMonthDay(entry.entryDate)}</Text>
      </View>
      {entry.tags.length > 0 && (
        <View className='mood-card-tags'>
          {entry.tags.map(tag => <Text key={tag} className='mood-card-tag'>#{tag}</Text>)}
        </View>
      )}
    </View>
  )
}
