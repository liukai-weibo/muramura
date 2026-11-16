import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import '@nutui/nutui-react-taro/dist/style.css'
import './app.scss'
import { isDesktopWindowMaximized, isTauriDesktop } from './desktop/desktop-native-bridge'

/**
 * 桌面端把窗口做成透明，圆角由 CSS 自绘（系统圆角只有 8px，想要大圆角只能自己画）。
 * 浏览器里不设置这些标记，网页仍保持不透明背景。
 */
export default function App({ children }: PropsWithChildren) {
  useEffect(() => {
    if (!isTauriDesktop() || typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.window = 'desktop'
    let cancelled = false
    let settleTimer: number | undefined
    const sync = () => {
      void isDesktopWindowMaximized()
        .then(maximized => { if (!cancelled) root.dataset.windowMaximized = maximized ? 'true' : 'false' })
        .catch(() => undefined)
    }
    // 拖拽改尺寸时最大化状态是异步更新的：立刻查一次，再等一拍复查，
    // 否则「拖成最大化 → 还原」会残留方角。
    const scheduleSync = () => {
      sync()
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(sync, 160)
    }
    scheduleSync()
    window.addEventListener('resize', scheduleSync)
    window.addEventListener('focus', scheduleSync)
    document.addEventListener('visibilitychange', scheduleSync)
    return () => {
      cancelled = true
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
      window.removeEventListener('resize', scheduleSync)
      window.removeEventListener('focus', scheduleSync)
      document.removeEventListener('visibilitychange', scheduleSync)
    }
  }, [])
  return children
}
