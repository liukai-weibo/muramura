import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appStyles = readFileSync(new URL('../apps/client/src/app.scss', import.meta.url), 'utf8')
const moodStyles = readFileSync(new URL('../apps/client/src/pages/index/features/mood/mood-page.scss', import.meta.url), 'utf8')

// Taro 的 <Textarea> 内层是原生 textarea.taro-textarea，浏览器给它的默认字体是等宽字体，
// 不会继承页面字体；样式只设字号就会让弹窗读起来像另一个系统。
describe('event record typography', () => {
  it('makes native input surfaces inherit the page font', () => {
    const rule = appStyles.match(/\.weui-input,\s*\.taro-textarea \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('font-family: inherit;')
    expect(rule).toContain('font-size: inherit;')
  })

  it('sets the record modal textarea font on the inner Taro node', () => {
    expect(moodStyles).toContain('.mood-field-textarea .taro-textarea {')
    const rule = moodStyles.match(/\.mood-field-textarea \.taro-textarea \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('font-family:')
    expect(rule).toContain('font-size: 13px;')
  })

  it('keeps placeholders in the cream hint colour', () => {
    expect(moodStyles).toMatch(/\.mood-field-textarea \.taro-textarea::placeholder \{[^}]*color: var\(--cream-hint\);/)
  })
})
