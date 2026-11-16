import { useEffect, useRef, useState } from 'react'
import type { TaskVisibleStatus } from '@knowledge-base/contracts'

/** 原地展开的任务输入：确认 / 回车 / 点击外部提交；失败时保留草稿。 */
export function TaskInlineCreate({ bucket, onCreate }: {
  bucket: TaskVisibleStatus
  onCreate: (title: string, bucket: TaskVisibleStatus) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const pending = useRef(false)
  const composing = useRef(false)
  const submitRef = useRef<() => void>(() => {})
  const label = bucket === 'active' ? '添加任务' : '添加长期任务'

  const submit = async () => {
    if (pending.current || composing.current) return
    if (!title.trim()) { setExpanded(false); setTitle(''); setError(''); return }
    pending.current = true
    setSaving(true)
    setError('')
    try {
      if (await onCreate(title.trim(), bucket)) {
        setTitle('')
        setExpanded(false)
      } else setError('未能确认添加成功，内容已保留，请核对列表后再操作。')
    } catch {
      setError('添加失败，内容已保留。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  submitRef.current = () => { if (!error) void submit() }

  useEffect(() => {
    if (!expanded) return
    input.current?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) submitRef.current()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded])

  return <div ref={root} className={`task-inline-create${expanded ? ' is-expanded' : ''}`}>
    <div className='task-inline-control'>
      <button ref={trigger} type='button' className='task-inline-trigger' aria-label={label} aria-expanded={expanded}
        tabIndex={expanded ? -1 : 0} onClick={() => { setError(''); setExpanded(true) }}>
        <span aria-hidden='true'>＋</span>{label}
      </button>
      {expanded && <div className='task-inline-fields'>
        <input ref={input} aria-label={bucket === 'active' ? '任务内容' : '长期任务内容'}
          value={title} maxLength={120} disabled={saving}
          placeholder={bucket === 'active' ? '想做点什么？' : '放一件长期想做的事…'}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onChange={event => { setTitle(event.currentTarget.value); setError('') }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void submit() }
            if (event.key === 'Escape' && !pending.current) {
              event.preventDefault(); setExpanded(false); setTitle(''); setError(''); trigger.current?.focus()
            }
          }} />
        <button type='button' className='task-inline-confirm' disabled={saving} onClick={() => void submit()}>{saving ? '添加中…' : '确认'}</button>
      </div>}
    </div>
    {error && <p className='tasks-error' role='status'>{error}</p>}
  </div>
}
