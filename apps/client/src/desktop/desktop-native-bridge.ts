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

export async function exitDesktopApplication(): Promise<void> {
  await invoke('exit_app')
}

export async function readDesktopSessionToken(): Promise<string | undefined> {
  if (!isTauriDesktop()) return undefined
  const token = await invoke<string | null>('read_desktop_session_token')
  return typeof token === 'string' && token.trim() ? token : undefined
}

export async function saveDesktopSessionToken(token: string): Promise<void> {
  if (!isTauriDesktop()) return
  await invoke('save_desktop_session_token', { token })
}

export async function clearDesktopSessionToken(): Promise<void> {
  if (!isTauriDesktop()) return
  await invoke('clear_desktop_session_token')
}

export async function saveRememberedLoginPassword(username: string, password: string): Promise<void> {
  if (!isTauriDesktop()) return
  await invoke('save_desktop_login_password', { username, password })
}

export async function readRememberedLoginPassword(username: string): Promise<string | undefined> {
  if (!isTauriDesktop()) return undefined
  const value = await invoke<string | null>('read_desktop_login_password', { username })
  return typeof value === 'string' && value.trim() ? value : undefined
}

export async function clearRememberedLoginPassword(username: string): Promise<void> {
  if (!isTauriDesktop()) return
  await invoke('clear_desktop_login_password', { username })
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
export interface DesktopUpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
}

export interface DesktopUpdateProgress {
  received: number
  total: number
  percent: number
}

export async function getDesktopAppVersion(): Promise<string | undefined> {
  if (!isTauriDesktop()) return undefined
  const version = await invoke<string>('desktop_app_version')
  return typeof version === 'string' && version.trim() ? version.trim() : undefined
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateInfo | undefined> {
  if (!isTauriDesktop()) return undefined
  const update = await checkTauriUpdater()
  const currentVersion = (await getDesktopAppVersion()) ?? '未知'
  if (!update) return { available: false, currentVersion, latestVersion: currentVersion }
  return { available: true, currentVersion, latestVersion: update.version }
}

export async function installDesktopUpdate(onProgress: (progress: DesktopUpdateProgress) => void): Promise<void> {
  const update = await checkTauriUpdater()
  if (!update) return
  let total = 0
  let received = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength || 0
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength || 0
      onProgress({ received, total, percent: total > 0 ? Math.min(100, (received / total) * 100) : 0 })
    }
  })
}

async function checkTauriUpdater() {
  const { check } = await import('@tauri-apps/plugin-updater')
  return check()
}
