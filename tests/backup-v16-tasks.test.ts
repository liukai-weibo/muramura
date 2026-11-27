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

const parent: Task = {
  id: 'task-1', title: '完成流水线切换', status: 'completed', isUrgent: false, isImportant: true,
  completedAt: '2026-11-24T03:00:00.000Z',
  createdAt: '2026-11-23T02:00:00.000Z', updatedAt: '2026-11-24T03:00:00.000Z',
}

const child: Task = {
  id: 'task-2', title: 'agent 任务冒烟测试', status: 'active', parentTaskId: 'task-1', isUrgent: false, isImportant: true,
  createdAt: '2026-11-24T03:01:00.000Z', updatedAt: '2026-11-24T03:01:00.000Z',
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

describe('backup V16 task chain', () => {
  it('exports version 16 with the parent link', async () => {
    const backup = await service(stubTasks([parent, child]).store).createBackup()
    expect(backup.version).toBe(17)
    const tasks = (backup as unknown as { data: { tasks: Task[] } }).data.tasks
    expect(tasks.find(task => task.id === 'task-2')?.parentTaskId).toBe('task-1')
  })

  it('upgrades a V15 backup without inventing a parent link', () => {
    const legacy = {
      format: 'knowledge-base-backup', version: 15,
      exportedAt: '2026-11-24T00:00:00.000Z', appVersion: '0.3.17',
      data: { ...baseCollections, tasks: [parent] },
    }
    const parsed = service(stubTasks().store).parseAndValidate(JSON.stringify(legacy))
    expect(parsed.version).toBe(17)
    const tasks = (parsed as unknown as { data: { tasks: Task[] } }).data.tasks
    expect(tasks[0]).toMatchObject({ id: 'task-1', status: 'completed' })
    expect(tasks[0]!.parentTaskId).toBeUndefined()
  })

  it('rejects a non-string parent link', () => {
    const broken = {
      format: 'knowledge-base-backup', version: 16,
      exportedAt: '2026-11-24T00:00:00.000Z', appVersion: '0.4.0',
      data: { ...baseCollections, tasks: [{ ...child, parentTaskId: 42 }] },
    }
    expect(() => service(stubTasks().store).parseAndValidate(JSON.stringify(broken))).toThrow(/承接关系/)
  })
})
