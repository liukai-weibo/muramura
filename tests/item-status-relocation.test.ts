import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/index.tsx'), 'utf8')

describe('item status relocation after confirmed refresh', () => {
  it('only relocates the two authorized status transitions', () => {
    expect(pageSource).toContain("selectedItem.status === 'idea_to_try' && action.status === 'idea_later'")
    expect(pageSource).toContain("selectedItem.status === 'doing' && action.status === 'paused'")
  })

  it('waits for a real refresh containing the same item at the target status before changing left navigation', () => {
    const changeStatusBlock = pageSource.slice(pageSource.indexOf('  const changeStatus = (action: ItemAction) => {'), pageSource.indexOf('  const removeSelected = () => {'))
    expect(changeStatusBlock).toContain('await application.changeStatus(changedItemId, action.status)')
    expect(changeStatusBlock).toContain('const refreshed = await refresh(changedItemId)')
    expect(changeStatusBlock).toContain('refreshed.items.findIndex((item) => item.id === changedItemId && item.status === action.status)')
    expect(changeStatusBlock).toContain('if (refreshedIndex >= 0)')
    expect(changeStatusBlock).toContain('setFilter(action.status)')
    expect(changeStatusBlock).toContain('setCurrentPage(Math.floor(refreshedIndex / ITEMS_PER_PAGE) + 1)')
    expect(changeStatusBlock).toContain('setSelectedId(changedItemId)')
    expect(changeStatusBlock.indexOf('const refreshed = await refresh(changedItemId)')).toBeLessThan(changeStatusBlock.indexOf('setFilter(action.status)'))
  })

  it('does not relocate when the write or real refresh fails, aborts, becomes unknown, or cannot confirm the item', () => {
    const changeStatusBlock = pageSource.slice(pageSource.indexOf('  const changeStatus = (action: ItemAction) => {'), pageSource.indexOf('  const removeSelected = () => {'))
    expect(changeStatusBlock).toContain('if (refreshedIndex >= 0)')
    expect(changeStatusBlock).not.toContain('setFilter(action.status)\n      await application.changeStatus')
    expect(changeStatusBlock).not.toContain('retry')
  })

  it('keeps the existing exploration-fact refresh after status writes', () => {
    const changeStatusBlock = pageSource.slice(pageSource.indexOf('  const changeStatus = (action: ItemAction) => {'), pageSource.indexOf('  const removeSelected = () => {'))
    expect(changeStatusBlock).toContain('setExplorationFactsVersion((version) => version + 1)')
  })
})
