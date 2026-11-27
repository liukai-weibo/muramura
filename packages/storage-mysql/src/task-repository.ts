import crypto from 'node:crypto'
import type { CurrentUserScope, Task, TaskBackupStore, TaskCreateInput, TaskRepository, TaskStatus, TaskUpdateInput } from '@knowledge-base/contracts'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { runInMySqlTransaction } from './index'

type TaskRow = RowDataPacket & {
  id: string
  title: string
  parent_task_id: string | null
  is_urgent: number
  is_important: number
  detail: string | null
  status: string
  completed_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

const TASK_COLUMNS = 'id, title, parent_task_id, is_urgent, is_important, detail, status, completed_at, created_at, updated_at'

const iso = (value: string | Date): string => {
  if (value instanceof Date) return value.toISOString()
  return value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
}

const sqlDate = (value: string): string => value.replace('T', ' ').replace('Z', '')

const mapTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
  isUrgent: Boolean(row.is_urgent),
  isImportant: Boolean(row.is_important),
  ...(row.detail ? { detail: row.detail } : {}),
  status: row.status as TaskStatus,
  ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
})

export class MySqlTaskRepository implements TaskRepository, TaskBackupStore {
  constructor(private readonly pool: Pool, private readonly scope: CurrentUserScope) {}

  async list(): Promise<Task[]> {
    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_user_id = ? AND status IN ('active', 'pool') ORDER BY created_at ASC`,
      [this.scope.userId],
    )
    return rows.map(mapTask)
  }

  async listCompleted(): Promise<Task[]> {
    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_user_id = ? AND status = 'completed' ORDER BY completed_at DESC`,
      [this.scope.userId],
    )
    return rows.map(mapTask)
  }

  async get(id: string): Promise<Task | undefined> {
    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ? AND owner_user_id = ? LIMIT 1`,
      [id, this.scope.userId],
    )
    return rows[0] ? mapTask(rows[0]) : undefined
  }

  async create(input: TaskCreateInput): Promise<Task> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.pool.execute(
      'INSERT INTO tasks (id, owner_user_id, title, parent_task_id, is_urgent, is_important, detail, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      [id, this.scope.userId, input.title, input.parentTaskId ?? null, input.isUrgent ? 1 : 0, input.isImportant === false ? 0 : 1, input.detail ?? null, input.bucket, sqlDate(now), sqlDate(now)],
    )
    return {
      id, title: input.title,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      isUrgent: Boolean(input.isUrgent),
      isImportant: input.isImportant !== false,
      ...(input.detail ? { detail: input.detail } : {}),
      status: input.bucket, createdAt: now, updatedAt: now,
    }
  }

  async update(id: string, input: TaskUpdateInput): Promise<Task | undefined> {
    const sets: string[] = []
    const params: Array<string | number | null> = []
    if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
    // 详情清空写 NULL，避免留下空字符串与「没填」两种语义。
    if (input.detail !== undefined) { sets.push('detail = ?'); params.push(input.detail.trim() ? input.detail : null) }
    if (input.isUrgent !== undefined) { sets.push('is_urgent = ?'); params.push(input.isUrgent ? 1 : 0) }
    if (input.isImportant !== undefined) { sets.push('is_important = ?'); params.push(input.isImportant ? 1 : 0) }
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    params.push(sqlDate(new Date().toISOString()), id, this.scope.userId)
    await this.pool.execute(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND owner_user_id = ?`, params)
    return this.get(id)
  }
  async updateStatus(id: string, status: TaskStatus, completedAt?: string): Promise<Task | undefined> {
    const now = new Date().toISOString()
    const [result] = await this.pool.execute(
      'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?',
      [status, status === 'completed' ? sqlDate(completedAt ?? now) : null, sqlDate(now), id, this.scope.userId],
    )
    if (!('affectedRows' in result) || Number((result as { affectedRows: number }).affectedRows) === 0) return undefined
    return this.get(id)
  }

  async remove(id: string): Promise<boolean> {
    const [result] = await this.pool.execute('DELETE FROM tasks WHERE id = ? AND owner_user_id = ?', [id, this.scope.userId])
    return 'affectedRows' in result && Number((result as { affectedRows: number }).affectedRows) > 0
  }

  async exportBackup(): Promise<Task[]> {
    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE owner_user_id = ? ORDER BY created_at ASC`,
      [this.scope.userId],
    )
    return rows.map(mapTask)
  }

  async replaceBackup(tasks: Task[]): Promise<void> {
    await runInMySqlTransaction(this.pool, async connection => {
      await connection.execute('DELETE FROM tasks WHERE owner_user_id = ?', [this.scope.userId])
      for (const task of tasks) {
        await connection.execute(
          'INSERT INTO tasks (id, owner_user_id, title, parent_task_id, is_urgent, is_important, detail, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            task.id,
            this.scope.userId,
            task.title,
            task.parentTaskId ?? null,
            task.isUrgent ? 1 : 0,
            task.isImportant ? 1 : 0,
            task.detail ?? null,
            task.status,
            task.status === 'completed' ? sqlDate(task.completedAt ?? task.updatedAt) : null,
            sqlDate(task.createdAt),
            sqlDate(task.updatedAt),
          ],
        )
      }
    })
  }
}
