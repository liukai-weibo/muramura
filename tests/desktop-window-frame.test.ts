import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
const appScss = readFileSync(new URL('../apps/client/src/app.scss', import.meta.url), 'utf8')
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')

const window = tauriConf.app.windows[0]

// 窗口外观回到「系统区域裁剪 + 不透明窗口」这套稳定实现，不再做透明窗口自绘圆角。
describe('desktop window frame', () => {
  it('keeps the opaque window and the system region clip', () => {
    expect(window.transparent).toBe(false)
    expect(window.shadow).toBe(false)
    expect(window.decorations).toBe(false)
    expect(window.backgroundColor).toBe('#f2eee7')
    expect(mainRs).toContain('CreateRoundRectRgn')
    expect(mainRs).toContain('let radius = 24;')
  })

  it('does not depend on the DWM corner API any more', () => {
    expect(cargoToml).not.toContain('Win32_Graphics_Dwm')
    expect(mainRs).not.toContain('DwmSetWindowAttribute')
    expect(mainRs).not.toContain('DWMWA_WINDOW_CORNER_PREFERENCE')
  })

  it('renders no self-drawn window radius in the client', () => {
    expect(appScss).not.toContain('--window-radius')
    expect(appScss).not.toContain("html[data-window='desktop']")
  })
})
