export const TASK_STATUSES = ['active', 'pool', 'completed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** 用户可创建/看到的任务桶；completed 只用于内部状态与未来统计。 */
export const TASK_VISIBLE_STATUSES = ['active', 'pool'] as const
export type TaskVisibleStatus = (typeof TASK_VISIBLE_STATUSES)[number]

export const TASK_TITLE_MAX_LENGTH = 120

export interface Task {
  id: string
  title: string
  status: TaskStatus
  /** 仅 completed 有值。 */
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface TaskCreateInput {
  title: string
  bucket: TaskVisibleStatus
}

export interface TaskRepository {
  list(): Promise<Task[]>
  listCompleted(): Promise<Task[]>
  get(id: string): Promise<Task | undefined>
  create(input: TaskCreateInput): Promise<Task>
  updateStatus(id: string, status: TaskStatus, completedAt?: string): Promise<Task | undefined>
  remove(id: string): Promise<boolean>
}

export interface TaskBackupStore {
  exportBackup(): Promise<Task[]>
  replaceBackup(tasks: Task[]): Promise<void>
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function isVisibleTaskStatus(value: unknown): value is TaskVisibleStatus {
  return typeof value === 'string' && (TASK_VISIBLE_STATUSES as readonly string[]).includes(value)
}
