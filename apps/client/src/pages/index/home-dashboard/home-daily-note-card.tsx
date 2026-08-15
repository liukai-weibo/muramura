import { useEffect, useMemo, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import type { DailyNote } from '@knowledge-base/contracts'
import { apiClient } from '../api-client'

interface HomeDailyNoteCardProps { onOpenDailyNotes: () => void }

function previewLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  let remainingContentLines = 6

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!(lines[index] ?? '').trim()) continue
    remainingContentLines -= 1
    if (remainingContentLines === 0) return lines.slice(index)
  }

  return lines
}

export function HomeDailyNoteCard({ onOpenDailyNotes }: HomeDailyNoteCardProps) {
  const [note, setNote] = useState<DailyNote>(); const [loaded, setLoaded] = useState(false); const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const empty = !note?.content.trim(); const excerpt = useMemo(() => previewLines(note?.content ?? ''), [note?.content])
  const refresh = async () => { setNote(await apiClient.readTodayDailyNote()); setLoaded(true) }
  useEffect(() => { void refresh().catch(() => setLoaded(true)) }, [])
  useEffect(() => {
    const onChanged = () => { void refresh().catch(() => undefined) }
    window.addEventListener('daily-note-content-changed', onChanged)
    return () => window.removeEventListener('daily-note-content-changed', onChanged)
  }, [])
  const save = async () => {
    if (saving || !draft.trim()) return
    setSaving(true); setError('')
    try { setNote(await apiClient.appendTodayDailyNote(draft)); window.dispatchEvent(new CustomEvent('daily-note-content-changed')); setDraft(''); setModalOpen(false) }
    catch { setError('保存失败，内容仍保留在这里') }
    finally { setSaving(false) }
  }
  return <>
    <View className='home-daily-note-card card-transition' role='button' onClick={onOpenDailyNotes}>
      <View className='home-daily-note-heading'><View><Image className='home-daily-note-cat' src={new URL('../../../assets/home/guides/cat-forward-stretch.png', import.meta.url).href} mode='aspectFit' /><Text>手记</Text>{loaded && empty && <Text className='home-daily-note-badge' aria-label='今日尚未记录' />}</View><Text>{empty ? '等待记录' : '已记录'}</Text></View>
      <View className={`home-daily-note-preview ${empty ? 'empty' : ''}`}>{empty ? <Text className='home-daily-note-preview-line'>还没有今日记录，点击快速撰写</Text> : excerpt.map((line, index) => <Text key={`${index}-${line}`} className={`home-daily-note-preview-line ${line.trim() ? '' : 'empty-line'}`}>{line}</Text>)}</View>
      <View className='home-daily-note-actions'><Button className='home-daily-note-action control-transition' onClick={(event) => { event.stopPropagation(); setModalOpen(true) }}>快速记录</Button></View>
    </View>
    {modalOpen && <View className='home-daily-note-modal-backdrop' onClick={() => { if (!saving) setModalOpen(false) }}><View className='home-daily-note-modal' role='dialog' aria-label='快速记录' onClick={event => event.stopPropagation()}>
      <View><Text className='home-daily-note-modal-title'>快速记录</Text><Text className='home-daily-note-modal-hint'>Ctrl / Cmd + Enter 保存</Text></View>
      <textarea autoFocus className='home-daily-note-modal-input' value={draft} maxLength={100000} placeholder='记下此刻想到的事...' onInput={event => { setDraft(event.currentTarget.value); setError('') }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() } }} />
      {error && <Text className='home-daily-note-modal-error'>{error}</Text>}
      <View className='home-daily-note-modal-actions'><Button disabled={saving} className='home-daily-note-cancel control-transition' onClick={() => setModalOpen(false)}>取消</Button><Button disabled={saving || !draft.trim()} className='home-daily-note-save control-transition' onClick={() => void save()}>{saving ? '保存中...' : '保存'}</Button></View>
    </View></View>}
  </>
}
