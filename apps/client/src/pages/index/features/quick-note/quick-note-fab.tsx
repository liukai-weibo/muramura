import { useEffect, useRef, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import { apiClient } from '../../api-client'

const catIconUrl = new URL('../../../../assets/brand/marumaru-white-cat-transparent.png', import.meta.url).href

interface QuickNoteFabProps {
  visible: boolean
  onOpenDailyNotes: () => void
  openRequest?: number
}

export function QuickNoteFab({ visible, onOpenDailyNotes, openRequest = 0 }: QuickNoteFabProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean }>()

  const close = () => {
    if (saving) return
    setOpen(false)
    setError('')
  }

  const save = async () => {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    setError('')
    try {
      await apiClient.appendTodayDailyNote(content)
      window.dispatchEvent(new CustomEvent('daily-note-content-changed'))
      setDraft('')
      setOpen(false)
    } catch {
      setError('保存失败，内容仍保留在这里。')
    } finally {
      setSaving(false)
    }
  }

  const toggle = () => {
    if (open) {
      close()
      return
    }
    setOpen(true)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y, moved: false }
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const x = drag.originX + moveEvent.clientX - drag.startX
      const y = drag.originY + moveEvent.clientY - drag.startY
      if (Math.abs(x - drag.originX) > 4 || Math.abs(y - drag.originY) > 4) drag.moved = true
      setOffset({ x, y })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.setTimeout(() => { dragRef.current = undefined }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, saving])

  useEffect(() => {
    if (!visible) {
      setOpen(false)
      setOffset({ x: 0, y: 0 })
    }
  }, [visible])

  useEffect(() => {
    if (!openRequest) return
    setOpen(true)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [openRequest])

  useEffect(() => {
    const resetWhenShown = () => {
      if (!document.hidden) setOffset({ x: 0, y: 0 })
    }
    document.addEventListener('visibilitychange', resetWhenShown)
    return () => document.removeEventListener('visibilitychange', resetWhenShown)
  }, [])

  if (!visible && !open) return null

  return <View className='quick-note-fab-layer' style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
    {open && <View className='quick-note-dismiss-layer' onClick={close} />}
    {open && <View className='quick-note-panel' role='dialog' aria-label='速记'>
      <View className='quick-note-panel-heading'><Text>速记</Text><Text>一条短句会追加到手记</Text></View>
      <input
        ref={inputRef}
        className='quick-note-input'
        value={draft}
        maxLength={500}
        placeholder='记下此刻想到的事...'
        onChange={(event) => { setDraft(event.currentTarget.value); setError('') }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === 'Process') return
          if (event.key === 'Enter') { event.preventDefault(); void save() }
          if (event.key === 'Escape') { event.preventDefault(); close() }
        }}
      />
      {error && <Text className='quick-note-error'>{error}</Text>}
      <View className='quick-note-actions'>
        <button type='button' className='quick-note-ai' disabled>AI 润色（即将上线）</button>
        <button type='button' className='quick-note-save control-transition' disabled={!draft.trim() || saving} onClick={() => void save()}>{saving ? '保存中...' : '保存速记'}</button>
      </View>
      <button type='button' className='quick-note-open-full' onClick={() => { close(); onOpenDailyNotes() }}>展开完整笔记</button>
    </View>}
    <button type='button' className={`quick-note-fab control-transition ${open ? 'open' : ''}`} aria-label={open ? '关闭速记' : '打开速记'} aria-expanded={open} onPointerDown={startDrag} onClick={() => { if (!dragRef.current?.moved) toggle() }}>
      <Image src={catIconUrl} mode='aspectFit' />
    </button>
  </View>
}
