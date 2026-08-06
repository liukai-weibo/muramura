import { describe, expect, it } from 'vitest'
import { IncrementalMarkdownParser } from '../apps/client/src/pages/index/experimental-ai/components/experimental-ai-block-parser'

describe('incremental AI markdown block parser', () => {
  it('keeps an unfinished line active across chunks', () => {
    const parser = new IncrementalMarkdownParser()
    expect(parser.append('**核心')).toMatchObject({ active: { kind: 'paragraph', text: '**核心' } })
    expect(parser.append('判断**\n\n下一段')).toMatchObject({ closed: [{ text: '**核心判断**' }], active: { text: '下一段' } })
  })

  it('does not close a fenced code block until the closing fence', () => {
    const parser = new IncrementalMarkdownParser()
    parser.append('```ts\nconst answer = 1\n')
    expect(parser.append('const next = 2')).toMatchObject({ active: { kind: 'code', language: 'ts' } })
    expect(parser.append('\n```\n\n结尾', true)).toMatchObject({ closed: [{ kind: 'code', text: 'const answer = 1\nconst next = 2' }, { kind: 'paragraph', text: '结尾' }] })
  })

  it('keeps list and quote blocks stable across chunks', () => {
    const parser = new IncrementalMarkdownParser()
    const snapshot = parser.append('1. 第一步\n2. 第二步\n\n> 证据\n\n普通段落', true)
    expect(snapshot.closed.map((block) => block.kind)).toEqual(['ordered-list', 'quote', 'paragraph'])
  })
})
