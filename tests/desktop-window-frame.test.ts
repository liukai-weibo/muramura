import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
const appScss = readFileSync(new URL('../apps/client/src/app.scss', import.meta.url), 'utf8')
const indexScss = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const creamTheme = readFileSync(new URL('../apps/client/src/pages/index/cream-ui-theme.scss', import.meta.url), 'utf8')

const window = tauriConf.app.windows[0]

// 窗口外轮廓与内部界面必须共用同一层视觉语言：圆角由合成器抗锯齿裁形，
// 底色处处一致，避免圆角窗口里塞一个方角界面而出现硬切口或亮色缝。
describe('desktop window frame', () => {
  it('rounds the window with the DWM compositor instead of a hard region clip', () => {
    expect(cargoToml).toContain('Win32_Graphics_Dwm')
    expect(mainRs).toContain('DwmSetWindowAttribute')
    expect(mainRs).toContain('DWMWA_WINDOW_CORNER_PREFERENCE')
    expect(mainRs).toContain('DWMWCP_ROUND')
    // 区域裁剪只能留在 Win10 兜底函数里，不能再作为窗口的主路径。
    const dispatcher = mainRs.slice(mainRs.indexOf('fn apply_window_corners'))
    expect(dispatcher).toContain('dwm_round_window_corners')
    expect(dispatcher.indexOf('apply_window_region_hwnd')).toBeGreaterThan(dispatcher.indexOf('dwm_round_window_corners'))
  })

  it('keeps the compositor clip smooth when maximized and hides the hairline frame', () => {
    expect(mainRs).toContain('DWMWCP_DONOTROUND')
    expect(mainRs).toContain('DWMWA_BORDER_COLOR')
    expect(mainRs).toContain('DWMWA_COLOR_NONE')
  })

  it('falls back to a region clip small enough not to read as a stair-step arc', () => {
    expect(mainRs).toMatch(/FALLBACK_WINDOW_RADIUS: i32 = 10;/)
    expect(mainRs).not.toMatch(/let radius = 24;/)
  })

  it('paints one canvas colour across the window, the page and html/body', () => {
    const canvas = window.backgroundColor
    expect(canvas).toBe('#faf8f5')
    for (const match of appScss.matchAll(/background:\s*(#[0-9a-f]{6})/gi)) expect(match[1]).toBe(canvas)
    expect(indexScss).toContain(`.app-shell { background: ${canvas}; }`)
    expect(indexScss).toContain(`background: ${canvas};`)
    expect(indexScss).not.toContain('#f2eee7')
    expect(creamTheme).not.toContain('#f2eee7')
    expect(mainRs).toContain('(0, 0, 0, 0)')
  })

  it('paints a large CSS radius on a transparent window instead of the 8px system clip', () => {
    // Windows 只给 8px 系统圆角；要更大的圆角只能让窗口透明、由界面自绘。
    expect(window.transparent).toBe(true)
    expect(window.decorations).toBe(false)
    const appScss = readFileSync(new URL('../apps/client/src/app.scss', import.meta.url), 'utf8')
    expect(appScss).toContain('--window-radius: 18px;')
    expect(appScss).toContain("html[data-window='desktop'] .app-shell {")
  })

  it('keeps the system corner preference off so the CSS arc is not clipped', () => {
    expect(mainRs).toContain('let preference = DWMWCP_DONOTROUND;')
  })
})
