export type DisplayEffectMode = 'glass' | 'compatible'
export type ColorTheme = 'light' | 'dark'

const storageKey = 'marumaru.display-effect'
const colorThemeStorageKey = 'marumaru.color-theme'
const quickNoteFabVisibleStorageKey = 'marumaru.quick-note-fab-visible'

function getStorage(): Storage | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readDisplayEffectMode(): DisplayEffectMode {
  try {
    return getStorage()?.getItem(storageKey) === 'compatible' ? 'compatible' : 'glass'
  } catch {
    return 'glass'
  }
}

export function saveDisplayEffectMode(mode: DisplayEffectMode) {
  try {
    getStorage()?.setItem(storageKey, mode)
  } catch {
    // Display preferences must never prevent the workspace from rendering.
  }
}

export function readColorTheme(): ColorTheme {
  try {
    return getStorage()?.getItem(colorThemeStorageKey) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function saveColorTheme(theme: ColorTheme) {
  try {
    getStorage()?.setItem(colorThemeStorageKey, theme)
  } catch {
    // Theme preferences must never prevent the workspace from rendering.
  }
}

export function readQuickNoteFabVisible(): boolean {
  try {
    return getStorage()?.getItem(quickNoteFabVisibleStorageKey) !== 'false'
  } catch {
    return true
  }
}

export function saveQuickNoteFabVisible(visible: boolean) {
  try {
    getStorage()?.setItem(quickNoteFabVisibleStorageKey, String(visible))
  } catch {
    // Display preferences must never prevent the workspace from rendering.
  }
}
