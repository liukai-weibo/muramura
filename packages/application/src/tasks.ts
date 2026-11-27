import type {
  ActivityAuditRecorder,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskRepository,
  TaskVisibleStatus,
} from '@knowledge-base/contracts'
import { TASK_DETAIL_MAX_LENGTH, TASK_TITLE_MAX_LENGTH, isVisibleTaskStatus } from '@knowledge-base/contracts'
import { BusinessError } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

function invalid(message: string): BusinessError {
  return new BusinessError('TASK_INVALID', message)
}

function notFound(): BusinessError {
  return new BusinessError('TASK_NOT_FOUND', '任务不存在')
}

function requireTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw invalid('任务标题不能为空')
  if (title.length > TASK_TITLE_MAX_LENGTH) throw invalid(`任务标题不能超过 ${TASK_TITLE_MAX_LENGTH} 个字`)
  return title
}

async function audit(recorder: ActivityAuditRecorder | undefined, action: 'create' | 'update' | 'complete' | 'assign' | 'delete', task: Task): Promise<void> {
  await safeAuditRecord(recorder, {
    module: 'task',
    action,
    snapshot: JSON.stringify({ title: task.title, status: task.status, ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}), ...(task.completedAt ? { completedAt: task.completedAt } : {}) }),
  })
}

/**
 * 任务最小状态机：
 *   pool --领取--> active --完成--> completed
 *   active --放弃--> pool
 * completed 不再出现在列表里，但保留数据给未来的积分/统计。
 */
export class TaskApplicationService {
  constructor(private readonly repository: TaskRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  list(): Promise<Task[]> {
    return this.repository.list()
  }

  async create(input: { title?: unknown; bucket?: unknown; parentTaskId?: unknown; isUrgent?: unknown; isImportant?: unknown }): Promise<Task> {
    const bucket: TaskVisibleStatus = isVisibleTaskStatus(input.bucket) ? input.bucket : 'active'
    const parentTaskId = typeof input.parentTaskId === 'string' && input.parentTaskId.trim() ? input.parentTaskId.trim() : undefined
    if (parentTaskId) {
      const parent = await this.repository.get(parentTaskId)
      if (!parent) throw invalid('承接的任务不存在')
      if (parent.status !== 'completed') throw invalid('只能承接已完成的任务')
    }
    const task = await this.repository.create({
      title: requireTitle(input.title),
      bucket,
      ...(parentTaskId ? { parentTaskId } : {}),
      ...(typeof input.isUrgent === 'boolean' ? { isUrgent: input.isUrgent } : {}),
      ...(typeof input.isImportant === 'boolean' ? { isImportant: input.isImportant } : {}),
    } satisfies TaskCreateInput)
    await audit(this.auditRecorder, 'create', task)
    return task
  }

  /** 改标题、详情或四象限，只写传进来的字段。 */
  async update(id: string, input: { title?: unknown; detail?: unknown; isUrgent?: unknown; isImportant?: unknown }): Promise<Task> {
    await this.requireTask(id)
    const patch: TaskUpdateInput = {}
    if (input.title !== undefined) patch.title = requireTitle(input.title)
    if (input.detail !== undefined) {
      if (typeof input.detail !== 'string') throw invalid('任务详情无效')
      if (input.detail.length > TASK_DETAIL_MAX_LENGTH) throw invalid(`任务详情不能超过 ${TASK_DETAIL_MAX_LENGTH} 个字`)
      patch.detail = input.detail
    }
    if (input.isUrgent !== undefined) {
      if (typeof input.isUrgent !== 'boolean') throw invalid('紧急标记无效')
      patch.isUrgent = input.isUrgent
    }
    if (input.isImportant !== undefined) {
      if (typeof input.isImportant !== 'boolean') throw invalid('重要标记无效')
      patch.isImportant = input.isImportant
    }
    if (Object.keys(patch).length === 0) throw invalid('没有要修改的内容')
    const updated = await this.repository.update(id, patch)
    if (!updated) throw notFound()
    await audit(this.auditRecorder, 'update', updated)
    return updated
  }
  async claim(id: string): Promise<Task> {
    const task = await this.requireTask(id)
    if (task.status !== 'pool') throw invalid('只有任务池里的任务可以领取')
    const updated = await this.repository.updateStatus(id, 'active')
    if (!updated) throw notFound()
    await audit(this.auditRecorder, 'assign', updated)
    return updated
  }

  async complete(id: string): Promise<Task> {
    const task = await this.requireTask(id)
    if (task.status !== 'active') throw invalid('只有今日任务可以完成')
    const updated = await this.repository.updateStatus(id, 'completed', new Date().toISOString())
    if (!updated) throw notFound()
    await audit(this.auditRecorder, 'complete', updated)
    return updated
  }

  /** 撤销完成：completed 回到 active（界面只在前三分钟内显示撤销入口）。 */
  async restore(id: string): Promise<Task> {
    const task = await this.requireTask(id)
    if (task.status !== 'completed') throw invalid('只有已完成任务可以撤销')
    const updated = await this.repository.updateStatus(id, 'active')
    if (!updated) throw notFound()
    await audit(this.auditRecorder, 'update', updated)
    return updated
  }

  listCompleted(): Promise<Task[]> {
    return this.repository.listCompleted()
  }

  async abandon(id: string): Promise<Task> {
    const task = await this.requireTask(id)
    if (task.status !== 'active') throw invalid('只有今日任务可以放弃')
    const updated = await this.repository.updateStatus(id, 'pool')
    if (!updated) throw notFound()
    await audit(this.auditRecorder, 'update', updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    const task = await this.requireTask(id)
    if (task.status === 'completed') throw invalid('已完成任务不能删除')
    const removed = await this.repository.remove(id)
    if (!removed) throw notFound()
    await audit(this.auditRecorder, 'delete', task)
  }

  private async requireTask(id: string): Promise<Task> {
    if (!id) throw invalid('任务 ID 无效')
    const task = await this.repository.get(id)
    if (!task) throw notFound()
    return task
  }
}
