import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/index.tsx'), 'utf8')
const styleSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/index.scss'), 'utf8')

describe('H5 status navigation layout', () => {
  it('renders the five persistent states and more-status as one six-cell navigation', () => {
    expect(pageSource).toContain('const statusNavigation: Array')
    expect(pageSource).toContain("{ label: '想试试', status: 'idea_to_try' }")
    expect(pageSource).toContain("{ label: '已开始', status: 'doing' }")
    expect(pageSource).toContain("{ label: '已复盘', status: 'reviewed' }")
    expect(pageSource).toContain("{ label: '以后再说', status: 'idea_later' }")
    expect(pageSource).toContain("{ label: '已暂停', status: 'paused' }")
    expect(pageSource).toContain("className={`filter-button more-status-trigger")
    expect(pageSource).toContain('已放弃（{abandonedItemCount}）')
  })

  it('does not retain artificial status groups or expose historical waiting-review in more-status', () => {
    expect(pageSource).not.toContain('当前行动')
    expect(pageSource).not.toContain('其他状态')
    expect(pageSource).not.toContain('filterGroups')
    expect(pageSource).not.toContain('待完成复盘（历史）（{historicalWaitingReviewCount}）')
  })

  it('relocates only the seven approved status transitions after a confirmed refresh', () => {
    expect(pageSource).toContain("(selectedItem.status === 'idea_to_try' && action.status === 'idea_later')")
    expect(pageSource).toContain("(selectedItem.status === 'idea_later' && action.status === 'idea_to_try')")
    expect(pageSource).toContain("(selectedItem.status === 'doing' && action.status === 'paused')")
    expect(pageSource).toContain("(selectedItem.status === 'paused' && action.status === 'doing')")
    expect(pageSource).toContain("(selectedItem.status === 'idea_later' && action.status === 'abandoned')")
    expect(pageSource).toContain("(selectedItem.status === 'paused' && action.status === 'abandoned')")
    expect(pageSource).toContain("(selectedItem.status === 'abandoned' && action.status === 'idea_to_try')")
    expect(pageSource).toContain('const refreshed = await refresh(changedItemId)')
    expect(pageSource).toContain('const refreshedIndex = refreshed.items.findIndex((item) => item.id === changedItemId && item.status === action.status)')
    expect(pageSource).toContain('if (refreshedIndex >= 0) {\n          setMoreStatusMenuOpen(false)\n          setFilter(action.status)')
    expect(pageSource).toContain('setCurrentPage(Math.floor(refreshedIndex / ITEMS_PER_PAGE) + 1)')
    expect(pageSource).toContain('setSelectedId(changedItemId)')
  })

  it('uses one vertical gap for adjacent detail action stacks and the delete action', () => {
    expect(styleSource).toContain('.action-stack { display: flex; flex-direction: column;')
    expect(styleSource).toContain('.action-stack + .action-stack {')
    expect(styleSource).toContain('.action-stack > .action-button { margin: 0 !important; }')
    expect(styleSource).toContain('.action-button.delete { margin-top: 0; }')
    expect(pageSource).toContain("{(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <Button className='action-button primary' disabled={busy} onClick={openReviewEditor}>开始复盘</Button>}")
    expect(pageSource).not.toContain("{!showTrash && !reviewEditing && (selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <View className='action-stack'>")
    expect(styleSource).toContain('.detail-panel > .action-stack:last-child { margin-top: auto; padding-top: 18px; }')
    expect(styleSource).toContain('.detail-panel > .action-stack:last-child { margin-top: 18px; padding-top: 0; }')
  })

  it('renders the content save confirmation as a non-interactive floating toast', () => {
    expect(pageSource).toContain("{contentSaveNotice && <View className='detail-content-save-toast' role='status'><Text>{contentSaveNotice}</Text></View>}")
    expect(pageSource).not.toContain("<Text className='detail-content-save-notice'>{contentSaveNotice}</Text>")
    expect(styleSource).toContain('.detail-content-save-toast { position: fixed;')
    expect(styleSource).toContain('pointer-events: none;')
  })
  it('renders empty supplemental content at the same muted level as its label', () => {
    expect(pageSource).toContain("className={`action-context-inline-value ${selectedItem.content ? '' : 'muted'}`}")
    expect(styleSource).toContain('.detail-content-heading > .detail-content-label { color: #c1bbb2;')
    expect(styleSource).toContain('.action-context-inline-value.muted { color: #c1bbb2; }')
    expect(styleSource).toContain('.action-context-inline-value { display: -webkit-box; min-width: 0; flex: 1; overflow: hidden; color: #49443d;')
  })
  it('preserves authored line breaks in the two-line summary and uses an ellipsis clamp', () => {
    expect(styleSource).toContain('.action-context-inline-value { display: -webkit-box;')
    expect(styleSource).toContain('white-space: pre-wrap;')
    expect(styleSource).toContain('overflow-wrap: anywhere;')
    expect(styleSource).toContain('-webkit-line-clamp: 2;')
    expect(styleSource).not.toContain('white-space: normal;')
  })

  it('keeps non-empty supplemental content dark despite the heading label rule', () => {
    expect(styleSource).toContain('.detail-content-heading > .action-context-inline-value { color: #49443d; font-size: 14px; font-weight: 400; letter-spacing: 0; }')
    expect(styleSource).toContain('.detail-content-heading > .action-context-inline-value.muted { color: #c1bbb2; }')
  })

  it('grows the supplemental editor through ten lines before internal scrolling', () => {
    expect(pageSource).toContain('function resizeContentEditor(input: HTMLTextAreaElement | null)')
    expect(pageSource).toContain('const borderHeight = input.offsetHeight - input.clientHeight')
    expect(pageSource).toContain("input.style.height = `${input.scrollHeight + borderHeight}px`")
    expect(pageSource).toContain('resizeContentEditor(event.currentTarget); updateContentDraft(selectedItem.id, event.currentTarget.value)')
    expect(styleSource).toContain('.detail-content-input { display: block; box-sizing: border-box; width: 100%; min-height: 42px; max-height: 246px;')
    expect(styleSource).toContain('overflow-y: auto;')
    expect(styleSource).toContain('line-height: 22px;')
  })

  it('keeps supplemental content to a compact one-or-two-line summary without flexible detail spacing', () => {
    expect(styleSource).toContain('.action-context-summary { display: block; margin-top: 18px; flex: 0 0 auto; cursor: text; }')
    expect(styleSource).not.toContain('min-height: 140px')
    expect(styleSource).not.toContain('flex: 1 0 140px')
    expect(styleSource).toContain('display: -webkit-box;')
    expect(styleSource).toContain('-webkit-line-clamp: 2;')
    expect(styleSource).toContain('white-space: pre-wrap;')
    expect(styleSource).toContain('.review-record { margin-top: 18px; padding-top: 18px;')
    expect(styleSource).toContain('.action-stack { display: flex; flex-direction: column; gap: 12px; margin-top: 18px; padding-top: 0; }')
  })

  it('uses a desktop 3 by 2 grid and a narrow-screen two-column fallback', () => {
    expect(styleSource).toContain('.status-navigation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(styleSource).toContain('.status-navigation { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
  })
})
