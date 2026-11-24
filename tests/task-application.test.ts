import { describe, expect, it } from 'vitest'
import type { Task, TaskRepository } from '@knowledge-base/contracts'
import { TaskApplicationService } from '../packages/application/src/tasks'

class StubTaskRepository implements TaskRepository {
  tasks = new Map<string, Task>()
  private sequence = 0

  async list(): Promise<Task[]> {
    return [...this.tasks.values()].filter(task => task.status !== 'completed')
  }
  async listCompleted(): Promise<Task[]> {
    return [...this.tasks.values()].filter(task => task.status === 'completed')
  }
  async get(id: string): Promise<Task | undefined> { return this.tasks.get(id) }
  async create(input: { title: string; bucket: 'active' | 'pool'; parentTaskId?: string }): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      id: `task-${++this.sequence}`, title: input.title, status: input.bucket,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      createdAt: now, updatedAt: now,
    }
    this.tasks.set(task.id, task)
    return task
  }
  async updateStatus(id: string, status: Task['status'], completedAt?: string): Promise<Task | undefined> {
    const task = this.tasks.get(id)
    if (!task) return undefined
    const next: Task = { ...task, status, updatedAt: new Date().toISOString() }
    if (status === 'completed') next.completedAt = completedAt ?? next.updatedAt
    else delete next.completedAt
    this.tasks.set(id, next)
    return next
  }
  async remove(id: string): Promise<boolean> { return this.tasks.delete(id) }
}

const create = async () => {
  const repository = new StubTaskRepository()
  return { repository, service: new TaskApplicationService(repository) }
}

describe('task application', () => {
  it('creates today tasks and pool tasks', async () => {
    const { service } = await create()
    expect((await service.create({ title: '  写周报  ', bucket: 'active' })).title).toBe('写周报')
    expect((await service.create({ title: '整理照片', bucket: 'pool' })).status).toBe('pool')
    expect(await service.list()).toHaveLength(2)
  })

  it('validates empty and over-long titles', async () => {
    const { service } = await create()
    await expect(service.create({ title: '   ', bucket: 'active' })).rejects.toMatchObject({ code: 'TASK_INVALID' })
    await expect(service.create({ title: 'x'.repeat(121), bucket: 'active' })).rejects.toMatchObject({ code: 'TASK_INVALID' })
  })

  it('derives a next task from a completed task', async () => {
    const { service } = await create()
    const parent = await service.create({ title: '完成流水线切换', bucket: 'active' })
    await service.complete(parent.id)
    const next = await service.create({ title: 'agent 任务冒烟测试', bucket: 'pool', parentTaskId: parent.id })
    expect(next.parentTaskId).toBe(parent.id)
    expect(next.status).toBe('pool')
  })

  it('rejects a parent that is missing or still unfinished', async () => {
    const { service } = await create()
    await expect(service.create({ title: '下一步', bucket: 'active', parentTaskId: 'missing' }))
      .rejects.toMatchObject({ code: 'TASK_INVALID' })
    const active = await service.create({ title: '还没做完', bucket: 'active' })
    await expect(service.create({ title: '下一步', bucket: 'active', parentTaskId: active.id }))
      .rejects.toMatchObject({ code: 'TASK_INVALID' })
  })

  it('claims a pool task into today', async () => {
    const { service } = await create()
    const task = await service.create({ title: '整理照片', bucket: 'pool' })
    const claimed = await service.claim(task.id)
    expect(claimed.status).toBe('active')
  })

  it('rejects claiming a task that is already active', async () => {
    const { service } = await create()
    const task = await service.create({ title: '写周报', bucket: 'active' })
    await expect(service.claim(task.id)).rejects.toMatchObject({ code: 'TASK_INVALID' })
  })

  it('completes an active task and hides it from the list', async () => {
    const { service } = await create()
    const task = await service.create({ title: '写周报', bucket: 'active' })
    const completed = await service.complete(task.id)
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBeTruthy()
    expect(await service.list()).toHaveLength(0)
  })

  it('abandons an active task back into the pool and allows re-claiming', async () => {
    const { service } = await create()
    const task = await service.create({ title: '写周报', bucket: 'active' })
    const abandoned = await service.abandon(task.id)
    expect(abandoned.status).toBe('pool')
    expect((await service.claim(task.id)).status).toBe('active')
  })

  it('restores a completed task back to today and lists completed history', async () => {
    const { service } = await create()
    const task = await service.create({ title: '写周报', bucket: 'active' })
    await service.complete(task.id)
    expect(await service.listCompleted()).toHaveLength(1)
    const restored = await service.restore(task.id)
    expect(restored.status).toBe('active')
    expect(restored.completedAt).toBeUndefined()
    expect(await service.listCompleted()).toHaveLength(0)
    expect(await service.list()).toHaveLength(1)
  })

  it('rejects restoring a task that is not completed', async () => {
    const { service } = await create()
    const task = await service.create({ title: '写周报', bucket: 'active' })
    await expect(service.restore(task.id)).rejects.toMatchObject({ code: 'TASK_INVALID' })
  })

  it('removes active and pool tasks but not completed ones', async () => {
    const { repository, service } = await create()
    const active = await service.create({ title: '写周报', bucket: 'active' })
    const pool = await service.create({ title: '整理照片', bucket: 'pool' })
    const done = await service.create({ title: '已完成', bucket: 'active' })
    await service.complete(done.id)

    await service.remove(active.id)
    await service.remove(pool.id)
    expect(await repository.get(active.id)).toBeUndefined()
    expect(await repository.get(pool.id)).toBeUndefined()
    await expect(service.remove(done.id)).rejects.toMatchObject({ code: 'TASK_INVALID' })
  })

  it('reports missing tasks', async () => {
    const { service } = await create()
    await expect(service.complete('missing')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
  })
})
