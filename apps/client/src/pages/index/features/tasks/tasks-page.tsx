import { useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Task, TaskQuadrant, TaskStatus } from '@knowledge-base/contracts'
import { taskQuadrant } from '@knowledge-base/contracts'
import { useTasks } from './use-tasks'
import { TaskInlineCreate } from './task-inline-create'
import { TaskDeriveSheet } from './task-derive-sheet'
import { TaskDetailPanel } from './task-detail-panel'
import { taskTintClass } from './task-colors'
import './tasks-page.scss'

/** 四象限：顺序固定为「先做 → 计划 → 应付 → 有空再说」。 */
const TASK_QUADRANT_CELLS: Array<{ key: TaskQuadrant; label: string; hint: string; emoji: string; motto: string; urgent: boolean; important: boolean }> = [
  { key: 'urgent-important', label: '紧急且重要', hint: '先做', emoji: '🔥', motto: '危机象限 · 立即做', urgent: true, important: true },
  { key: 'important', label: '重要不紧急', hint: '计划', emoji: '🌱', motto: '规划象限 · 持续做', urgent: false, important: true },
  { key: 'urgent', label: '紧急不重要', hint: '尽快应付', emoji: '⏰', motto: '无益象限 · 快速做', urgent: true, important: false },
  { key: 'normal', label: '不紧急不重要', hint: '有空再说', emoji: '🍃', motto: '琐事象限 · 拒绝做', urgent: false, important: false },
]

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
  const [deriving, setDeriving] = useState<Task>()
  const [selectedId, setSelectedId] = useState<string>()
  const [addingQuadrant, setAddingQuadrant] = useState<TaskQuadrant>()
  const [addingTitle, setAddingTitle] = useState('')
  const [addingBusy, setAddingBusy] = useState(false)
  const [quadrantDrop, setQuadrantDrop] = useState<TaskQuadrant>()
  const suppressClickRef = useRef(0)
  const [poolPinned, setPoolPinned] = useState(false)
  const [dragging, setDragging] = useState<DraggingTask>()
  const dragRef = useRef<DraggingTask>()
  const movePendingRef = useRef(false)
  const [dropTarget, setDropTarget] = useState<'active' | 'pool'>()
  // 手动展开与拖动临时展开独立；离开模块时组件卸载，自动恢复收起。
  const poolOpen = poolPinned || dragging?.status === 'active'

  const finish = (id: string) => {
    if (tasks.busyId) return
    setSelectedId(current => current === id ? undefined : current)
    void tasks.complete(id)
  }

  /** 承接关系只显示一层：父任务标题从已完成列表里查，查不到就退回「上一步」。 */
  const originOf = (task: Task): string | undefined => {
    if (!task.parentTaskId) return undefined
    const parent = tasks.completed.find(item => item.id === task.parentTaskId)
    return parent ? parent.title : '上一步'
  }

  const selectedTask = [...tasks.active, ...tasks.pool].find(task => task.id === selectedId)

  /** 拖拽刚结束的一次 click 是拖出来的，不该顺带展开详情。 */
  const rowClick = (event: ReactMouseEvent<HTMLDivElement>, task: Task) => {
    if (Date.now() < suppressClickRef.current) return
    if (event.target instanceof Element && event.target.closest('button, input, textarea')) return
    setSelectedId(current => current === task.id ? undefined : task.id)
  }

  const deriveNext = async (title: string, bucket: 'active' | 'pool') => {
    if (!deriving) return false
    const ok = await tasks.create(title, bucket, deriving.id)
    return ok
  }

  /** 拖到另一格＝改它的四象限。 */
  const dropIntoQuadrant = async (key: TaskQuadrant) => {
    const current = dragRef.current
    endDrag()
    setQuadrantDrop(undefined)
    if (!current || current.status !== 'active' || tasks.busyId) return
    const cell = TASK_QUADRANT_CELLS.find(item => item.key === key)
    if (!cell) return
    await tasks.update(current.id, { isUrgent: cell.urgent, isImportant: cell.important })
  }

  const submitQuadrantTask = async (key: TaskQuadrant) => {
    const cell = TASK_QUADRANT_CELLS.find(item => item.key === key)
    const title = addingTitle.trim()
    if (!cell || !title || addingBusy) return
    setAddingBusy(true)
    const ok = await tasks.create(title, 'active', undefined, { isUrgent: cell.urgent, isImportant: cell.important })
    setAddingBusy(false)
    if (ok) { setAddingTitle(''); setAddingQuadrant(undefined) }
  }

  const startDrag = (event: ReactDragEvent<HTMLDivElement>, task: Task) => {
    if (tasks.busyId || movePendingRef.current || (event.target instanceof Element && event.target.closest('button'))) {
      event.preventDefault()
      return
    }
    suppressClickRef.current = Date.now() + 400
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
            <span className='tasks-completed-title'>{task.title}{originOf(task) && <span className='tasks-row-origin'>承接：{originOf(task)}</span>}</span>
            <button type='button' className='tasks-row-next' disabled={Boolean(tasks.busyId)} onClick={() => setDeriving(task)}>＋ 下一步</button>
            <span className='tasks-completed-time'>{formatCompletedAt(task.completedAt)}</span>
          </div>)}
        </div>}
    </div>
  </div>

  const activeRow = (task: Task) => <div
    key={task.id}
    className={`tasks-row ${taskTintClass(task.id)} ${dragging?.id === task.id ? 'is-dragging' : ''} ${selectedId === task.id ? 'is-selected' : ''}`}
    draggable
    onDragStart={event => startDrag(event, task)}
    onDragEnd={endDrag}
    onClick={event => rowClick(event, task)}
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
    <span className='tasks-row-title'>{task.title}{originOf(task) && <span className='tasks-row-origin'>承接：{originOf(task)}</span>}</span>
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
      onClick={() => { setSelectedId(current => current === task.id ? undefined : current); void tasks.remove(task.id) }}
    >删除</button>
  </div>

  const recentRow = (task: Task) => <div key={`recent-${task.id}`} className={`tasks-row is-done ${taskTintClass(task.id)}`}>
    <button type='button' role='checkbox' aria-checked={true} aria-label={`取消完成：${task.title}`}
      className='tasks-check is-checked' disabled={Boolean(tasks.busyId)} onClick={() => void tasks.restore(task.id)}><span /></button>
    <span className='tasks-row-title'>{task.title}</span>
    <button type='button' className='tasks-row-next' disabled={Boolean(tasks.busyId)} onClick={() => setDeriving(task)}>＋ 下一步</button>
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

        {tasks.loading ? <p className='tasks-state'>正在读取任务…</p>
          : <div className='tasks-quadrants'>
            {TASK_QUADRANT_CELLS.map(cell => {
              // 刚完成的也留在原格里，勾掉后仍能接「下一步」，3 分钟后自动消失。
              const recentList = tasks.recent.filter(item => taskQuadrant(item.task) === cell.key).map(item => item.task)
              const activeList = tasks.active.filter(task => taskQuadrant(task) === cell.key)
              const empty = recentList.length === 0 && activeList.length === 0
              return <div
                key={cell.key}
                className={`tasks-quadrant is-${cell.key} ${quadrantDrop === cell.key ? 'is-drop-target' : ''}`}
                onDragOver={event => { if (dragging) { event.preventDefault(); event.stopPropagation(); setQuadrantDrop(cell.key) } }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setQuadrantDrop(undefined) }}
                onDrop={event => { event.preventDefault(); event.stopPropagation(); void dropIntoQuadrant(cell.key) }}
                onClick={event => {
                  // 点空白处＝在这一格新建；点任务卡或按钮不算。
                  if (event.target instanceof Element && event.target.closest('.tasks-row, button, input, textarea')) return
                  if (addingQuadrant === cell.key) return
                  setAddingQuadrant(cell.key)
                  setAddingTitle('')
                }}
              >
                <div className='tasks-quadrant-head'>
                  <span><span className='tasks-quadrant-emoji' aria-hidden='true'>{cell.emoji}</span>{cell.label}<span className='tasks-quadrant-hint'>{cell.hint}</span></span>
                  <span className='tasks-quadrant-tools'>
                    <button
                      type='button'
                      className='tasks-quadrant-add'
                      aria-label={`在「${cell.label}」添加任务`}
                      onClick={() => { setAddingQuadrant(cell.key); setAddingTitle('') }}
                    >＋</button>
                    <span className='tasks-count'>{activeList.length}</span>
                  </span>
                </div>
                {addingQuadrant === cell.key && <input
                  autoFocus
                  className='tasks-quadrant-input'
                  value={addingTitle}
                  maxLength={120}
                  placeholder='回车添加，Esc 取消'
                  disabled={addingBusy}
                  onChange={event => setAddingTitle(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submitQuadrantTask(cell.key) }
                    if (event.key === 'Escape') { setAddingQuadrant(undefined); setAddingTitle('') }
                  }}
                  onBlur={() => { if (!addingTitle.trim()) { setAddingQuadrant(undefined); setAddingTitle('') } }}
                />}
                {empty
                  ? <div className='tasks-quadrant-empty'>
                    <span className='tasks-quadrant-empty-icon' aria-hidden='true'>{cell.emoji}</span>
                    <span>{cell.motto}</span>
                  </div>
                  : <div className='tasks-list is-chips'>{recentList.map(recentRow)}{activeList.map(activeRow)}</div>}
              </div>
            })}
          </div>}

        {selectedTask && <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedId(undefined)}
          onSave={patch => tasks.update(selectedTask.id, patch)}
          onPreview={patch => tasks.patchLocal(selectedTask.id, patch)}
        />}
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
    {deriving && <TaskDeriveSheet
      parent={deriving}
      busy={Boolean(tasks.busyId)}
      onClose={() => setDeriving(undefined)}
      onCreate={deriveNext}
    />}
  </div>
}
