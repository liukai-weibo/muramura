import { describe, expect, it } from 'vitest'
import { BackupApplicationService } from '../packages/application/src/backup'
import type { BackupRepository, Task, TaskBackupStore } from '@knowledge-base/contracts'

function stubRepository(): BackupRepository {
  return {
    async exportData() {
      return {
        items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
        itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
      }
    },
    async replaceData() { return undefined },
  }
}

const task: Task = {
  id: 'task-1',
  title: '写周报',
  status: 'active',
  isUrgent: false,
  isImportant: true,
  createdAt: '2026-11-11T08:00:00.000Z',
  updatedAt: '2026-11-11T08:00:00.000Z',
}

const completed: Task = {
  id: 'task-2',
  title: '整理照片',
  status: 'completed',
  isUrgent: false,
  isImportant: true,
  completedAt: '2026-11-11T09:00:00.000Z',
  createdAt: '2026-11-11T08:00:00.000Z',
  updatedAt: '2026-11-11T09:00:00.000Z',
}

function stubTasks(seed: Task[] = []) {
  const tasks = [...seed]
  const store: TaskBackupStore = {
    async exportBackup() { return tasks },
    async replaceBackup(values) { tasks.splice(0, tasks.length, ...values) },
  }
  return { store, tasks }
}

const buildService = (store: TaskBackupStore) =>
  new BackupApplicationService(stubRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store)

const baseCollections = {
  items: [], reviews: [], methods: [], methodEvidence: [], methodVersions: [], methodApplications: [],
  itemStatusEvents: [], itemLinks: [], methodTombstones: [], explorationTracks: [],
  dailyNotes: [], dailyNoteEntries: [], moodEntries: [], mealEntries: [], dailySummaries: [],
  dailyDietRecommendations: [], homeAiCards: [], homeAiCardCaches: [], sleepEntries: [],
}

const documentWith = (version: number, tasks?: unknown[]) => ({
  format: 'knowledge-base-backup',
  version,
  exportedAt: '2026-11-11T10:00:00.000Z',
  appVersion: '0.3.0',
  data: { ...baseCollections, ...(tasks ? { tasks } : {}) },
})

describe('backup V14 tasks', () => {
  it('exports the current version with tasks', async () => {
    const backup = await buildService(stubTasks([task, completed]).store).createBackup()
    expect(backup.version).toBe(17)
    expect((backup as { data: { tasks: Task[] } }).data.tasks).toHaveLength(2)
  })

  it('restores V14 tasks as-is', async () => {
    const source = stubTasks([task, completed]).store
    const backup = await buildService(source).createBackup()
    const target = stubTasks()
    const service = buildService(target.store)
    await service.restoreBackup(await service.parseAndValidate(JSON.stringify(backup)))
    expect(target.tasks).toHaveLength(2)
    expect(target.tasks.find(item => item.id === 'task-2')?.completedAt).toBe(completed.completedAt)
  })

  it('upgrades a V13 backup to V15 with an empty task list', async () => {
    const parsed = buildService(stubTasks().store).parseAndValidate(JSON.stringify(documentWith(13)))
    expect(parsed.version).toBe(17)
    expect((parsed as { data: { tasks: Task[] } }).data.tasks).toEqual([])
  })

  it('rejects missing, malformed and duplicate task collections', () => {
    const service = buildService(stubTasks().store)
    for (const tasks of [undefined, [null], [task, task]]) {
      expect(() => service.parseAndValidate(JSON.stringify(documentWith(14, tasks)))).toThrow()
    }
  })

  it('keeps sleep ordering validation in V14', () => {
    const doc = documentWith(14, [])
    const data = doc.data as Record<string, unknown>
    data.sleepEntries = [{ id: 'invalid', sleepDate: '2026-11-11', wakeAt: '2026-11-12T01:00:00.000Z', createdAt: task.createdAt, updatedAt: task.updatedAt }]
    expect(() => buildService(stubTasks().store).parseAndValidate(JSON.stringify(doc))).toThrow(/起床/)
  })

  it('rejects a completed task without completedAt', async () => {
    const invalid = { ...completed, completedAt: undefined }
    expect(() => buildService(stubTasks().store).parseAndValidate(JSON.stringify(documentWith(14, [invalid]))))
      .toThrow(/完成时间/)
  })
})
