import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '@knowledge-base/contracts'
import { TASK_DETAIL_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from '@knowledge-base/contracts'

interface TaskDraft {
  title: string
  detail: string
  isUrgent: boolean
  isImportant: boolean
}

const draftOf = (task: Task): TaskDraft => ({
  title: task.title,
  detail: task.detail ?? '',
  isUrgent: task.isUrgent,
  isImportant: task.isImportant,
})

const sameDraft = (left: TaskDraft, right: TaskDraft): boolean =>
  left.title === right.title && left.detail === right.detail
  && left.isUrgent === right.isUrgent && left.isImportant === right.isImportant

/**
 * 点击任务后在下方展开的详情：标题就是任务名，正文是任务详情。
 * 一次只展开一个；输入 800ms 防抖保存，切换/收起时先落盘。
 */
export function TaskDetailPanel({ task, onClose, onSave, onPreview }: {
  task: Task
  onClose: () => void
  onSave: (patch: { title?: string; detail?: string; isUrgent?: boolean; isImportant?: boolean }) => Promise<Task | undefined>
  /** 输入时先把改动同步给列表，不等网络往返。 */
  onPreview: (patch: { title?: string }) => void
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => draftOf(task))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const taskIdRef = useRef(task.id)
  const mountedRef = useRef(true)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const draftRef = useRef(draft)
  const savedRef = useRef(draftOf(task))
  const timerRef = useRef<number>()

  draftRef.current = draft

  const save = useCallback(async (next: TaskDraft) => {
    if (next.title.trim().length === 0) return
    setStatus('saving')
    const updated = await onSave({
      title: next.title.trim(),
      detail: next.detail,
      isUrgent: next.isUrgent,
      isImportant: next.isImportant,
    })
    if (!mountedRef.current) return
    if (updated) {
      savedRef.current = { ...next, title: next.title.trim() }
      setStatus('saved')
    } else {
      setStatus('failed')
    }
  }, [onSave])

  // 切换任务：先把上一条没落盘的改动写掉，再把表单换成新任务。
  useEffect(() => {
    if (task.id === taskIdRef.current) return
    const previous = draftRef.current
    if (!sameDraft(previous, savedRef.current) && previous.title.trim()) void save(previous)
    const next = draftOf(task)
    setDraft(next)
    savedRef.current = next
    setStatus('idle')
    taskIdRef.current = task.id
  }, [task, save])

  // 输入防抖保存。
  useEffect(() => {
    window.clearTimeout(timerRef.current)
    if (sameDraft(draft, savedRef.current) || !draft.title.trim()) return
    timerRef.current = window.setTimeout(() => { void save(draftRef.current) }, 800)
    return () => window.clearTimeout(timerRef.current)
  }, [draft, save])

  // 组件被卸载（切到别的模块）时也把没保存的改动写掉，避免丢字。
  useEffect(() => () => {
    mountedRef.current = false
    window.clearTimeout(timerRef.current)
    const latest = draftRef.current
    if (sameDraft(latest, savedRef.current) || !latest.title.trim()) return
    void onSaveRef.current({
      title: latest.title.trim(),
      detail: latest.detail,
      isUrgent: latest.isUrgent,
      isImportant: latest.isImportant,
    })
  }, [])

  // 收起前把没保存的改动写掉。
  const close = () => {
    window.clearTimeout(timerRef.current)
    if (!sameDraft(draftRef.current, savedRef.current) && draftRef.current.title.trim()) void save(draftRef.current)
    onClose()
  }

  const setField = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }))
    setStatus('idle')
    if (key === 'title' && typeof value === 'string') onPreview({ title: value })
  }

  return <div className='task-detail-backdrop' role='dialog' aria-modal='true' aria-label={`任务详情：${task.title}`} onClick={close}>
    <section className='task-detail-panel' onClick={event => event.stopPropagation()}>
    <header className='task-detail-head'>
      <input
        className='task-detail-title'
        value={draft.title}
        maxLength={TASK_TITLE_MAX_LENGTH}
        aria-label='任务标题'
        onChange={event => setField('title', event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save(draftRef.current) } }}
      />
      <span className={`task-detail-status is-${status}`} role='status'>
        {status === 'saving' ? '保存中…' : status === 'saved' ? '已保存' : status === 'failed' ? '保存失败' : ''}
      </span>
      <button type='button' className='task-detail-close' aria-label='关闭详情' onClick={close}>关闭</button>
    </header>
    <textarea
      className='task-detail-body'
      value={draft.detail}
      maxLength={TASK_DETAIL_MAX_LENGTH}
      placeholder='写下这件事的来龙去脉、下一步、卡在哪里…'
      onChange={event => setField('detail', event.target.value)}
    />
    </section>
  </div>
}
