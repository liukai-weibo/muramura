import { View, Text } from '@tarojs/components'

type BubbleVariant = 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive'
type BubbleAlign = 'start' | 'end'
interface BaseProps { className?: string; children?: React.ReactNode }

export function BubbleGroup({ className = '', children }: BaseProps) { return <View className={`experimental-ai-bubble-group ${className}`}>{children}</View> }
export function Bubble({ variant = 'default', align = 'start', className = '', children }: BaseProps & { variant?: BubbleVariant; align?: BubbleAlign }) { return <View className={`experimental-ai-bubble experimental-ai-bubble--${variant} experimental-ai-bubble--${align} ${className}`}>{children}</View> }
export function BubbleContent({ className = '', children }: BaseProps) { return <View className={`experimental-ai-bubble-content ${className}`}>{typeof children === 'string' ? <Text>{children}</Text> : children}</View> }
export function BubbleReactions({ className = '', children }: BaseProps) { return <View className={`experimental-ai-bubble-reactions ${className}`}>{children}</View> }
