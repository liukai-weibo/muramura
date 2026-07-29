import { describe, expect, it } from 'vitest'
import { ItemApplicationService, MethodApplicationService } from '@knowledge-base/application'
import { assertItemTitleLength, BusinessError, normalizeItemTitle } from '@knowledge-base/domain'
import type { CreateItemInput, Item, ItemRepository, MethodApplicationRepository } from '@knowledge-base/contracts'
import { mapFailure } from '../apps/api/src/api-errors'

const twenty = '😀'.repeat(20)
const twentyOne = '😀'.repeat(21)
const item = (title: string): Item => ({ id: 'item', title, content: '', status: 'idea_to_try', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' })

describe('item title grapheme boundary', () => {
  it('normalizes before counting 20/21 user-visible graphemes', () => {
    expect(normalizeItemTitle(` ${twenty} `)).toBe(twenty)
    expect(() => assertItemTitleLength(twenty)).not.toThrow()
    expect(() => assertItemTitleLength(twentyOne)).toThrow('标题最多 20 个字符')
    try {
      assertItemTitleLength(twentyOne)
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessError)
      expect(error).toMatchObject({ code: 'ITEM_TITLE_TOO_LONG', category: 'validation' })
    }
  })

  it('maps an overlong title to the frozen API validation failure', () => {
    try {
      assertItemTitleLength(twentyOne)
    } catch (error) {
      expect(mapFailure(error)).toEqual({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: '标题最多 20 个字符',
        businessCode: 'ITEM_TITLE_TOO_LONG',
      })
    }
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
