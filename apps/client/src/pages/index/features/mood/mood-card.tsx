import { Text, View } from '@tarojs/components'
import type { MoodEntry } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'

function firstLine(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line || value
}

function formatMonthDay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

interface MoodCardProps {
  entry: MoodEntry
  colorTheme: ColorTheme
  onOpen: (entry: MoodEntry) => void
}

export function MoodCard({ entry, onOpen }: MoodCardProps) {
  // 状态档位已停止采集：卡片不再按档位显示彩色圆点。
  return (
    <View className='mood-card' onClick={() => onOpen(entry)}>
      <View className='mood-card-header'>
        <Text className='mood-card-title'>{firstLine(entry.content)}</Text>
        <Text className='mood-card-date'>{formatMonthDay(entry.entryDate)}</Text>
      </View>
    </View>
  )
}
