import { useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { Task, TaskStatus } from '@knowledge-base/contracts'
import { useTasks } from './use-tasks'
import { TaskInlineCreate } from './task-inline-create'
import { taskTintClass } from './task-colors'
import './tasks-page.scss'

const formatCompletedAt = (iso?: string): string => {
  if (!iso) return ''
  const date = new Date(iso)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface DraggingTask {
  id: string
  status: TaskStatus
}

export function TasksPage() {
  const tasks = useTasks()
  const [completedOpen, setCompletedOpen] = useState(false)
  const [poolPinned, setPoolPinned] = useState(false)
  const [dragging, setDragging] = useState<DraggingTask>()
  const dragRef = useRef<DraggingTask>()
  const movePendingRef = useRef(false)
  const [dropTarget, setDropTarget] = useState<'active' | 'pool'>()
  // 手动展开与拖动临时展开独立；离开模块时组件卸载，自动恢复收起。
  const poolOpen = poolPinned || dragging?.status === 'active'

  const finish = (id: string) => {
    if (tasks.busyId) return
    void tasks.complete(id)
  }

  const startDrag = (event: ReactDragEvent<HTMLDivElement>, task: Task) => {
    if (tasks.busyId || movePendingRef.current || (event.target instanceof Element && event.target.closest('button'))) {
      event.preventDefault()
      return
    }
    const current = { id: task.id, status: task.status }
    dragRef.current = current
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    setDragging(current)
  }

  const endDrag = () => {
    dragRef.current = undefined
    setDragging(undefined)
    setDropTarget(undefined)
  }

  const leaveTarget = (event: ReactDragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDropTarget(undefined)
  }

  const dropInto = async (target: 'active' | 'pool') => {
    const current = dragRef.current
    // 先消费本次拖动，防止 drop / dragend 或冒泡造成重复写入。
    endDrag()
    if (!current || current.status === target || tasks.busyId || movePendingRef.current) return
    movePendingRef.current = true
    try {
      if (current.status === 'pool' && target === 'active') await tasks.claim(current.id)
      if (current.status === 'active' && target === 'pool') await tasks.abandon(current.id)
    } finally {
      movePendingRef.current = false
    }
  }

  const completedEntry = <button type='button' className='tasks-completed-entry' onClick={() => setCompletedOpen(true)}>
    已完成 <span>{tasks.completed.length}</span>
  </button>

  const completedPanel = completedOpen && <div className='tasks-completed-backdrop' role='dialog' aria-modal='true' aria-label='已完成任务' onClick={() => setCompletedOpen(false)}>
    <div className='tasks-completed-panel' onClick={event => event.stopPropagation()}>
      <div className='tasks-completed-heading'>
        <div><span className='section-kicker'>归档</span><h2>已完成</h2></div>
        <button type='button' className='tasks-completed-close' aria-label='关闭' onClick={() => setCompletedOpen(false)}>✕</button>
      </div>
      {tasks.completed.length === 0
        ? <p className='tasks-state'>还没有已完成的任务。</p>
        : <div className='tasks-completed-list'>
          {tasks.completed.map((task: Task) => <div key={task.id} className={`tasks-completed-row ${taskTintClass(task.id)}`}>
            <button type='button' role='checkbox' aria-checked={true} aria-label={`取消完成：${task.title}`}
              className='tasks-check is-checked' disabled={Boolean(tasks.busyId)} onClick={() => void tasks.restore(task.id)}><span /></button>
            <span className='tasks-completed-title'>{task.title}</span>
            <span className='tasks-completed-time'>{formatCompletedAt(task.completedAt)}</span>
          </div>)}
        </div>}
    </div>
  </div>

  return <div className={`tasks-page ${poolOpen ? 'pool-open' : ''}`}>
    <header className='tasks-page-heading'>
      <span className='section-kicker'>任务</span>
      <p>把想做的事放进来，完成就勾掉；长期任务收在右侧抽屉里，拖动即可切换。</p>
    </header>

    <div className={`tasks-columns ${poolOpen ? 'is-pool-open' : 'is-pool-closed'}`}>
      <section
        className={`tasks-panel is-active ${dropTarget === 'active' ? 'is-drop-target' : ''}`}
        onDragOver={event => { if (dragging?.status === 'pool') { event.preventDefault(); setDropTarget('active') } }}
        onDragLeave={leaveTarget}
        onDrop={event => { event.preventDefault(); void dropInto('active') }}
      >
        <div className='tasks-panel-heading'>
          <div><span className='section-kicker'>今日</span></div>
          <span className='tasks-count'>{tasks.active.length}</span>
        </div>
        {dragging?.status === 'pool' && <div className='tasks-drop-hint'>移入想做</div>}
        <TaskInlineCreate bucket='active' onCreate={tasks.create} />

        {tasks.loading ? <p className='tasks-state'>正在读取任务…</p>
          : tasks.active.length === 0 && tasks.recent.length === 0 ? <div className='tasks-empty'>
            <p>今天还没有任务。先放一件真正想完成的小事。</p>
          </div>
            : <div className='tasks-list'>
              {tasks.recent.map(item => <div key={`recent-${item.task.id}`} className={`tasks-row is-done ${taskTintClass(item.task.id)}`}>
                <button type='button' role='checkbox' aria-checked={true} aria-label={`取消完成：${item.task.title}`}
                  className='tasks-check is-checked' disabled={Boolean(tasks.busyId)} onClick={() => void tasks.restore(item.task.id)}><span /></button>
                <span className='tasks-row-title'>{item.task.title}</span>
              </div>)}
              {tasks.active.map(task => <div
                key={task.id}
                className={`tasks-row ${taskTintClass(task.id)} ${dragging?.id === task.id ? 'is-dragging' : ''}`}
                draggable
                onDragStart={event => startDrag(event, task)}
                onDragEnd={endDrag}
              >
                <button
                  type='button'
                  className='tasks-check'
                  role='checkbox'
                  aria-checked={false}
                  aria-label={`完成：${task.title}`}
                  disabled={tasks.busyId === task.id}
                  onClick={() => finish(task.id)}
                ><span /></button>
                <span className='tasks-row-title'>{task.title}</span>
                <button
                  type='button'
                  className='tasks-row-action'
                  disabled={tasks.busyId === task.id}
                  onClick={() => void tasks.abandon(task.id)}
                >移入长期</button>
                <button
                  type='button'
                  className='tasks-row-delete'
                  disabled={tasks.busyId === task.id}
                  onClick={() => void tasks.remove(task.id)}
                >删除</button>
              </div>)}
            </div>}
      </section>
    </div>

    <button
      type='button'
      className={`tasks-pool-toggle ${poolOpen ? 'is-open' : ''}`}
      aria-label={poolOpen ? '收起任务池' : '展开任务池'}
      aria-expanded={poolOpen}
      title='任务池'
      onClick={() => setPoolPinned(open => !open)}
      onDragOver={event => { if (dragging?.status === 'active') { event.preventDefault(); setDropTarget('pool') } }}
      onDrop={event => { event.preventDefault(); void dropInto('pool') }}
    >{poolOpen ? '›' : '‹'}</button>

    <aside
      className={`tasks-panel is-pool tasks-pool-drawer ${poolOpen ? 'is-open' : ''} ${dropTarget === 'pool' ? 'is-drop-target' : ''}`}
      aria-hidden={!poolOpen}
      onDragOver={event => { if (dragging?.status === 'active') { event.preventDefault(); setDropTarget('pool') } }}
      onDragLeave={leaveTarget}
      onDrop={event => { event.preventDefault(); void dropInto('pool') }}
    >
      <div className='tasks-panel-heading'>
        <div><span className='section-kicker'>长期</span><h2>任务池</h2></div>
        <span className='tasks-count'>{tasks.pool.length}</span>
      </div>
      {dragging?.status === 'active' && <div className='tasks-drop-hint'>移入长期任务</div>}
      <TaskInlineCreate bucket='pool' onCreate={tasks.create} />

      {tasks.loading ? <p className='tasks-state'>正在读取任务…</p>
        : tasks.pool.length === 0 ? <div className='tasks-empty'>
          <p>任务池是空的。把不急着今天做的事先存到这里。</p>
        </div>
          : <div className='tasks-list'>
            {tasks.pool.map(task => <div
              key={task.id}
              className={`tasks-row is-pool-row ${taskTintClass(task.id)} ${dragging?.id === task.id ? 'is-dragging' : ''}`}
              draggable
              onDragStart={event => startDrag(event, task)}
              onDragEnd={endDrag}
            >
              <span className='tasks-row-title'>{task.title}</span>
              <button
                type='button'
                className='tasks-row-delete'
                disabled={tasks.busyId === task.id}
                onClick={() => void tasks.remove(task.id)}
              >删除</button>
              <button
                type='button'
                className='tasks-claim'
                disabled={tasks.busyId === task.id}
                onClick={() => void tasks.claim(task.id)}
              >领取</button>
            </div>)}
          </div>}
    </aside>

    {tasks.error && <p className='tasks-error' role='status'>{tasks.error}</p>}
    {completedEntry}
    {completedPanel}
  </div>
}
