import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { checkDesktopUpdate, installDesktopUpdate } from './desktop-native-bridge'

interface UpdateCheckModalProps {
  onClose: () => void
}

type UpdatePhase = 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error'

export function UpdateCheckModal({ onClose }: UpdateCheckModalProps) {
  const [phase, setPhase] = useState<UpdatePhase>('checking')
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestVersion, setLatestVersion] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [received, setReceived] = useState(0)
  const [total, setTotal] = useState(0)
  const installing = useRef(false)

  const fmtBytes = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB')

  const runCheck = async () => {
    setPhase('checking')
    setErrorMessage('')
    try {
      const info = await checkDesktopUpdate()
      if (!info) {
        setErrorMessage('当前环境不支持检查更新，请在桌面端使用。')
        setPhase('error')
        return
      }
      setCurrentVersion(info.currentVersion)
      setLatestVersion(info.latestVersion)
      setPhase(info.available ? 'available' : 'latest')
    } catch {
      setErrorMessage('无法获取最新版本，请检查网络后重试。')
      setPhase('error')
    }
  }

  useEffect(() => { void runCheck() }, [])

  const startInstall = async () => {
    if (installing.current || phase !== 'available') return
    installing.current = true
    setPhase('downloading')
    setProgress(0)
    try {
      await installDesktopUpdate((p) => {
      setReceived(p.received)
      setTotal(p.total)
      setProgress(Math.round(p.percent))
    })
      setPhase('installing')
    } catch {
      installing.current = false
      setErrorMessage('下载或安装失败，请稍后重试。')
      setPhase('error')
    }
  }

  const canClose = phase !== 'downloading' && phase !== 'installing'

  return (
    <View className='update-check-dialog-backdrop' role='dialog' aria-modal='true' aria-label='检查更新' onClick={(event) => { if (event.target === event.currentTarget && canClose) onClose() }}>
      <View className='update-check-dialog'>
        <View className='update-check-dialog-head'>
          <Text className='update-check-dialog-title'>检查更新</Text>
          {canClose && <View className='update-check-dialog-close' onClick={onClose}><Text>✕</Text></View>}
        </View>

        {phase === 'checking' && (<View className='update-check-line'><Text className='update-check-muted'>正在检查最新版本…</Text></View>)}

        {phase === 'latest' && (
          <>
            <Text className='update-check-current'>当前版本 v{currentVersion}</Text>
            <View className='update-check-line'><Text className='update-check-ok'>✓ 已是最新版本</Text></View>
          </>
        )}

        {phase === 'available' && (
          <>
            <Text className='update-check-current'>当前版本 v{currentVersion}</Text>
            <Text className='update-check-line'>→ 最新版本 v{latestVersion}</Text>
            <Button className='action-button primary update-check-action' onClick={() => void startInstall()}>更新至最新版本</Button>
          </>
        )}

        {phase === 'downloading' && (
          <>
            <Text className='update-check-line'>正在下载 v{latestVersion} …</Text>
            <View className='update-check-progress-track'>
              <View className='update-check-progress-fill' style={{ width: progress + '%' }} />
            </View>
            <Text className='update-check-muted'>{progress}%{total > 0 ? '  ·  ' + fmtBytes(received) + ' / ' + fmtBytes(total) : ''}</Text>
          </>
        )}

        {phase === 'installing' && (<View className='update-check-line'><Text className='update-check-muted'>下载完成，正在安装并重启，请稍候…</Text></View>)}

        {phase === 'error' && (
          <>
            <Text className='update-check-error'>{errorMessage}</Text>
            <View className='update-check-actions'>
              <Button className='action-button secondary' onClick={onClose}>关闭</Button>
              <Button className='action-button primary' onClick={() => void runCheck()}>重试</Button>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
