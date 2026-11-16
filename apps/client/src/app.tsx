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
    const sync = () => {
      void isDesktopWindowMaximized()
        .then(maximized => { if (!cancelled) root.dataset.windowMaximized = maximized ? 'true' : 'false' })
        .catch(() => undefined)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      cancelled = true
      window.removeEventListener('resize', sync)
    }
  }, [])
  return children
}
