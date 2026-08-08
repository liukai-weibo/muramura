import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')

describe('settings data status and restore preview', () => {
  it('keeps the four real data counters equal-width on wide desktop and stacks safely on narrow screens', () => {
    expect(styles).toContain('.data-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));')
    expect(styles).toContain('.data-status-grid > view { display: flex; min-width: 0;')
    expect(styles).toContain('@media (max-width: 800px) {')
    expect(styles).toContain('.data-status-grid { grid-template-columns: 1fr; }')
    expect(page).toContain('<Text>{activeExplorationTrackCount ?? \'—\'}</Text><Text>长期探索</Text>')
  })

  it('shows zero and multi-track restore previews from the existing Backup V3 payload only', () => {
    expect(page).toContain('pendingBackup.version === 3 ? pendingBackup.data.explorationTracks.length : 0')
    expect(page).toContain('条事项 · {pendingBackup.data.reviews.length} 条复盘 · {pendingBackup.data.methods.length} 条方法 · {pendingBackup.version === 3 ? pendingBackup.data.explorationTracks.length : 0} 条长期探索')
    expect(page).not.toContain('createExplorationTrackCount')
    expect(page).not.toContain('retryRestoreBackup')
  })
})
