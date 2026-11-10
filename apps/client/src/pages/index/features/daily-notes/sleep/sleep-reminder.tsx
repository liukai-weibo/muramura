import { useCallback, useEffect, useRef, useState } from 'react'
import type { SleepEntry, SleepSettings } from '@knowledge-base/contracts'
import { addDays, dailyNoteClock, shouldPromptSleep } from '@knowledge-base/contracts'
import { apiClient } from '../../../api-client'
import { shanghaiDate } from '../daily-note-date'
import { SleepEntryModal } from './sleep-entry-modal'
import { notifySleepChanged } from './use-sleep'

const toMinuteOfDay = (now: Date): number => {
  const clock = dailyNoteClock(now.toISOString())
  return clock ? clock.hour * 60 + clock.minute : now.getHours() * 60 + now.getMinutes()
}

/**
 * 打开应用/网页时的起床提醒。
 *
 * 只催「今天几点起床」：晚上补记入睡的摩擦小，早上最容易忘。
 * 判定全部走 `shouldPromptSleep`，服务端 `lastPromptedDate` 保证换设备当天也不重复弹。
 */
export function SleepReminder() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<SleepSettings>()
  const [entry, setEntry] = useState<SleepEntry>()
  const [recent, setRecent] = useState<SleepEntry[]>([])
  const checking = useRef(false)
  const dismissed = useRef(false)

  const check = useCallback(async () => {
    if (checking.current || dismissed.current) return
    checking.current = true
    try {
      const today = shanghaiDate()
      const current = await apiClient.readSleepSettings()
      setSettings(current)
      if (!current.remindEnabled || current.lastPromptedDate === today) return
      const nowMinute = toMinuteOfDay(new Date())
      if (!shouldPromptSleep({ nowMinute, today, entry: undefined, settings: current })) return
      const [todayEntries, recentEntries] = await Promise.all([
        apiClient.listSleepEntries({ from: today, to: today }),
        apiClient.listSleepEntries({ from: addDays(today, -1), to: today }),
      ])
      const todayEntry = todayEntries.find(item => item.sleepDate === today)
      if (!shouldPromptSleep({ nowMinute, today, entry: todayEntry, settings: current })) return
      setEntry(todayEntry)
      setRecent(recentEntries)
      setOpen(true)
    } catch {
      // 提醒是锦上添花，读不到就安静跳过。
    } finally {
      checking.current = false
    }
  }, [])

  useEffect(() => { void check() }, [check])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [check])

  if (!open || !settings) return null

  const today = shanghaiDate()
  return <SleepEntryModal
    initialDate={today}
    {...(entry ? { entry } : {})}
    entries={recent}
    precision={settings.inputPrecision}
    mode='wake'
    onClose={() => {
      setOpen(false)
      dismissed.current = true
      // 关闭也算「今天不再提醒」，避免每次切页都弹。
      void apiClient.acknowledgeSleepReminder(today).catch(() => undefined)
    }}
    onSave={async (sleepDate, patch) => {
      await apiClient.saveSleepEntry(sleepDate, patch)
      await apiClient.acknowledgeSleepReminder(today).catch(() => undefined)
      dismissed.current = true
      notifySleepChanged()
    }}
  />
}
