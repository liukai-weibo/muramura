import { Text, View } from '@tarojs/components'
import type { MouseEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { closeDesktopWindow, isDesktopWindowMaximized, isTauriDesktop, minimizeDesktopWindow, toggleDesktopMaximize } from './desktop-native-bridge'

interface DesktopTitleBarProps {
  breadcrumb: string
  onSearch: () => void
  onCapture: () => void
  searchContent?: ReactNode
  workbenchTabs?: Array<{ id: string; label: string; active: boolean; onClick: () => void }>
}

export function DesktopTitleBar({ breadcrumb, onSearch, onCapture, searchContent, workbenchTabs }: DesktopTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    if (!isTauriDesktop()) return
    void isDesktopWindowMaximized().then(setIsMaximized).catch((error: unknown) => console.error('读取窗口状态失败', error))
  }, [])
  if (!isTauriDesktop()) return null
  const invoke = (action: () => void | Promise<void>) => {
    void Promise.resolve(action()).catch((error: unknown) => console.error('桌面窗口操作失败', error))
  }
  const invokeFromMouseDown = (event: MouseEvent, action: () => void | Promise<void>) => {
    event.preventDefault()
    event.stopPropagation()
    invoke(action)
  }
  const toggleMaximize = async () => {
    await toggleDesktopMaximize()
    setIsMaximized((current) => !current)
  }
  return <View className='desktop-title-bar' data-tauri-drag-region>
    <View className='desktop-title-bar-leading'>
      <Text className='desktop-title-bar-breadcrumb'>{breadcrumb}</Text>
      {workbenchTabs && <View className='desktop-title-bar-tabs' role='tablist'>
        {workbenchTabs.map((tab) => <button type='button' key={tab.id} className={`desktop-title-bar-tab ${tab.active ? 'active' : ''}`} role='tab' aria-selected={tab.active} onClick={tab.onClick}>{tab.label}</button>)}
      </View>}
    </View>
    <View className='desktop-title-bar-center'>{searchContent ?? <button type='button' className='desktop-title-bar-search' onClick={onSearch}><Text>⌕</Text><Text>搜索事项...</Text><Text className='desktop-title-bar-search-shortcut'>Ctrl F</Text></button>}</View>
    <View className='desktop-title-bar-actions'>
      {searchContent ?? <button type='button' className='desktop-title-bar-search' onClick={onSearch}><Text>⌕</Text><Text>搜索事项、复盘或方法</Text><Text className='desktop-title-bar-search-shortcut'>Ctrl F</Text></button>}
      <button type='button' className='desktop-title-bar-capture' onClick={onCapture}>＋ 快速捕获</button>
      <View className='desktop-window-controls'>
        <button type='button' className='desktop-window-control' aria-label='最小化' onMouseDown={(event) => invokeFromMouseDown(event, minimizeDesktopWindow)}>−</button>
        <button type='button' className='desktop-window-control' aria-label={isMaximized ? '还原窗口' : '最大化窗口'} onMouseDown={(event) => invokeFromMouseDown(event, toggleMaximize)}>{isMaximized ? '❐' : '□'}</button>
        <button type='button' className='desktop-window-control desktop-window-control-close' aria-label='关闭并隐藏到托盘' onMouseDown={(event) => invokeFromMouseDown(event, closeDesktopWindow)}>×</button>
      </View>
    </View>
  </View>
}
