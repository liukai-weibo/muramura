import { invoke } from '@tauri-apps/api/core'

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function minimizeDesktopWindow(): Promise<void> {
  await invoke('minimize_window')
}

export async function toggleDesktopMaximize(): Promise<void> {
  await invoke('toggle_maximize_window')
}

export async function isDesktopWindowMaximized(): Promise<boolean> {
  return invoke<boolean>('is_maximized_window')
}

export async function closeDesktopWindow(): Promise<void> {
  await invoke('close_window')
}

export function installDesktopShortcuts(handlers: {
  onNew: () => void
  onSearch: () => void
  onEscape: () => void
}): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      handlers.onEscape()
      return
    }
    if (!event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault()
      handlers.onNew()
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      handlers.onSearch()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
