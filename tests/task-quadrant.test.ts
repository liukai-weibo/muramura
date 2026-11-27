import { describe, expect, it } from 'vitest'
import { taskQuadrant } from '../packages/contracts/src/tasks'

describe('task quadrant', () => {
  it('maps urgency and importance to the four quadrants', () => {
    expect(taskQuadrant({ isUrgent: true, isImportant: true })).toBe('urgent-important')
    expect(taskQuadrant({ isUrgent: false, isImportant: true })).toBe('important')
    expect(taskQuadrant({ isUrgent: true, isImportant: false })).toBe('urgent')
    expect(taskQuadrant({ isUrgent: false, isImportant: false })).toBe('normal')
  })
})
