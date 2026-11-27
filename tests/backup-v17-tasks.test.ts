import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, Task, TaskBackupStore } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() {
      return {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
        itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
        dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
        dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries: [], tasks: [],
      } as unknown as ReturnType<BackupRepository['exportData']> extends Promise<infer T> ? T : never
    },
    async replaceData() { return undefined },
  }
}

const task: Task = {
  id: 'task-1', title: '写季度复盘', status: 'active',
  isUrgent: true, isImportant: true, detail: '先看数据',
  createdAt: '2026-11-25T02:00:00.000Z', updatedAt: '2026-11-25T02:00:00.000Z',
}

function stubTasks(seed: Task[] = []) {
  const tasks = [...seed]
  const store: TaskBackupStore = {
    async exportBackup() { return tasks },
    async replaceBackup(values) { tasks.splice(0, tasks.length, ...values) },
  }
  return { store, tasks }
}

const service = (store: TaskBackupStore) =>
  new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)

const baseCollections = {
  items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
  itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
  dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
  dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries: [],
}

describe('backup V17 task priority and detail', () => {
  it('exports version 17 with quadrant flags and detail', async () => {
    const backup = await service(stubTasks([task]).store).createBackup()
    expect(backup.version).toBe(17)
    const tasks = (backup as unknown as { data: { tasks: Task[] } }).data.tasks
    expect(tasks[0]).toMatchObject({ isUrgent: true, isImportant: true, detail: '先看数据' })
  })

  it('upgrades a V16 backup with the default quadrant and no detail', () => {
    const legacy = {
      format: 'knowledge-base-backup', version: 16,
      exportedAt: '2026-11-25T00:00:00.000Z', appVersion: '0.4.0',
      data: { ...baseCollections, tasks: [{ id: 'task-1', title: '旧任务', status: 'active', createdAt: task.createdAt, updatedAt: task.updatedAt }] },
    }
    const parsed = service(stubTasks().store).parseAndValidate(JSON.stringify(legacy))
    expect(parsed.version).toBe(17)
    const tasks = (parsed as unknown as { data: { tasks: Task[] } }).data.tasks
    expect(tasks[0]).toMatchObject({ isUrgent: false, isImportant: true })
    expect(tasks[0]!.detail).toBeUndefined()
  })

  it('rejects a non-boolean quadrant flag', () => {
    const broken = {
      format: 'knowledge-base-backup', version: 17,
      exportedAt: '2026-11-25T00:00:00.000Z', appVersion: '0.5.0',
      data: { ...baseCollections, tasks: [{ ...task, isUrgent: 'yes' }] },
    }
    expect(() => service(stubTasks().store).parseAndValidate(JSON.stringify(broken))).toThrow(/紧急标记/)
  })
})
