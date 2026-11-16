import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(new URL('../apps/client/src/pages/index/cream-ui-theme.scss', import.meta.url), 'utf8')
const pageStyles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')
const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')

// 登录页不在 .app-shell 内，--cream-line 没有定义；缺省值的 !important 会让边框回退成
// currentColor，在浅色卡片里读成一个深色方框。
describe('login input surface', () => {
  it('never resolves the global input border to currentColor outside the app shell', () => {
    expect(theme).not.toMatch(/border-color:\s*var\(--cream-line\)\s*!important/)
    expect(theme).toContain('border-color: var(--cream-line, #eae6e0) !important;')
  })

  it('gives the login fields their own rounded surface instead of the Taro default', () => {
    expect(page).toContain("<Input className='auth-input'")
    expect(pageStyles).toContain('.auth-field .auth-input {')
    expect(pageStyles).toMatch(/\.auth-field \.auth-input \{[^}]*border-radius: 14px;/)
    expect(pageStyles).toMatch(/\.auth-field \.auth-input \.weui-input \{[^}]*border: 0;/)
  })

  it('keeps the login mode switch consistent with the rounded card', () => {
    expect(pageStyles).toMatch(/\.auth-mode-switch \{[^}]*border-radius: 999px;/)
  })
})
