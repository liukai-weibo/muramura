import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { View } from '@tarojs/components'
import { Alignment, Fit, Layout, StateMachineInputType, useRive, useStateMachineInput, type StateMachineInput } from '@rive-app/react-canvas'
import { getMascotCalendarContext } from '../mascot-calendar'
import { selectMascotBubble, type MascotAiState, type MascotSessionKind } from '../mascot-copy'

interface ExperimentalAiMascotProps {
  isListening: boolean
  isThinking: boolean
  compact?: boolean
  useRiveMascot?: boolean
  outcome?: 'complete' | 'error'
  generationId?: number
  interactionNonce?: number
  sessionKind?: MascotSessionKind
  persistentBubble?: boolean
}

const MR_HELP_SRC = new URL('../../../../assets/mascot/ipip-character.riv', import.meta.url).href
const STATE_MACHINE = 'State Machine 1'

function fireCompatibleInput(input: StateMachineInput | null) {
  if (!input) return undefined
  if (input.type === StateMachineInputType.Trigger) input.fire()
  if (input.type === StateMachineInputType.Boolean) {
    input.value = true
    return window.setTimeout(() => { input.value = false }, 260)
  }
  if (input.type === StateMachineInputType.Number) input.value = 1
  return undefined
}

function RiveMascotArt({ isThinking, outcome, generationId, interactionNonce, onError }: Pick<ExperimentalAiMascotProps, 'isThinking' | 'outcome' | 'generationId' | 'interactionNonce'> & { onError: () => void }) {
  const [riveReady, setRiveReady] = useState(false)
  const previousThinkingRef = useRef(false)
  const { rive, RiveComponent } = useRive({
    src: MR_HELP_SRC,
    stateMachines: STATE_MACHINE,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    shouldDisableRiveListeners: true,
    automaticallyHandleEvents: false,
    onLoad: () => setRiveReady(true),
    onLoadError: onError,
  }, { useDevicePixelRatio: true, shouldResizeCanvasToContainer: true })
  const speakInput = useStateMachineInput(rive, STATE_MACHINE, 'Speak')
  const happyInput = useStateMachineInput(rive, STATE_MACHINE, 'Happy')
  const wrongInput = useStateMachineInput(rive, STATE_MACHINE, 'Wrong')

  useEffect(() => {
    if (!rive || !riveReady) return
    let timer: number | undefined
    if (outcome === 'error') timer = fireCompatibleInput(wrongInput)
    else if (outcome === 'complete') timer = fireCompatibleInput(happyInput)
    else if (isThinking && !previousThinkingRef.current) timer = fireCompatibleInput(speakInput)
    previousThinkingRef.current = isThinking
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [generationId, happyInput, isThinking, outcome, rive, riveReady, speakInput, wrongInput])

  useEffect(() => {
    if (!rive || !riveReady || interactionNonce === undefined) return
    let timer: number | undefined
    try {
      const triggerInputs = rive.stateMachineInputs(STATE_MACHINE).filter((candidate) => candidate.type === StateMachineInputType.Trigger)
      const input = triggerInputs.length > 0 ? triggerInputs[Math.floor(Math.random() * triggerInputs.length)] : undefined
      timer = fireCompatibleInput(input ?? null)
    } catch {
      // Missing state machines or inputs fall back to the CSS reaction.
    }
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [interactionNonce, rive, riveReady])

  useEffect(() => {
    if (!rive) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotion = () => {
      if (media.matches) {
        rive.pause()
        return
      }
      try {
        rive.play(STATE_MACHINE)
      } catch {
        try { rive.play() } catch { /* Static SVG fallback remains available. */ }
      }
    }
    syncMotion()
    media.addEventListener?.('change', syncMotion)
    return () => { media.removeEventListener?.('change', syncMotion); rive.stop(); rive.cleanup() }
  }, [rive])

  return <View className='experimental-ai-mascot-rive' aria-hidden='true'><RiveComponent /></View>
}

/**
 * H5-only visual placeholder for the future Spine character.
 * The component is intentionally isolated from chat state so stream updates
 * never recreate or re-render the mascot animation tree.
 */
export const ExperimentalAiMascot = memo(function ExperimentalAiMascot({ isListening, isThinking, compact = false, useRiveMascot = false, outcome, generationId, sessionKind, persistentBubble = false }: ExperimentalAiMascotProps) {
  const [bubble, setBubble] = useState<string>()
  const [riveFailed, setRiveFailed] = useState(false)
  const hideTimerRef = useRef<number>()
  const reactionTimerRef = useRef<number>()
  const interactionNonceRef = useRef(0)
  const clickCountRef = useRef(0)
  const lastClickAtRef = useRef<number>()
  const [interactionNonce, setInteractionNonce] = useState<number>()
  const mascotButtonRef = useRef<HTMLButtonElement | null>(null)
  const [thinkingBubblePosition, setThinkingBubblePosition] = useState<{ left: number; top: number }>()
  const state = isThinking ? 'thinking' : isListening ? 'listening' : 'idle'

  useEffect(() => {
    if (!isThinking || !bubble || !mascotButtonRef.current) return
    const rect = mascotButtonRef.current.getBoundingClientRect()
    setThinkingBubblePosition({ left: Math.max(8, rect.left - 40), top: Math.max(8, rect.top - 49) })
  }, [bubble, isThinking])

  useEffect(() => {
    if (!persistentBubble || sessionKind !== 'new') return
    const calendar = getMascotCalendarContext()
    const selection = selectMascotBubble({ ...calendar, sessionKind: 'new', isFirstClick: true })
    setBubble(selection.text)
    return () => setBubble(undefined)
  }, [persistentBubble, sessionKind])

  useEffect(() => () => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
    if (reactionTimerRef.current !== undefined) window.clearTimeout(reactionTimerRef.current)
  }, [])

  const showNextMessage = () => {
    const now = Date.now()
    const isContinuousClick = lastClickAtRef.current !== undefined && now - lastClickAtRef.current < 1200
    lastClickAtRef.current = now
    clickCountRef.current += 1
    const calendar = getMascotCalendarContext(new Date(now))
    const selection = selectMascotBubble({
      ...calendar,
      aiState: (isThinking ? 'thinking' : outcome === 'error' ? 'error' : outcome === 'complete' ? 'complete' : 'idle') as MascotAiState,
      sessionKind,
      isListening,
      isFirstClick: clickCountRef.current === 1,
      isContinuousClick,
    })
    setBubble(selection.text)
    if (!persistentBubble) {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = undefined
        setBubble(undefined)
      }, 3000)
    }
    interactionNonceRef.current += 1
    setInteractionNonce(interactionNonceRef.current)
    if (reactionTimerRef.current !== undefined) window.clearTimeout(reactionTimerRef.current)
    reactionTimerRef.current = window.setTimeout(() => {
      reactionTimerRef.current = undefined
      setInteractionNonce(undefined)
    }, 520)
  }

  if (process.env.TARO_ENV !== 'h5' || !compact) return null
  const thinkingBubble = bubble && isThinking && thinkingBubblePosition && typeof document !== 'undefined'
    ? createPortal(<View className='experimental-ai-thinking-bubble-portal' role='status' aria-live='polite' style={{ left: `${thinkingBubblePosition.left}px`, top: `${thinkingBubblePosition.top}px` }}>{bubble}</View>, document.body)
    : null
  return <View className={`experimental-ai-mascot-shell ${compact ? 'is-compact' : ''} is-${state}${interactionNonce !== undefined ? ' is-reacting' : ''}`}>
    {!isThinking && bubble && <View className='experimental-ai-mascot-bubble' role='status' aria-live='polite'>{bubble}</View>}
    {thinkingBubble}
    <button ref={mascotButtonRef} type='button' className='experimental-ai-mascot' aria-label='与圈圈助手互动' onClick={showNextMessage} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showNextMessage() } }}>
    {useRiveMascot && !riveFailed ? <RiveMascotArt isThinking={isThinking} outcome={outcome} generationId={generationId} interactionNonce={interactionNonce} onError={() => setRiveFailed(true)} /> : <svg className='experimental-ai-mascot-art' viewBox='0 0 120 120' role='presentation'>
      <circle className='experimental-ai-mascot-aura' cx='60' cy='60' r='48' />
      <path className='experimental-ai-mascot-ring' d='M60 17a43 43 0 1 1-30.4 12.6' />
      <path className='experimental-ai-mascot-body' d='M32 68c0-19 12-32 28-32s28 13 28 32v13c0 8-7 14-15 14H47c-8 0-15-6-15-14V68Z' />
      <circle className='experimental-ai-mascot-eye' cx='49' cy='64' r='3.5' />
      <circle className='experimental-ai-mascot-eye' cx='71' cy='64' r='3.5' />
      <path className='experimental-ai-mascot-mouth' d='M53 77c4 4 10 4 14 0' />
      <path className='experimental-ai-mascot-mark' d='M60 29v9M55.5 33.5h9' />
    </svg>}
    </button>
  </View>
})
