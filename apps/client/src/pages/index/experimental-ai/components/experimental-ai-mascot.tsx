import { memo, useEffect, useRef, useState } from 'react'
import { View } from '@tarojs/components'

const MASCOT_MESSAGES = [
  '遇到卡点随时发我。',
  '今天想复盘哪个战术？',
  '把问题写下来，我们一起拆开。',
] as const

interface ExperimentalAiMascotProps {
  isListening: boolean
  isThinking: boolean
}

/**
 * H5-only visual placeholder for the future Spine character.
 * The component is intentionally isolated from chat state so stream updates
 * never recreate or re-render the mascot animation tree.
 */
export const ExperimentalAiMascot = memo(function ExperimentalAiMascot({ isListening, isThinking }: ExperimentalAiMascotProps) {
  const [bubble, setBubble] = useState<string>()
  const messageIndexRef = useRef(0)
  const hideTimerRef = useRef<number>()
  const state = isThinking ? 'thinking' : isListening ? 'listening' : 'idle'

  useEffect(() => () => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
  }, [])

  const showNextMessage = () => {
    const message = MASCOT_MESSAGES[messageIndexRef.current % MASCOT_MESSAGES.length]
    messageIndexRef.current = (messageIndexRef.current + 1) % MASCOT_MESSAGES.length
    setBubble(message)
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined
      setBubble(undefined)
    }, 3000)
  }

  if (process.env.TARO_ENV !== 'h5') return null
  return <View className={`experimental-ai-mascot-shell is-${state}`}>
    {bubble && <View className='experimental-ai-mascot-bubble' role='status' aria-live='polite'>{bubble}</View>}
    <button type='button' className='experimental-ai-mascot' aria-label='与圈圈助手互动' onClick={showNextMessage} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showNextMessage() } }}>
    <svg className='experimental-ai-mascot-art' viewBox='0 0 120 120' role='presentation'>
      <circle className='experimental-ai-mascot-aura' cx='60' cy='60' r='48' />
      <path className='experimental-ai-mascot-ring' d='M60 17a43 43 0 1 1-30.4 12.6' />
      <path className='experimental-ai-mascot-body' d='M32 68c0-19 12-32 28-32s28 13 28 32v13c0 8-7 14-15 14H47c-8 0-15-6-15-14V68Z' />
      <circle className='experimental-ai-mascot-eye' cx='49' cy='64' r='3.5' />
      <circle className='experimental-ai-mascot-eye' cx='71' cy='64' r='3.5' />
      <path className='experimental-ai-mascot-mouth' d='M53 77c4 4 10 4 14 0' />
      <path className='experimental-ai-mascot-mark' d='M60 29v9M55.5 33.5h9' />
    </svg>
    </button>
  </View>
})
