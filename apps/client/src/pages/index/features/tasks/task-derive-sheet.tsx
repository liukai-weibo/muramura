import { useEffect, useRef, useState } from 'react'
import type { Task, TaskVisibleStatus } from '@knowledge-base/contracts'

/** 「完成并派生下一步」：给刚完成的任务接一条新的链，写上下一步要做什么。 */
export function TaskDeriveSheet({ parent, busy, onClose, onCreate }: {
  parent: Task
  busy: boolean
  onClose: () => void
  onCreate: (title: string, bucket: TaskVisibleStatus) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [bucket, setBucket] = useState<TaskVisibleStatus>('active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef(false)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const submit = async () => {
    if (pending.current || saving) return
    const next = title.trim()
    if (!next) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      if (await onCreate(next, bucket)) {
        setTitle('')
        onClose()
      } else {
        setError('未能确认创建成功，内容已保留，请核对列表后再操作。')
      }
    } catch {
      setError('创建失败，内容已保留。')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <div className='tasks-completed-backdrop' role='dialog' aria-modal='true' aria-label='派生下一步' onClick={() => { if (!saving) onClose() }}>
    <div className='tasks-derive-panel' onClick={event => event.stopPropagation()}>
      <div className='tasks-derive-heading'>
        <span className='section-kicker'>承接</span>
        <h2>接在「{parent.title}」之后</h2>
        <button type='button' className='tasks-completed-close' aria-label='关闭' disabled={saving} onClick={onClose}>✕</button>
      </div>
      <label className='tasks-derive-label' htmlFor='task-derive-title'>下一步要做什么？</label>
      <input
        id='task-derive-title'
        ref={input}
        className='task-inline-input tasks-derive-input'
        value={title}
        maxLength={120}
        placeholder='例如：agent 任务冒烟测试'
        disabled={saving || busy}
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }}
      />
      <div className='tasks-derive-buckets' role='group' aria-label='放入哪里'>
        <button type='button' className={`tasks-derive-bucket ${bucket === 'active' ? 'is-selected' : ''}`} disabled={saving} onClick={() => setBucket('active')}>今日</button>
        <button type='button' className={`tasks-derive-bucket ${bucket === 'pool' ? 'is-selected' : ''}`} disabled={saving} onClick={() => setBucket('pool')}>长期池</button>
      </div>
      {error && <p className='tasks-error' role='status'>{error}</p>}
      <div className='tasks-derive-actions'>
        <button type='button' className='tasks-derive-cancel' disabled={saving} onClick={onClose}>取消</button>
        <button type='button' className='tasks-derive-submit' disabled={saving || busy || !title.trim()} onClick={() => void submit()}>{saving ? '创建中…' : '创建'}</button>
      </div>
    </div>
  </div>
}
