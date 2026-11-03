import { useCallback, useEffect, useRef, useState } from 'react'
import type { DailyNote, DailyNoteEntry, DailyNoteTimePrecision } from '@knowledge-base/contracts'
import { dailyNoteAtMinute, dailyNoteClock, dailyNoteSortEntries } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { DAILY_NOTE_PAGE_ORIGIN, notifyDailyNoteChanged } from '../../daily-note-sync'
import { isShanghaiToday, shanghaiDate } from './daily-note-date'

/** 文本视图里的一行。key 是渲染与保存的稳定标识，entryId 为空表示这一行还没落库。 */
export interface NoteRow {
  key: string
  entryId?: string
  /** 这一行归属的东八区日期；点时间标签改成别的日期时它会离开当前篇。 */
  date: string
  time: string
  precision: DailyNoteTimePrecision
  content: string
}

export type DailyNoteSaveState = 'idle' | 'saving' | 'error'

const autosaveDelay = 1200
const newRowKey = () => `row-${Math.random().toString(36).slice(2, 10)}`
const nowLabel = () => dailyNoteClock(new Date().toISOString())?.label ?? '00:00'
const clockOf = (entry: DailyNoteEntry): string => dailyNoteClock(entry.recordedAt)?.label ?? '00:00'
const minutesOf = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number)
  return (hour ?? 0) * 60 + (minute ?? 0)
}
const toRow = (entry: DailyNoteEntry): NoteRow => ({
  key: entry.id, entryId: entry.id, date: entry.entryDate, time: clockOf(entry), precision: entry.timePrecision, content: entry.content,
})
const emptyDraftRow = (date: string): NoteRow => ({ key: newRowKey(), date, time: nowLabel(), precision: 'minute', content: '' })

interface SavedSnapshot { content: string; date: string; time: string }

/**
 * 手记条目的读写与自动保存。
 *
 * 行的顺序是本地状态，保存成功后不重排：连续打字时行不会跳位，
 * 只有切换日期或显式重载才按服务端顺序重建。
 * 同一行的保存串成一条链，避免两次请求乱序把较新的内容覆盖成旧的。
 */
export function useDailyNoteEntries() {
  const [notes, setNotes] = useState<DailyNote[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [entries, setEntries] = useState<DailyNoteEntry[]>([])
  const [rows, setRows] = useState<NoteRow[]>([])
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())
  const [saveState, setSaveState] = useState<DailyNoteSaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const current = notes.find(note => note.id === selectedId)
  const noteDate = current?.entryDate ?? shanghaiDate()
  const dirty = dirtyKeys.size > 0

  const noteRef = useRef<DailyNote>()
  const notesRef = useRef<DailyNote[]>([])
  const selectedIdRef = useRef<string>()
  const rowsRef = useRef<NoteRow[]>([])
  const entriesRef = useRef<DailyNoteEntry[]>([])
  const savedRef = useRef(new Map<string, SavedSnapshot>())
  const timersRef = useRef(new Map<string, number>())
  const chainsRef = useRef(new Map<string, Promise<void>>())
  const inflightRef = useRef(0)
  const latestLoadRef = useRef<string>()
  const saveErrorRef = useRef('')
  const initialisedRef = useRef(false)

  useEffect(() => { noteRef.current = current }, [current])
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => { saveErrorRef.current = saveError }, [saveError])

  const markDirty = (key: string) => setDirtyKeys(set => { const next = new Set(set); next.add(key); return next })
  const markClean = (key: string) => setDirtyKeys(set => { if (!set.has(key)) return set; const next = new Set(set); next.delete(key); return next })
  const resetDirty = () => setDirtyKeys(new Set())
  const updateRow = useCallback((key: string, patch: (row: NoteRow) => NoteRow) => {
    setRows(list => list.map(row => row.key === key ? patch(row) : row))
  }, [])

  const beginSave = () => { inflightRef.current += 1; setSaveState('saving') }
  const endSave = (failed: boolean) => {
    inflightRef.current = Math.max(0, inflightRef.current - 1)
    if (failed) { setSaveState('error'); return }
    if (inflightRef.current === 0) { setSaveState('idle'); setSaveError('') }
  }

  /** 用服务端合成的正文回填侧栏预览；只接受最后一次加载，避免快速切日期时旧响应覆盖新选择。 */
  const reloadEntries = useCallback(async (id: string) => {
    latestLoadRef.current = id
    const detail = await apiClient.getDailyNoteWithEntries(id)
    setNotes(list => list.map(note => note.id === detail.id ? { ...note, content: detail.content, updatedAt: detail.updatedAt } : note))
    if (latestLoadRef.current === id) setEntries(dailyNoteSortEntries(detail.entries))
    return detail
  }, [])

  /** 结构变化（新增／删除／跨天搬移）后刷新侧栏，预览与分组才会跟着变。 */
  const refreshList = useCallback(async () => {
    const all = await apiClient.listDailyNotes()
    setNotes(list => {
      const today = list.find(note => isShanghaiToday(note.entryDate))
      return today && !all.some(note => note.id === today.id) ? [today, ...all] : all
    })
  }, [])

  /** 切换日期：整篇重建行，并记下每条已保存的样子，供自动保存判断是否真的变了。 */
  const loadNote = useCallback(async (id: string) => {
    const detail = await apiClient.getDailyNoteWithEntries(id)
    latestLoadRef.current = id
    const ordered = dailyNoteSortEntries(detail.entries)
    savedRef.current = new Map(ordered.map(entry => [entry.id, { content: entry.content, date: entry.entryDate, time: clockOf(entry) }]))
    setEntries(ordered)
    resetDirty()
    // 今天且一条都没有时给一行空白草稿，打开就能写；过去的日期不塞空行，用「添加一条」。
    setRows(ordered.length === 0 && isShanghaiToday(detail.entryDate) ? [emptyDraftRow(detail.entryDate)] : ordered.map(toRow))
    setNotes(list => list.map(note => note.id === detail.id ? { ...note, content: detail.content, updatedAt: detail.updatedAt } : note))
    return detail
  }, [])

  /** 保存一行：没有 entryId 就新建，有就更新；日期变了则跨天搬移。 */
  const saveRow = useCallback(async (key: string) => {
    const note = noteRef.current
    const row = rowsRef.current.find(item => item.key === key)
    if (!note || !row) return
    const content = row.content
    const saved = savedRef.current.get(key)
    if (!saved && !content.trim()) { markClean(key); return }
    if (saved && saved.content === content && saved.date === row.date && saved.time === row.time) { markClean(key); return }

    beginSave()
    let failed = false
    try {
      if (!row.entryId) {
        if (row.date !== note.entryDate) {
          // 新行被指到别的日期：先取建目标日的手记，再写进那一天。
          const target = await apiClient.getOrCreateDailyNoteByDate(row.date)
          await apiClient.createDailyNoteEntry(target.id, content, row.time)
          setRows(list => list.filter(item => item.key !== key))
          setNotice(`已记到 ${row.date}`)
          await refreshList()
        } else {
          const created = await apiClient.createDailyNoteEntry(note.id, content, row.time)
          savedRef.current.set(key, { content, date: row.date, time: row.time })
          updateRow(key, current => ({ ...current, entryId: created.id, precision: created.timePrecision }))
          await reloadEntries(note.id)
          await refreshList()
        }
        markClean(key)
        notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
        return
      }

      // 内容被清空＝用户删掉了这一行（与旧版「空内容不落库」一致），按删除处理。
      if (!content.trim()) {
        await apiClient.deleteDailyNoteEntry(note.id, row.entryId)
        savedRef.current.delete(key)
        setRows(list => list.filter(item => item.key !== key))
        markClean(key)
        await reloadEntries(note.id)
        await refreshList()
        notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
        return
      }

      const timeInput = row.date === note.entryDate ? row.time : dailyNoteAtMinute(row.date, minutesOf(row.time))
      const updated = await apiClient.updateDailyNoteEntry(note.id, row.entryId, content, timeInput)
      savedRef.current.set(key, { content, date: row.date, time: row.time })
      markClean(key)
      if (updated.entryDate !== note.entryDate) {
        // 搬到别的日期了：这一行离开当前篇，提示一下再刷新两天。
        setRows(list => list.filter(item => item.key !== key))
        savedRef.current.delete(key)
        setNotice(`已移到 ${updated.entryDate}`)
        await reloadEntries(note.id)
        await refreshList()
      } else {
        updateRow(key, current => ({ ...current, precision: updated.timePrecision }))
        await reloadEntries(note.id)
      }
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
    } catch {
      failed = true
      setSaveError('保存失败，内容仍保留在这一行')
    } finally {
      endSave(failed)
    }
  }, [refreshList, reloadEntries, updateRow])

  /** 同一行串行保存，避免旧请求后到把新内容覆盖掉。 */
  const enqueue = useCallback((key: string) => {
    const previous = chainsRef.current.get(key) ?? Promise.resolve()
    const next = previous.then(() => saveRow(key)).catch(() => undefined)
    chainsRef.current.set(key, next)
    return next
  }, [saveRow])

  const scheduleSave = useCallback((key: string) => {
    const existing = timersRef.current.get(key)
    if (existing !== undefined) window.clearTimeout(existing)
    timersRef.current.set(key, window.setTimeout(() => {
      timersRef.current.delete(key)
      void enqueue(key)
    }, autosaveDelay))
  }, [enqueue])

  /** 立即保存某一行（失焦、切视图、切日期时用）。 */
  const flushRow = useCallback(async (key: string) => {
    const timer = timersRef.current.get(key)
    if (timer !== undefined) { window.clearTimeout(timer); timersRef.current.delete(key) }
    if (!rowsRef.current.some(row => row.key === key)) return
    await enqueue(key)
  }, [enqueue])

  /** 写完所有待保存的行；返回是否没有失败。 */
  const flush = useCallback(async () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
    const keys = rowsRef.current.map(row => row.key)
    const chains = keys.map(key => enqueue(key))
    await Promise.all(chains)
    // 从没写过字的空行不需要留在界面上。
    setRows(list => list.filter(row => row.entryId || row.content.trim()))
    return saveErrorRef.current === ''
  }, [enqueue])

  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  // 卸载时才把没保存的写回，避免直接关窗口丢字。
  useEffect(() => () => { void flushRef.current() }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [today, all] = await Promise.all([apiClient.getTodayDailyNote(), apiClient.listDailyNotes()])
      const merged = all.some(note => note.id === today.id) ? all : [today, ...all]
      setNotes(merged)
      notesRef.current = merged
      const keep = selectedIdRef.current && merged.some(note => note.id === selectedIdRef.current)
      const targetId = keep ? selectedIdRef.current! : today.id
      setSelectedId(targetId)
      selectedIdRef.current = targetId
      noteRef.current = merged.find(note => note.id === targetId)
      await loadNote(targetId)
    } catch {
      setSaveError('暂时无法读取手记，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }, [loadNote])

  useEffect(() => {
    if (initialisedRef.current) return
    initialisedRef.current = true
    void refresh()
  }, [refresh])

  const selectNote = useCallback(async (id: string) => {
    if (id === selectedIdRef.current) return true
    if (!(await flush())) return false
    setNotice('')
    const note = notesRef.current.find(item => item.id === id)
    if (!note) return false
    setSelectedId(id)
    selectedIdRef.current = id
    noteRef.current = note
    await loadNote(id)
    return true
  }, [flush, loadNote])

  const openToday = useCallback(async () => {
    if (!(await flush())) return false
    const today = await apiClient.getTodayDailyNote()
    const merged = [today, ...notesRef.current.filter(note => note.id !== today.id)]
    setNotes(merged)
    notesRef.current = merged
    setNotice('')
    setSelectedId(today.id)
    selectedIdRef.current = today.id
    noteRef.current = today
    await loadNote(today.id)
    return true
  }, [flush, loadNote])

  /** 打开任意一天：没有手记的日子会被创建出来（未来的日期由后端拒绝）。 */
  const openByDate = useCallback(async (date: string) => {
    if (!date) return false
    if (!(await flush())) return false
    try {
      const note = await apiClient.getOrCreateDailyNoteByDate(date)
      const known = notesRef.current.some(item => item.id === note.id)
      const merged = known
        ? notesRef.current.map(item => item.id === note.id ? note : item)
        : [note, ...notesRef.current].sort((left, right) => right.entryDate.localeCompare(left.entryDate))
      setNotes(merged)
      notesRef.current = merged
      setNotice('')
      setSelectedId(note.id)
      selectedIdRef.current = note.id
      noteRef.current = note
      await loadNote(note.id)
      return true
    } catch {
      setSaveError('无法为这一天创建手记：日期不能在未来')
      return false
    }
  }, [flush, loadNote])

  const setRowContent = useCallback((key: string, content: string) => {
    updateRow(key, row => ({ ...row, content }))
    markDirty(key)
    scheduleSave(key)
  }, [scheduleSave, updateRow])

  const setRowTime = useCallback((key: string, date: string, time: string) => {
    updateRow(key, row => ({ ...row, date, time, precision: 'minute' }))
    markDirty(key)
    scheduleSave(key)
  }, [scheduleSave, updateRow])

  /** 在指定行之后插入一行（回车拆行）；不给时间就沿用上一行的时间，不发明时刻。 */
  const insertRowAfter = useCallback((key: string | undefined, overrides: Partial<Pick<NoteRow, 'time' | 'date' | 'content'>> = {}) => {
    const note = noteRef.current
    if (!note) return undefined
    const list = rowsRef.current
    const index = key === undefined ? list.length - 1 : list.findIndex(row => row.key === key)
    const anchor = index >= 0 ? list[index] : undefined
    const created: NoteRow = {
      key: newRowKey(),
      date: overrides.date ?? anchor?.date ?? note.entryDate,
      time: overrides.time ?? anchor?.time ?? nowLabel(),
      precision: 'minute',
      content: overrides.content ?? '',
    }
    setRows(current => {
      const at = index < 0 ? current.length : current.findIndex(row => row.key === key)
      const insertAt = at < 0 ? current.length : at + 1
      return [...current.slice(0, insertAt), created, ...current.slice(insertAt)]
    })
    return created.key
  }, [])

  const removeRow = useCallback(async (key: string) => {
    const row = rowsRef.current.find(item => item.key === key)
    if (!row) return
    const timer = timersRef.current.get(key)
    if (timer !== undefined) { window.clearTimeout(timer); timersRef.current.delete(key) }
    const note = noteRef.current
    markClean(key)
    if (!row.entryId || !note) {
      setRows(list => list.filter(item => item.key !== key))
      return
    }
    beginSave()
    let failed = false
    try {
      await apiClient.deleteDailyNoteEntry(note.id, row.entryId)
      savedRef.current.delete(key)
      setRows(list => list.filter(item => item.key !== key))
      await reloadEntries(note.id)
      await refreshList()
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
    } catch {
      failed = true
      setSaveError('删除失败，请稍后重试')
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  /** 时间轴/时间标签补录：以给定时刻新建一条。 */
  const createEntryAt = useCallback(async (date: string, time: string, content: string) => {
    const note = noteRef.current
    if (!note || !content.trim()) return false
    beginSave()
    let failed = false
    try {
      const timeInput = date === note.entryDate ? time : dailyNoteAtMinute(date, minutesOf(time))
      await apiClient.createDailyNoteEntry(note.id, content, timeInput)
      await reloadEntries(note.id)
      await refreshList()
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
      return true
    } catch {
      failed = true
      setSaveError('补录失败，请稍后重试')
      return false
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  /** 改某条的时间，可能跨天搬移。 */
  const moveEntry = useCallback(async (entryId: string, date: string, time: string) => {
    const note = noteRef.current
    const entry = entriesRef.current.find(item => item.id === entryId)
    if (!note || !entry) return false
    beginSave()
    let failed = false
    try {
      const timeInput = date === note.entryDate ? time : dailyNoteAtMinute(date, minutesOf(time))
      const updated = await apiClient.updateDailyNoteEntry(note.id, entryId, entry.content, timeInput)
      if (updated.entryDate !== note.entryDate) {
        setNotice(`已移到 ${updated.entryDate}`)
        await refreshList()
      }
      await reloadEntries(note.id)
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
      return true
    } catch {
      failed = true
      setSaveError('改时间失败，请稍后重试')
      return false
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  const clearAll = useCallback(async () => {
    const note = noteRef.current
    if (!note) return false
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
    beginSave()
    let failed = false
    try {
      await apiClient.clearDailyNoteEntries(note.id)
      savedRef.current.clear()
      resetDirty()
      setRows([])
      await reloadEntries(note.id)
      await refreshList()
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
      return true
    } catch {
      failed = true
      setSaveError('清空失败，请稍后重试')
      return false
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  /** AI 结果追加到当天（以当前时刻记一条）。 */
  const appendContent = useCallback(async (content: string) => {
    const note = noteRef.current
    if (!note) return false
    beginSave()
    let failed = false
    try {
      await apiClient.createDailyNoteEntry(note.id, content)
      await reloadEntries(note.id)
      await refreshList()
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
      return true
    } catch {
      failed = true
      setSaveError('写入失败，请稍后重试')
      return false
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  const replaceContent = useCallback(async (content: string) => {
    const note = noteRef.current
    if (!note) return false
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
    beginSave()
    let failed = false
    try {
      await apiClient.clearDailyNoteEntries(note.id)
      await apiClient.createDailyNoteEntry(note.id, content)
      savedRef.current.clear()
      resetDirty()
      setRows([])
      await reloadEntries(note.id)
      await refreshList()
      notifyDailyNoteChanged(DAILY_NOTE_PAGE_ORIGIN)
      return true
    } catch {
      failed = true
      setSaveError('替换失败，请稍后重试')
      return false
    } finally { endSave(failed) }
  }, [refreshList, reloadEntries])

  return {
    notes, current, selectedId, noteDate, entries, rows, loading, saveState, saveError, notice, dirty,
    setNotice, refresh, selectNote, openByDate, openToday, reloadNote: loadNote, refreshList, reloadEntries,
    setRowContent, setRowTime, insertRowAfter, removeRow, flushRow, flush,
    createEntryAt, moveEntry, clearAll, appendContent, replaceContent,
  }
}

export type DailyNoteEntriesController = ReturnType<typeof useDailyNoteEntries>
