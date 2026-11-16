import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(new URL('../apps/client/src/pages/index/cream-ui-theme.scss', import.meta.url), 'utf8')
const textView = readFileSync(new URL('../apps/client/src/pages/index/features/daily-notes/entry-text-view.tsx', import.meta.url), 'utf8')

// 自动高度用的是 `height = scrollHeight`。scrollHeight 已经包含上下 padding，
// 如果是 content-box，写回去的 height 会再加一次 padding，单行就多出一行的空白。
describe('daily note row auto height', () => {
  it('sizes the row input with border-box so one line stays one line', () => {
    const rule = theme.match(/^\.daily-note-row-input \{[^}]*\}/m)?.[0] ?? ''
    expect(rule).toContain('box-sizing: border-box;')
    expect(rule).toContain('min-height: 24px;')
    expect(rule).toContain('line-height: 1.45;')
  })

  it('keeps the shared auto-grow helper used by the row input', () => {
    expect(textView).toContain('element.style.height = \'auto\'')
    expect(textView).toContain('element.style.height = `${element.scrollHeight}px`')
  })
})
