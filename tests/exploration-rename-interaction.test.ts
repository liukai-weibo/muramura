import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const prototype = readFileSync(new URL('../apps/client/src/pages/index/exploration-prototype.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('exploration track low-friction rename interaction', () => {
  it('uses one frozen-track save path for the save button and consumed outside pointer clicks', () => {
    expect(prototype).toContain("const [editingTrackId, setEditingTrackId] = useState<string>()")
    expect(prototype).toContain('const editingSessionRef = useRef(0)')
    expect(prototype).toContain('const saveEditingTrack = async () => {')
    expect(prototype).toContain('const trackId = editingTrackIdRef.current')
    expect(prototype).toContain('if (editingSessionRef.current !== session || editingTrackIdRef.current !== trackId) return')
    expect(prototype).toContain("root.addEventListener('pointerdown', consumeOutsideEditingPointer, true)")
    expect(prototype).toContain("root.addEventListener('click', consumeOutsideEditingPointer, true)")
    expect(prototype).toContain("root.removeEventListener('pointerdown', consumeOutsideEditingPointer, true)")
    expect(prototype).toContain('event.preventDefault()\n    event.stopPropagation()\n    void saveEditingTrack()')
    expect(prototype).toContain("ref={editingAreaRef} className='exploration-edit'")
    expect(prototype).toContain('onClick={saveEditingTrack}>保存</Button>')
    expect(prototype).toContain('onClick={beginEditingTrack}>改名</Button>')
    expect(prototype).not.toContain("onClick={() => setEditing(false)}>取消</Button>")
    expect(prototype).not.toContain('setTimeout(')
  })

  it('keeps the edit session and draft after failed or unknown rename writes', () => {
    const saveFunction = prototype.slice(prototype.indexOf('const saveEditingTrack = async () => {'), prototype.indexOf('const beginEditingTrack = () => {'))

    expect(saveFunction).toContain("catch (cause) { preserveUnknownOutcome(cause, '改名未完成，请重试。') }")
    expect(saveFunction).toContain('setEditing(false); setEditingTrackId(undefined); editingTrackIdRef.current = undefined')
    expect(saveFunction).not.toContain("catch (cause) { preserveUnknownOutcome(cause, '改名未完成，请重试。'); setEditing(false)")
    expect(saveFunction).toContain('savingRenameSessionRef.current === session')
  })
})
