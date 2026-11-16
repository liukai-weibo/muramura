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
    expect(rule).toContain('min-height: 22px;')
    expect(rule).toContain('line-height: 1.4;')
  })

  it('keeps the shared auto-grow helper used by the row input', () => {
    expect(textView).toContain('element.style.height = \'auto\'')
    expect(textView).toContain('element.style.height = `${element.scrollHeight}px`')
  })
})
// Taro 的 rem 基准会把根字号设成 40px，行与时间标签包裹层若继承它，
// 空文本也会撑出 64px 的行盒——单行看起来就像两行高。
describe('note row inherits a sane font size', () => {
  it('resets the row font so the chip line box cannot stretch it', () => {
    const rowRule = theme.match(/^\.daily-note-row \{[^}]*\}/m)?.[0] ?? ''
    expect(rowRule).toContain('font-size: 14px;')
    expect(rowRule).toContain('line-height: 1.4;')
  })

  it('makes the chip wrapper a flex box with its own small type', () => {
    const wrapRule = theme.match(/^\.daily-note-time-chip-wrap \{[^}]*\}/m)?.[0] ?? ''
    expect(wrapRule).toContain('display: flex;')
    expect(wrapRule).toContain('font-size: 10px;')
    expect(wrapRule).toContain('line-height: 1;')
  })
})