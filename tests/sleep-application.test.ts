import { describe, expect, it } from 'vitest'
import type { SleepEntry, SleepRepository, SleepSettings, SleepSettingsWriteInput } from '@knowledge-base/contracts'
import { SLEEP_DEFAULT_SETTINGS, sleepDayOf } from '@knowledge-base/contracts'
import { SleepApplicationService } from '../packages/application/src/sleep'

class StubSleepRepository implements SleepRepository {
  entries = new Map<string, SleepEntry>()
  settings: SleepSettings = { ...SLEEP_DEFAULT_SETTINGS }

  async listRange(): Promise<SleepEntry[]> { return [...this.entries.values()] }

  async getByDate(sleepDate: string): Promise<SleepEntry | undefined> { return this.entries.get(sleepDate) }

  async write(sleepDate: string, values: { wakeAt?: string; bedAt?: string; note?: string }): Promise<SleepEntry> {
    const entry: SleepEntry = {
      id: 'sleep-1', sleepDate,
      ...(values.wakeAt ? { wakeAt: values.wakeAt } : {}),
      ...(values.bedAt ? { bedAt: values.bedAt } : {}),
      ...(values.note ? { note: values.note } : {}),
      createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
    }
    this.entries.set(sleepDate, entry)
    return entry
  }

  async remove(sleepDate: string): Promise<boolean> { return this.entries.delete(sleepDate) }
  async getSettings(): Promise<SleepSettings> { return this.settings }

  async saveSettings(input: SleepSettingsWriteInput): Promise<SleepSettings> {
    this.settings = { ...this.settings, ...input }
    return this.settings
  }

  async ackReminder(date: string): Promise<SleepSettings> {
    this.settings = { ...this.settings, lastPromptedDate: date }
    return this.settings
  }
}

async function expectInvalid(work: () => Promise<unknown>): Promise<void> {
  let thrown: unknown
  try { await work() } catch (error) { thrown = error }
  expect(thrown).toMatchObject({ code: 'SLEEP_ENTRY_INVALID' })
}

// 东八区 2026-11-07 23:40 / 2026-11-08 07:10。
const wakeAt = '2026-11-06T23:10:00.000Z'
const bedAt = '2026-11-07T15:40:00.000Z'

describe('SleepApplicationService', () => {
  it('creates a day with only the wake time', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    const result = await service.save('2026-11-07', { wakeAt })
    expect(result.deleted).toBe(false)
    expect(result.entry).toMatchObject({ sleepDate: '2026-11-07', wakeAt })
    expect(result.entry!.bedAt).toBeUndefined()
  })

  it('merges a later bedtime into an existing wake-only day', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt })
    const merged = await service.save('2026-11-07', { bedAt })
    expect(merged.entry).toMatchObject({ wakeAt, bedAt })
  })

  it('clears only the field that is sent as null', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt, bedAt })
    const cleared = await service.save('2026-11-07', { bedAt: null })
    expect(cleared.entry).toMatchObject({ wakeAt })
    expect(cleared.entry!.bedAt).toBeUndefined()
  })

  it('deletes the day when both fields end up empty', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt })
    const removed = await service.save('2026-11-07', { wakeAt: null })
    expect(removed.deleted).toBe(true)
    expect(repository.entries.size).toBe(0)
  })

  it('rejects a wake time on another day', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    await expectInvalid(() => service.save('2026-11-07', { wakeAt: '2026-11-08T23:10:00.000Z' }))
  })

  it('rejects a wake time that is not later than the previous bedtime', async () => {
    const repository = new StubSleepRepository()
    // 11-07 的入睡落在 11-08 06:00（跨到次日）。
    repository.entries.set('2026-11-07', {
      id: 'prev', sleepDate: '2026-11-07', bedAt: '2026-11-07T22:00:00.000Z',
      createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z',
    })
    const service = new SleepApplicationService(repository)
    let thrown: unknown
    try { await service.save('2026-11-08', { wakeAt: '2026-11-07T21:00:00.000Z' }) } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ code: 'SLEEP_ENTRY_INVALID', message: expect.stringContaining('06:00') })
  })

  it('accepts a wake time equal to the previous bedtime (zero hours)', async () => {
    const repository = new StubSleepRepository()
    repository.entries.set('2026-11-07', {
      id: 'prev', sleepDate: '2026-11-07', bedAt: '2026-11-07T22:00:00.000Z',
      createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z',
    })
    const service = new SleepApplicationService(repository)
    const saved = await service.save('2026-11-08', { wakeAt: '2026-11-07T22:00:00.000Z' })
    expect(saved.entry?.wakeAt).toBe('2026-11-07T22:00:00.000Z')
  })

  it('accepts a bedtime equal to the same-day wake (zero hours)', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt })
    const saved = await service.save('2026-11-07', { bedAt: wakeAt })
    expect(saved.entry?.bedAt).toBe(wakeAt)
  })

  it('rejects a bedtime that is not later than the same-day wake', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt })
    await expectInvalid(() => service.save('2026-11-07', { bedAt: '2026-11-06T23:05:00.000Z' }))
  })

  it('rejects a bedtime that runs into the next day wake', async () => {
    const repository = new StubSleepRepository()
    repository.entries.set('2026-11-08', {
      id: 'next', sleepDate: '2026-11-08', wakeAt: '2026-11-07T23:10:00.000Z',
      createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
    })
    const service = new SleepApplicationService(repository)
    await expectInvalid(() => service.save('2026-11-07', { bedAt: '2026-11-08T00:00:00.000Z' }))
  })

  it('accepts a bedtime after the same-day wake', async () => {
    const repository = new StubSleepRepository()
    const service = new SleepApplicationService(repository)
    await service.save('2026-11-07', { wakeAt })
    const saved = await service.save('2026-11-07', { bedAt })
    expect(saved.entry).toMatchObject({ wakeAt, bedAt })
  })

  it('rejects a next-day bedtime when the day has no wake record', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    await expectInvalid(() => service.save('2026-11-07', { bedAt: '2026-11-07T17:30:00.000Z' }))
  })

  it('rejects future times and over-long notes', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await expectInvalid(() => service.save('2026-11-07', { wakeAt: future }))
    await expectInvalid(() => service.save('2026-11-07', { wakeAt, note: 'x'.repeat(201) }))
  })

  it('allows a bedtime within the one-hour future tolerance', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    const bedAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const sleepDate = sleepDayOf(bedAt)!
    const saved = await service.save(sleepDate, { bedAt })
    expect(saved.entry?.bedAt).toBe(bedAt)
  })

  it('rejects a bedtime more than one hour ahead', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    const bedAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const sleepDate = sleepDayOf(bedAt)!
    await expectInvalid(() => service.save(sleepDate, { bedAt }))
  })

  it('validates the reminder window when saving settings', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    await expectInvalid(() => service.saveSettings({ remindEnabled: true, remindStartMinute: 1400, remindEndMinute: 600, inputPrecision: 'hour' }))
    const saved = await service.saveSettings({ remindEnabled: false, remindStartMinute: 540, remindEndMinute: 1020, inputPrecision: 'minute' })
    expect(saved).toMatchObject({ remindEnabled: false, inputPrecision: 'minute' })
  })

  it('records the acknowledgement date', async () => {
    const service = new SleepApplicationService(new StubSleepRepository())
    expect((await service.acknowledgeReminder('2026-11-09')).lastPromptedDate).toBe('2026-11-09')
  })
})

