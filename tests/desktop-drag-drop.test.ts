import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const devConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.dev.conf.json', import.meta.url), 'utf8'))

describe('desktop HTML5 task drag and drop', () => {
  it('disables the native WebView2 drop handler so frontend drag/drop can receive events', () => {
    expect(config.app.windows.length).toBeGreaterThan(0)
    for (const window of config.app.windows) expect(window.dragDropEnabled).toBe(false)
  })

  it('does not re-enable native drag/drop in the development override', () => {
    for (const window of devConfig.app?.windows ?? []) expect(window.dragDropEnabled).toBe(false)
  })
})
