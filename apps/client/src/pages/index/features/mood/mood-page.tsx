import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import type { MoodEntry, MoodEntryInput, MoodLevel } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import type { ColorTheme } from '../../display-effect-preference'
import { MoodCalendar, type MoodCalendarMode } from './mood-calendar'
import { MoodCard } from './mood-card'
import { MoodRecordModal } from './mood-record-modal'
import { MoodDetailModal } from './mood-detail-modal'
import { formatLocalDate, moodLevelLabels, todayLocalDate } from './mood-levels'
import './mood-page.scss'

type ModalState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; entry: MoodEntry }
  | { kind: 'detail'; entry: MoodEntry }

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

const filterOptions: Array<{ value: MoodLevel | 'all'; label: string }> = [
  { value: 'all', label: '全部等级' },
  ...([1, 2, 3, 4, 5] as MoodLevel[]).map(level => ({ value: level, label: moodLevelLabels[level] })),
]

export function MoodPage({ colorTheme }: { colorTheme: ColorTheme }) {
  const now = new Date()
  const [view, setView] = useState<MoodCalendarMode>('month')
  const [filterOpen, setFilterOpen] = useState(false)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [entries, setEntries] = useState<MoodEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [filterLevel, setFilterLevel] = useState<MoodLevel | 'all'>('all')
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const generationRef = useRef(0)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const range = view === 'year'
        ? { from: formatLocalDate(year, 1, 1), to: formatLocalDate(year, 12, 31) }
        : { from: formatLocalDate(year, month, 1), to: formatLocalDate(year, month, daysInMonth(year, month)) }
      const list = await apiClient.listMoodEntries(range, signal)
      if (generation !== generationRef.current) return
      setEntries(list)
    } catch (e: unknown) {
      if (generation !== generationRef.current) return
      if ((e as any)?.name === 'AbortError') return
      setError((e as Error)?.message ?? '情绪记录读取失败')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [view, year, month])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  const handleSelectDate = (date?: string) => { setSelectedDate(date) }

  const handleMonthChange = (nextYear: number, nextMonth: number) => {
    setYear(nextYear)
    setMonth(nextMonth)
    setSelectedDate(undefined)
  }

  const handleSwitchView = (nextView: MoodCalendarMode) => {
    setView(nextView)
    setSelectedDate(undefined)
  }

  const visibleEntries = useMemo(() => {
    let list = entries
    if (selectedDate) list = list.filter(entry => entry.entryDate === selectedDate)
    if (filterLevel !== 'all') list = list.filter(entry => entry.moodLevel === filterLevel)
    return list
  }, [entries, selectedDate, filterLevel])

  const closeModalAndRefresh = useCallback(async () => {
    setModal({ kind: 'none' })
    await refresh()
  }, [refresh])

  const handleSave = async (input: MoodEntryInput) => {
    if (modal.kind === 'edit') await apiClient.updateMoodEntry(modal.entry.id, input)
    else await apiClient.createMoodEntry(input)
    await closeModalAndRefresh()
  }

  const handleDelete = async (id: string) => {
    await apiClient.deleteMoodEntry(id)
    await closeModalAndRefresh()
  }

  const activeFilter = filterOptions.find(option => option.value === filterLevel) ?? filterOptions[0]!
  const periodHint = view === 'year'
    ? `当前年：${year} 年${selectedDate ? (' · 已选中 ' + selectedDate.slice(5)) : ''}`
    : `当前月：${year} 年 ${month} 月${selectedDate ? (' · 已选中 ' + selectedDate.slice(5)) : ''}`

  return (
    <View className='mood-page'>
      <View className='mood-toolbar'>
        <View className='mood-toolbar-actions'>
          <View
            className='mood-new-button'
            role='button'
            aria-label='新建情绪记录'
            onClick={() => setModal({ kind: 'create' })}
          >
            <Text>＋ 新建情绪记录</Text>
          </View>
          <View className='mood-view-toggle' role='tablist' aria-label='日历视图切换'>
            <View
              role='tab'
              aria-selected={view === 'year'}
              className={`mood-view-toggle-item ${view === 'year' ? 'active' : ''}`}
              onClick={() => handleSwitchView('year')}
            >
              <Text>年视图</Text>
            </View>
            <View
              role='tab'
              aria-selected={view === 'month'}
              className={`mood-view-toggle-item ${view === 'month' ? 'active' : ''}`}
              onClick={() => handleSwitchView('month')}
            >
              <Text>月视图</Text>
            </View>
          </View>
        </View>
        <View className='mood-toolbar-actions'>
          <Text className='mood-toolbar-hint'>{periodHint}</Text>
          <View className='mood-filter-wrap'>
            <View
              className={`mood-filter-trigger ${filterOpen ? 'open' : ''}`}
              role='button'
              aria-haspopup='listbox'
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(open => !open)}
            >
              <Text>{activeFilter.label} ▾</Text>
            </View>
            {filterOpen && (
              <>
                <View className='mood-filter-backdrop' onClick={() => setFilterOpen(false)} />
                <View className='mood-filter-menu' role='listbox' aria-label='按情绪等级筛选'>
                  {filterOptions.map(option => (
                    <View
                      key={option.value}
                      role='option'
                      aria-selected={option.value === filterLevel}
                      className={`mood-filter-menu-item ${option.value === filterLevel ? 'active' : ''}`}
                      onClick={() => { setFilterLevel(option.value); setFilterOpen(false) }}
                    >
                      <Text>{option.label}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>
      </View>

      <MoodCalendar
        mode={view}
        year={year}
        month={month}
        entries={entries}
        selectedDate={selectedDate}
        filterLevel={filterLevel}
        colorTheme={colorTheme}
        onSelectDate={handleSelectDate}
        onMonthChange={handleMonthChange}
      />

      {loading && <View className='mood-empty'><Text>正在读取情绪记录…</Text></View>}
      {!loading && error && <View className='mood-empty'><Text>{error}</Text></View>}
      {!loading && !error && visibleEntries.length === 0 && (
        <View className='mood-empty'><Text>{entries.length === 0 ? (view === 'year' ? '这一年还没有情绪记录，随手记一笔吧。' : '这个月还没有情绪记录，随手记一笔吧。') : '当前筛选下没有记录。'}</Text></View>
      )}

      <View className='mood-card-grid'>
        {!loading && !error && visibleEntries.map(entry => (
          <MoodCard key={entry.id} entry={entry} colorTheme={colorTheme} onOpen={(target) => setModal({ kind: 'detail', entry: target })} />
        ))}
      </View>

      {modal.kind === 'create' && (
        <MoodRecordModal
          initialDate={selectedDate ?? todayLocalDate()}
          colorTheme={colorTheme}
          onClose={() => setModal({ kind: 'none' })}
          onSave={handleSave}
          onReloadData={() => { void refresh() }}
        />
      )}
      {modal.kind === 'edit' && (
        <MoodRecordModal
          initial={modal.entry}
          colorTheme={colorTheme}
          onClose={() => setModal({ kind: 'none' })}
          onSave={handleSave}
          onReloadData={() => { void refresh() }}
        />
      )}
      {modal.kind === 'detail' && (
        <MoodDetailModal
          entry={modal.entry}
          colorTheme={colorTheme}
          onClose={() => setModal({ kind: 'none' })}
          onEdit={(target) => setModal({ kind: 'edit', entry: target })}
          onDelete={handleDelete}
        />
      )}
    </View>
  )
}
