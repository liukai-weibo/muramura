import { describe, expect, it } from 'vitest'

import { searchCollapseState, searchExitState, searchResultSelectionState, shouldOpenSearchResults } from '../apps/client/src/pages/index/search-session-state'

describe('全局搜索会话状态', () => {
  it('有关键词时打开结果浮层，手动删空时只关闭浮层', () => {
    expect(shouldOpenSearchResults('练字')).toBe(true)
    expect(shouldOpenSearchResults('   ')).toBe(false)
  })

  it('手动删空搜索词时只关闭浮层，输入框继续展开', () => {
    expect(shouldOpenSearchResults('')).toBe(false)
  })

  it('点击结果外区域或 Esc 只收回控件，搜索草稿仍由页面保留', () => {
    expect(searchCollapseState()).toEqual({ expanded: false, resultsOpen: false })
  })

  it('选择结果收回搜索控件但保留搜索草稿', () => {
    expect(searchResultSelectionState()).toEqual({ expanded: false, resultsOpen: false })
  })

  it('只有显式退出才清空搜索词并收回输入框', () => {
    expect(searchExitState()).toEqual({ query: '', expanded: false, resultsOpen: false })
  })
})
