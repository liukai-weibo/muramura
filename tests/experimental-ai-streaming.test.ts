import { describe, expect, it } from 'vitest'
import { ConversationActiveStreams } from '../apps/api/src/experimental-ai/streaming'

describe('AI conversation stream coordination', () => {
  it('aborts only the previous stream for the same owner and conversation', () => {
    const streams = new ConversationActiveStreams()
    const parent = new AbortController()
    const first = streams.begin('owner-1:conversation-1', parent.signal)
    const other = streams.begin('owner-1:conversation-2', parent.signal)
    const second = streams.begin('owner-1:conversation-1', parent.signal)

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(other.signal.aborted).toBe(false)
  })

  it('cancels the target stream when its request is aborted', () => {
    const streams = new ConversationActiveStreams()
    const parent = new AbortController()
    const controller = streams.begin('owner-1:conversation-1', parent.signal)

    parent.abort()

    expect(controller.signal.aborted).toBe(true)
  })

  it('does not let a finished old stream clear a newer stream', () => {
    const streams = new ConversationActiveStreams()
    const parent = new AbortController()
    const first = streams.begin('owner-1:conversation-1', parent.signal)
    const second = streams.begin('owner-1:conversation-1', parent.signal)

    streams.finish('owner-1:conversation-1', first)
    expect(second.signal.aborted).toBe(false)
    streams.finish('owner-1:conversation-1', second)
  })
})
