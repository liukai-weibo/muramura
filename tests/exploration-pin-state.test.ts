import { describe, expect, it } from 'vitest'
import { explorationPinStorageKey, orderPinnedExplorations, parseExplorationPins, toggleExplorationPin } from '../apps/client/src/pages/index/exploration-pin-state'

const entries = Array.from({ length: 12 }, (_, index) => ({ track: { id: `track-${index + 1}` } }))

describe('exploration pin preference', () => {
  it('moves tracks across page boundaries while preserving other order', () => {
    const ordered = orderPinnedExplorations(entries, ['track-12', 'track-3'])
    expect(ordered.map(entry => entry.track.id)).toEqual(['track-12', 'track-3', 'track-1', 'track-2', 'track-4', 'track-5', 'track-6', 'track-7', 'track-8', 'track-9', 'track-10', 'track-11'])
    expect(entries[0]!.track.id).toBe('track-1')
  })
  it('puts the newest pin first and removes a pin on second click', () => {
    expect(toggleExplorationPin(['track-3'], 'track-12')).toEqual(['track-12', 'track-3'])
    expect(toggleExplorationPin(['track-12', 'track-3'], 'track-12')).toEqual(['track-3'])
    expect(orderPinnedExplorations(entries, []).map(entry => entry.track.id)).toEqual(entries.map(entry => entry.track.id))
  })
  it('ignores missing/archived pins when sorting visible tracks', () => {
    expect(orderPinnedExplorations(entries, ['missing', 'track-2'])[0]!.track.id).toBe('track-2')
  })
  it('parses stored preferences defensively without mixing accounts', () => {
    expect(parseExplorationPins('["a",null,"b","a",5,""]')).toEqual(['a', 'b'])
    expect(parseExplorationPins('bad json')).toEqual([])
    expect(parseExplorationPins(null)).toEqual([])
    expect(explorationPinStorageKey('user-a')).not.toBe(explorationPinStorageKey('user-b'))
  })
})
