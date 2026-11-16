import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
const appScss = readFileSync(new URL('../apps/client/src/app.scss', import.meta.url), 'utf8')
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')

const window = tauriConf.app.windows[0]

// 窗口圆角交给系统合成器裁形：抗锯齿、带投影、最大化自动直角。
// 区域裁剪（SetWindowRgn）不做抗锯齿，只保留给不支持该属性的旧系统。
describe('desktop window frame', () => {
  it('rounds the window through the compositor instead of a hard region clip', () => {
    expect(window.transparent).toBe(false)
    expect(window.decorations).toBe(false)
    expect(window.shadow).toBe(true)
    expect(window.backgroundColor).toBe('#faf8f5')
    expect(cargoToml).toContain('Win32_Graphics_Dwm')
    expect(mainRs).toContain('DWMWA_WINDOW_CORNER_PREFERENCE')
    expect(mainRs).toContain('let preference = if maximized { DWMWCP_DONOTROUND } else { DWMWCP_ROUND };')
  })

  it('keeps the region clip only as the fallback for older systems', () => {
    const dispatcher = mainRs.slice(mainRs.indexOf('fn apply_window_corners'))
    expect(dispatcher).toContain('dwm_round_window_corners')
    expect(dispatcher.indexOf('apply_window_region_hwnd')).toBeGreaterThan(dispatcher.indexOf('dwm_round_window_corners'))
  })

  it('does not paint a self-drawn window radius', () => {
    expect(appScss).not.toContain('--window-radius')
    expect(appScss).not.toContain("html[data-window='desktop']")
  })
})
