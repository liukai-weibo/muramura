import { describe, expect, it } from 'vitest'

import type { Item } from '@knowledge-base/contracts'
import { mergeUpdatedItemContentIntoList } from '../apps/client/src/pages/index/item-content-state'

function item(overrides: Partial<Item>): Item {
  return {
    id: 'item-1',
    title: '事项',
    content: '旧说明',
    status: 'idea_to_try',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T01:00:00.000Z',
    ...overrides,
  }
}

describe('补充说明前端回包合并', () => {
  it('旧保存回包只合并说明字段，不覆盖已刷新到列表的状态或删除标记', () => {
    const refreshed = item({
      status: 'doing',
      updatedAt: '2026-07-21T02:00:00.000Z',
    })
    const staleSaveResponse = item({
      content: '新说明',
      status: 'idea_to_try',
      updatedAt: '2026-07-21T01:30:00.000Z',
    })

    expect(mergeUpdatedItemContentIntoList([refreshed], staleSaveResponse)).toEqual([
      item({ content: '新说明', status: 'doing', updatedAt: '2026-07-21T02:00:00.000Z' }),
    ])
  })

  it('使用保存回包的较新更新时间重排列表', () => {
    const target = item({ id: 'target', updatedAt: '2026-07-21T01:00:00.000Z' })
    const newer = item({ id: 'newer', updatedAt: '2026-07-21T02:00:00.000Z' })
    const response = item({ id: 'target', content: '新说明', updatedAt: '2026-07-21T03:00:00.000Z' })

    expect(mergeUpdatedItemContentIntoList([newer, target], response)).toEqual([
      item({ id: 'target', content: '新说明', updatedAt: '2026-07-21T03:00:00.000Z' }),
      newer,
    ])
  })
})
