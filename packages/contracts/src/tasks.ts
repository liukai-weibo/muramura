export const TASK_STATUSES = ['active', 'pool', 'completed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** 用户可创建/看到的任务桶；completed 只用于内部状态与未来统计。 */
export const TASK_VISIBLE_STATUSES = ['active', 'pool'] as const
export type TaskVisibleStatus = (typeof TASK_VISIBLE_STATUSES)[number]

export const TASK_TITLE_MAX_LENGTH = 120
export const TASK_DETAIL_MAX_LENGTH = 2000

export const TASK_QUADRANTS = ['urgent-important', 'important', 'urgent', 'normal'] as const
export type TaskQuadrant = (typeof TASK_QUADRANTS)[number]

export interface Task {
  id: string
  title: string
  /** 承接自哪一个已完成任务；仅「完成并派生下一步」创建的任务有值。 */
  parentTaskId?: string
  /** 四象限：紧急 × 重要。 */
  isUrgent: boolean
  isImportant: boolean
  /** 任务详情；默认折叠，点开后才展开编辑。 */
  detail?: string
  status: TaskStatus
  /** 仅 completed 有值。 */
  completedAt?: string
  createdAt: string
  updatedAt: string
}

/** 四象限判定集中在一处，前后端与备份共用同一套规则。 */
export function taskQuadrant(task: Pick<Task, 'isUrgent' | 'isImportant'>): TaskQuadrant {
  if (task.isUrgent && task.isImportant) return 'urgent-important'
  if (task.isImportant) return 'important'
  if (task.isUrgent) return 'urgent'
  return 'normal'
}

export interface TaskCreateInput {
  title: string
  bucket: TaskVisibleStatus
  parentTaskId?: string
  isUrgent?: boolean
  isImportant?: boolean
  detail?: string
}

export interface TaskUpdateInput {
  title?: string
  detail?: string
  isUrgent?: boolean
  isImportant?: boolean
}

export interface TaskRepository {
  list(): Promise<Task[]>
  listCompleted(): Promise<Task[]>
  get(id: string): Promise<Task | undefined>
  create(input: TaskCreateInput): Promise<Task>
  update(id: string, input: TaskUpdateInput): Promise<Task | undefined>
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
