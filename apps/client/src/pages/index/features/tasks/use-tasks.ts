import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Task, TaskVisibleStatus } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'

/** 完成后的三分钟内保留删除线，可撤销；之后从今日列表消失。 */
export const TASK_RECENT_COMPLETE_MS = 3 * 60 * 1000

export interface RecentCompletedTask {
  task: Task
  expiresAt: number
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [completed, setCompleted] = useState<Task[]>([])
  const [recent, setRecent] = useState<RecentCompletedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string>()
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [visible, done] = await Promise.all([apiClient.listTasks(), apiClient.listCompletedTasks()])
      setTasks(visible)
      setCompleted(done)
    } catch {
      setError('任务读取失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setRecent(list => list.filter(item => item.expiresAt > now))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const create = useCallback(async (title: string, bucket: TaskVisibleStatus, parentTaskId?: string, priority?: { isUrgent: boolean; isImportant: boolean }) => {
    setCreating(true)
    setError('')
    try {
      const task = await apiClient.createTask({ title: title.trim(), bucket, ...(parentTaskId ? { parentTaskId } : {}), ...(priority ?? {}) })
      setTasks(list => [...list, task])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加失败，请重试')
      return false
    } finally {
      setCreating(false)
    }
  }, [])

  const run = useCallback(async (id: string, action: (id: string) => Promise<Task>) => {
    setBusyId(id)
    setError('')
    try {
      const updated = await action(id)
      setTasks(list => list.map(task => task.id === id ? updated : task))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试')
      return false
    } finally {
      setBusyId(undefined)
    }
  }, [])

  const claim = useCallback((id: string) => run(id, id => apiClient.claimTask(id)), [run])
  const abandon = useCallback((id: string) => run(id, id => apiClient.abandonTask(id)), [run])

  const complete = useCallback(async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      const task = await apiClient.completeTask(id)
      setTasks(list => list.filter(item => item.id !== id))
      setCompleted(list => [task, ...list.filter(item => item.id !== id)])
      setRecent(list => [{ task, expiresAt: Date.now() + TASK_RECENT_COMPLETE_MS }, ...list.filter(item => item.task.id !== id)])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '完成失败，请重试')
      return false
    } finally {
      setBusyId(undefined)
    }
  }, [])

  const update = useCallback(async (id: string, input: { title?: string; detail?: string; isUrgent?: boolean; isImportant?: boolean }) => {
    setError('')
    try {
      const task = await apiClient.updateTask(id, input)
      setTasks(list => list.map(item => item.id === id ? task : item))
      setCompleted(list => list.map(item => item.id === id ? task : item))
      setRecent(list => list.map(item => item.task.id === id ? { ...item, task } : item))
      return task
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
      return undefined
    }
  }, [])

  /** 只改本地状态，不动服务端：详情区输入时让列表立刻跟着变。 */
  const patchLocal = useCallback((id: string, patch: { title?: string; detail?: string; isUrgent?: boolean; isImportant?: boolean }) => {
    const apply = (task: Task): Task => ({
      ...task,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
      ...(patch.isUrgent !== undefined ? { isUrgent: patch.isUrgent } : {}),
      ...(patch.isImportant !== undefined ? { isImportant: patch.isImportant } : {}),
    })
    setTasks(list => list.map(item => item.id === id ? apply(item) : item))
    setCompleted(list => list.map(item => item.id === id ? apply(item) : item))
    setRecent(list => list.map(item => item.task.id === id ? { ...item, task: apply(item.task) } : item))
  }, [])

  const restore = useCallback(async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      const task = await apiClient.restoreTask(id)
      setCompleted(list => list.filter(item => item.id !== id))
      setRecent(list => list.filter(item => item.task.id !== id))
      setTasks(list => [task, ...list])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销失败，请重试')
      return false
    } finally {
      setBusyId(undefined)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      await apiClient.deleteTask(id)
      setTasks(list => list.filter(task => task.id !== id))
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试')
      return false
    } finally {
      setBusyId(undefined)
    }
  }, [])

  const active = useMemo(() => tasks.filter(task => task.status === 'active'), [tasks])
  const pool = useMemo(() => tasks.filter(task => task.status === 'pool'), [tasks])

  return { active, pool, completed, recent, loading, error, busyId, creating, create, claim, abandon, complete, restore, remove, update, patchLocal, reload: load }
}
