import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canModifyItemExplorationContext } from '../apps/client/src/pages/index/item-exploration-state'

const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const prototype = readFileSync(new URL('../apps/client/src/pages/index/exploration-prototype.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')

describe('exploration H5 visual and refresh state', () => {
  it('keeps deleted and unavailable contexts read-only with the approved selector controls', () => {
    const track = { id: 'track-1', name: 'Deleted track', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' }

    expect(canModifyItemExplorationContext({ status: 'track-deleted', itemId: 'item-1', track: { ...track, deletedAt: '2026-07-26T01:00:00.000Z' } })).toBe(false)
    expect(canModifyItemExplorationContext({ status: 'unavailable', itemId: 'item-1', trackId: 'missing-track' })).toBe(false)
    expect(page).toContain("className='item-exploration-actions'")
    expect(page).toContain("className='exploration-inline-button danger'")
    expect(page).toContain("className='exploration-inline-button item-exploration-selector-cancel'")
    expect(page).toContain('onClick={() => setExplorationSelectorOpen(false)}>')
    expect(styles).toContain('.item-exploration-selector-options')
  })

  it('retains loaded exploration content during refreshes and module switches', () => {
    expect(prototype).toContain("{listLoading && listReadSucceeded && <Text className='exploration-refreshing'>正在更新…</Text>}")
    expect(prototype).toContain("{detailLoading && !history ? <View className='exploration-state'><Text>正在载入探索历史…</Text></View>")
    expect(prototype).toContain("{detailLoading && <Text className='exploration-refreshing'>正在更新…</Text>}")
    expect(prototype).toContain('TruncatedDisplayName')
    expect(prototype).toContain('exploration-track-item-time')
    expect(prototype).toContain('exploration-create-modal-backdrop')
    expect(page).toContain("const [explorationMounted, setExplorationMounted] = useState(false)")
    expect(page).toContain("if (activeModule === 'explorations') setExplorationMounted(true)")
    expect(styles).toContain('.exploration-module-retained-hidden { display: none; }')
    expect(styles).toContain('.exploration-detail { width: min(100%, 760px); margin: 0 auto; }')
    expect(styles).toContain('.exploration-list-heading > view > text:last-child')
    expect(styles).toContain('white-space: nowrap')
  })
})
