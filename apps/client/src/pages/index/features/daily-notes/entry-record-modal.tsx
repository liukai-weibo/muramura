import { useLayoutEffect, useEffect, useRef, useState } from 'react'

export interface EntryRecordModalProps {
  /** 当前手记的日期，弹窗里头显示给人确认。 */
  entryDate: string
  /** 点中的时段小时，0–23。 */
  hour: number
  onSubmit: (time: string, content: string) => Promise<boolean>
  onClose: () => void
}

const pad = (value: number): string => String(value).padStart(2, '0')
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * 时间轴点时段后的快速补记：时间取自点中的那个时段（不是「现在」），
 * 具体分钟可以改，回车即存，有内容时关掉先问一句免得白敲。
 */
export function EntryRecordModal({ entryDate, hour, onSubmit, onClose }: EntryRecordModalProps) {
  const initialTime = `${pad(hour)}:00`
  const [time, setTime] = useState(initialTime)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 同步聚焦：晚一帧的话，刚点过的那一格还留着焦点，屏幕上会闪一下。
  useLayoutEffect(() => { textareaRef.current?.focus() }, [])

  const typed = content.trim().length > 0
  const canSave = typed && TIME_PATTERN.test(time) && !saving

  const requestClose = () => {
    if (saving) return
    if (typed) { setConfirmDiscard(true); return }
    onClose()
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (confirmDiscard) { setConfirmDiscard(false); return }
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setFailed('')
    const done = await onSubmit(TIME_PATTERN.test(time) ? time : initialTime, content.trim())
    setSaving(false)
    if (done) onClose()
    else setFailed('保存失败，内容还在，可以再试一次')
  }

  return <div className='capture-modal-backdrop' role='dialog' aria-modal='true' aria-label='按时间补记' onClick={requestClose}>
    <div className='capture-modal daily-note-record-modal' onClick={event => event.stopPropagation()}>
      <div className='capture-modal-heading'>
        <div className='daily-note-record-heading'>
          <span className='section-kicker'>按时间补记</span>
          <span>{entryDate} · {pad(hour)} 点这一段</span>
        </div>
        <button type='button' className='capture-modal-close daily-note-record-close' onClick={requestClose}>关闭</button>
      </div>

      <label className='daily-note-record-time-row'>
        <span className='daily-note-record-label'>时间</span>
        <input
          type='time'
          className='daily-note-record-time'
          value={time}
          onChange={event => setTime(event.target.value)}
          onBlur={() => { if (!TIME_PATTERN.test(time)) setTime(initialTime) }}
        />
        <span className='daily-note-record-hint'>时段用小时定位，具体分钟可以改</span>
      </label>

      <textarea
        ref={textareaRef}
        className='daily-note-record-textarea'
        value={content}
        rows={3}
        placeholder='这段时间做了什么…'
        onChange={event => { setContent(event.target.value); setFailed('') }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />

      {failed && <p className='daily-note-record-error' role='status'>{failed}</p>}

      {confirmDiscard ? <div className='daily-note-record-confirm' role='alertdialog' aria-label='放弃这条记录'>
        <span>放弃这条还没保存的记录？</span>
        <div className='daily-note-record-confirm-actions'>
          <button type='button' className='daily-note-record-button' onClick={() => setConfirmDiscard(false)}>继续写</button>
          <button type='button' className='daily-note-record-button is-danger' onClick={onClose}>放弃</button>
        </div>
      </div> : <div className='daily-note-record-actions'>
        <button type='button' className='daily-note-record-button' onClick={requestClose} disabled={saving}>取消</button>
        <button type='button' className={`daily-note-record-button is-primary ${canSave ? '' : 'is-disabled'}`} disabled={!canSave} onClick={() => void submit()}>
          {saving ? '保存中…' : '记下'}
        </button>
      </div>}
    </div>
  </div>
}
