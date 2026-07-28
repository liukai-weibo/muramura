import { describe, expect, it } from 'vitest'
import { ItemApplicationService, MethodApplicationService } from '@knowledge-base/application'
import { assertItemTitleLength, normalizeItemTitle } from '@knowledge-base/domain'
import type { CreateItemInput, Item, ItemRepository, MethodApplicationRepository } from '@knowledge-base/contracts'

const twenty = '😀'.repeat(20)
const twentyOne = '😀'.repeat(21)
const item = (title: string): Item => ({ id: 'item', title, content: '', status: 'idea_to_try', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' })

describe('item title grapheme boundary', () => {
  it('normalizes before counting 20/21 user-visible graphemes', () => {
    expect(normalizeItemTitle(` ${twenty} `)).toBe(twenty)
    expect(() => assertItemTitleLength(twenty)).not.toThrow()
    expect(() => assertItemTitleLength(twentyOne)).toThrow('标题最多 20 个字符')
  })

  it('rejects Application writes before repositories, including content-first title generation', async () => {
    let creates = 0
    const repository = { create: async (input: CreateItemInput) => { creates += 1; return item(input.title) } } as unknown as ItemRepository
    const service = new ItemApplicationService(repository)
    expect(() => service.createIdea({ title: twentyOne })).toThrow('标题最多 20 个字符')
    expect(() => service.createIdea({ content: `${twentyOne}\nbody` })).toThrow('标题最多 20 个字符')
    expect(creates).toBe(0)
  })

  it('rejects MethodApplicationService before its repository', async () => {
    let creates = 0
    const repository = { createItem: async () => { creates += 1; return item('unexpected') } } as unknown as MethodApplicationRepository
    expect(() => new MethodApplicationService(repository).createItem('method', twentyOne)).toThrow('标题最多 20 个字符')
    expect(creates).toBe(0)
  })
})
