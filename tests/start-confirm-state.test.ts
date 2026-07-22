import { describe, expect, it } from 'vitest'

import type { Item } from '@knowledge-base/contracts'
import type { ItemAction } from '@knowledge-base/application'
import { canOpenStartConfirm, getDoingActionContextLayout, shouldDisplayStartAction, shouldInterceptStartAction, startFeedbackVisible } from '../apps/client/src/pages/index/start-confirm-state'

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    title: '事项',
    content: '',
    status: 'idea_to_try',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

const startAction: ItemAction = { status: 'doing', label: '开始执行', tone: 'primary' }

describe('启动确认层前端守卫', () => {
  it('仅拦截未删除的想试试事项进入进行中', () => {
    expect(shouldInterceptStartAction(item(), startAction)).toBe(true)
    expect(shouldInterceptStartAction(item({ status: 'idea_later' }), startAction)).toBe(false)
    expect(shouldInterceptStartAction(item({ deletedAt: '2026-07-21T01:00:00.000Z' }), startAction)).toBe(false)
    expect(shouldInterceptStartAction(item(), { ...startAction, status: 'idea_later' })).toBe(false)
  })

  it('只允许实时存在且仍为想试试的事项打开确认层', () => {
    expect(canOpenStartConfirm(item())).toBe(true)
    expect(canOpenStartConfirm(item({ status: 'doing' }))).toBe(false)
    expect(canOpenStartConfirm(item({ deletedAt: '2026-07-21T01:00:00.000Z' }))).toBe(false)
    expect(canOpenStartConfirm(undefined)).toBe(false)
  })

  it('仅为已保存启动动作且已离开灵感状态的事项显示只读快照', () => {
    expect(shouldDisplayStartAction(item({ status: 'doing', startAction: '先找一份入门资料' }))).toBe(true)
    expect(shouldDisplayStartAction(item({ status: 'idea_to_try', startAction: '历史异常值' }))).toBe(false)
    expect(shouldDisplayStartAction(item({ status: 'idea_later', startAction: '历史异常值' }))).toBe(false)
    expect(shouldDisplayStartAction(item({ status: 'doing' }))).toBe(false)
  })


  it('进行中始终展示补充说明，并仅在存在快照时追加启动动作', () => {
    expect(getDoingActionContextLayout(item({ status: 'doing', content: '背景', startAction: '先准备资料' }), false)).toBe('both')
    expect(getDoingActionContextLayout(item({ status: 'doing', content: '背景' }), false)).toBe('content')
    expect(getDoingActionContextLayout(item({ status: 'doing', startAction: '先准备资料' }), false)).toBe('both')
    expect(getDoingActionContextLayout(item({ status: 'doing', content: '  ', startAction: '  ' }), false)).toBe('content')
    expect(getDoingActionContextLayout(item({ status: 'doing', startAction: '先准备资料' }), true)).toBe('editing')
    expect(getDoingActionContextLayout(item({ status: 'paused', content: '背景', startAction: '先准备资料' }), false)).toBe('hidden')
    expect(getDoingActionContextLayout(item({ status: 'doing', startAction: '先准备资料', deletedAt: '2026-07-21T01:00:00.000Z' }), false)).toBe('hidden')
  })

  it('局部成功反馈只显示给本次成功启动且已进入进行中的事项', () => {
    expect(startFeedbackVisible('item-1', item({ status: 'doing' }))).toBe(true)
    expect(startFeedbackVisible('item-1', item())).toBe(false)
    expect(startFeedbackVisible('item-1', item({ id: 'item-2', status: 'doing' }))).toBe(false)
    expect(startFeedbackVisible(undefined, item({ status: 'doing' }))).toBe(false)
  })
})
