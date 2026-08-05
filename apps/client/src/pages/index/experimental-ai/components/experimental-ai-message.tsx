import { View, Text } from '@tarojs/components'

type MessageAlign = 'start' | 'end'
interface Props { className?: string; children?: React.ReactNode }
export function MessageGroup({ className = '', children }: Props) { return <View className={`experimental-ai-message-group ${className}`}>{children}</View> }
export function Message({ align = 'start', className = '', children }: Props & { align?: MessageAlign }) { return <View className={`experimental-ai-message experimental-ai-message--${align} ${className}`}>{children}</View> }
export function MessageAvatar({ className = '', children }: Props) { return <View className={`experimental-ai-message-avatar ${className}`}>{children}</View> }
export function MessageContent({ className = '', children }: Props) { return <View className={`experimental-ai-message-content ${className}`}>{children}</View> }
export function MessageHeader({ className = '', children }: Props) { return <View className={`experimental-ai-message-header ${className}`}>{typeof children === 'string' ? <Text>{children}</Text> : children}</View> }
export function MessageFooter({ className = '', children }: Props) { return <View className={`experimental-ai-message-footer ${className}`}>{typeof children === 'string' ? <Text>{children}</Text> : children}</View> }
