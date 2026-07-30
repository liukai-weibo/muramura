import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/index.tsx'), 'utf8').replace(/\r\n/g, '\n')
const unknownOutcomeNotice = '本次提交结果未确认，未自动重试。请刷新真实数据后确认是否已生效。'

describe('H5 unknown-outcome interaction boundary', () => {
  it('does not refresh or resend from the unknown-outcome handler', () => {
    const handler = pageSource.match(/const handleUnknownOutcome = \(\) => \{([\s\S]*?)\n  \}/)?.[1]

    expect(handler).toBeDefined()
    expect(handler).toContain(unknownOutcomeNotice)
    expect(handler).not.toContain('refresh(')
    expect(handler).not.toContain('application.')
  })

  it('keeps the existing draft on an unknown outcome', () => {
    const saveItemContent = pageSource.slice(pageSource.indexOf('const saveItemContent = async'), pageSource.indexOf('const locateActiveItemNow'))
    const contentSaveCatch = saveItemContent.match(/if \(isApiClientUnknownOutcome\(error\)\) \{([\s\S]*?)\n      \} else \{/g)?.[0]

    expect(contentSaveCatch).toContain('setContentSaveUnknownOutcome(true)')
    expect(contentSaveCatch).toContain('handleUnknownOutcome()')
    expect(contentSaveCatch).not.toContain("delete contentDraftsRef.current[itemId]")
    expect(contentSaveCatch).not.toContain("setContentDraft('')")
  })

  it('only binds factual refresh reads to the existing user refresh entry', () => {
    expect(pageSource).toContain("<Text>刷新数据</Text>")
    expect(pageSource).toContain("onClick={() => { if (!busy && !restoring) void refresh()")
  })
})
