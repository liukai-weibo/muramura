/**
 * 跨页面「今日手记变更」同步（同源多窗口 / 跨上下文回退）。
 *
 * 单一窗口内的 CustomEvent 无法通知同源的其他标签页、Tauri WebView 或局域网设备，
 * 这里统一包装四层通道：
 * - 本地 CustomEvent（同窗口即时刷新，兼容既有监听者）
 * - BroadcastChannel（同源不同标签页 / 窗口即时通知）
 * - localStorage + storage 事件（BroadcastChannel 不可用时的同源跨窗口回退）
 * - visibilitychange / focus（跨上下文场景：切回本窗口时主动刷新一次，
 *   覆盖 Tauri WebView 与局域网手机端等无法共享事件源的场景）
 */
const CHANNEL_NAME = 'marumaru.daily-note-sync'
const STORAGE_KEY = 'marumaru.daily-note-sync-at'
type DailyNoteChangeCallback = () => void

export function notifyDailyNoteChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('daily-note-content-changed'))
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(Date.now())
    channel.close()
  } catch { /* BroadcastChannel 不可用时走 storage 回退 */ }
  try {
    const value = String(Date.now())
    if (window.localStorage.getItem(STORAGE_KEY) !== value) {
      window.localStorage.setItem(STORAGE_KEY, value)
    }
  } catch { /* 受限存储（隐私模式等）下忽略 */ }
}

export function subscribeDailyNoteChanged(onChanged: DailyNoteChangeCallback): () => void {
  if (typeof window === 'undefined') return () => undefined
  activeSubscribers += 1
  ensureCrossOriginPolling()
  const handler = () => onChanged()
  window.addEventListener('daily-note-content-changed', handler)

  let channel: BroadcastChannel | undefined
  let lastHandled = 0
  const guard = () => {
    const now = Date.now()
    if (now - lastHandled < 30) return
    lastHandled = now
    onChanged()
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = guard
  } catch { /* BroadcastChannel 不可用时忽略 */ }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) guard()
  }
  window.addEventListener('storage', onStorage)

  const onVisible = () => {
    if (document.visibilityState === 'visible' || document.hasFocus()) guard()
  }
  window.addEventListener('focus', onVisible)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.removeEventListener('daily-note-content-changed', handler)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
    try { channel?.close() } catch { /* 忽略 */ }
    activeSubscribers = Math.max(0, activeSubscribers - 1)
    stopCrossOriginPollingIfIdle()
  }
}


/**
 * 跨源兜底轮询（低频率，仅在有订阅者且页面可见时运行）。
 * 局域网手机端（http://<局域网IP>:10086）与桌面端（127.0.0.1:10086 或 tauri://localhost）
 * 属不同源，BroadcastChannel / localStorage 无法互通；轮询把「今日手记内容变更」广播为
 * 本地 CustomEvent，由各订阅者按既有逻辑重新拉取。单一共享定时器，避免每个组件各自轮询。
 */
let activeSubscribers = 0
let pollTimer: ReturnType<typeof setInterval> | undefined
const POLL_INTERVAL_MS = 10_000

function ensureCrossOriginPolling(): void {
  if (pollTimer !== undefined || activeSubscribers <= 0 || typeof window === 'undefined') return
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      window.dispatchEvent(new CustomEvent('daily-note-content-changed'))
    }
  }, POLL_INTERVAL_MS)
}

function stopCrossOriginPollingIfIdle(): void {
  if (activeSubscribers <= 0 && pollTimer !== undefined) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}
