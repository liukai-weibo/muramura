import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { MoodEntry, MoodEntryInput } from '@knowledge-base/contracts'
import type { ColorTheme } from '../../display-effect-preference'
import { moodLevelColors, moodLevelColorsDark, moodLevelLabels } from './mood-levels'

function firstLine(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line || value
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(d)
}

interface MoodDetailModalProps {
  entry: MoodEntry
  colorTheme: ColorTheme
  onClose: () => void
  onEdit: (entry: MoodEntry) => void
  onDelete: (id: string) => Promise<void>
}

export function MoodDetailModal({ entry, colorTheme, onClose, onEdit, onDelete }: MoodDetailModalProps) {
  const palette = colorTheme === 'dark' ? moodLevelColorsDark : moodLevelColors
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleDelete = async () => {
    setDeleting(true); setDeleteError('')
    try {
      await onDelete(entry.id)
      // parent closes modal on success
    } catch (e: unknown) {
      setDeleteError((e as any)?.message ?? '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <View className='mood-modal-backdrop' role='dialog' aria-modal='true' aria-label='情绪记录详情'>
      <View className='mood-modal-card'>
        <View className='mood-modal-heading'>
          <Text style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 9999, background: palette[entry.moodLevel], display: 'inline-block' }} />
            {moodLevelLabels[entry.moodLevel]}
          </Text>
          <View className='mood-modal-close' onClick={onClose}><Text>✕</Text></View>
        </View>

        <Text style={{ color: 'var(--cream-hint)', fontSize: 11 }}>{formatDate(entry.entryDate)}</Text>

        <View style={{ padding: '12px 0', borderTop: '1px solid var(--cream-line)', marginTop: 4 }}>
          <Text style={{ fontWeight: 600, marginBottom: 4 }}>{firstLine(entry.content)}</Text>
          {entry.content.includes('\n') && <Text style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>{entry.content.slice(firstLine(entry.content).length).trim()}</Text>}
        </View>

        {entry.response && (
          <View style={{ padding: 10, border: '1px solid var(--cream-line)', borderRadius: 12, background: 'var(--cream-soft-surface)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            <Text style={{ fontSize: 11, color: 'var(--cream-hint)', marginBottom: 4 }}>感受对策</Text>
            <Text>{entry.response}</Text>
          </View>
        )}

        {deleteError && <Text style={{ color: '#ad5965', fontSize: 11 }}>{deleteError}</Text>}

        {confirmDelete ? (
          <View style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmDelete(false)} style={{ fontSize: 11, minHeight: 34, padding: '0 12px' }}>取消</Button>
            <Button className='danger' onClick={handleDelete} disabled={deleting} style={{ fontSize: 11, minHeight: 34, padding: '0 12px' }}>
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </View>
        ) : (
          <View className='mood-modal-actions'>
            <Button className='danger' onClick={() => setConfirmDelete(true)} style={{ fontSize: 11, minHeight: 34, padding: '0 12px' }}>删除</Button>
            <Button onClick={() => onEdit(entry)} style={{ fontSize: 11, minHeight: 34, padding: '0 12px' }}>编辑</Button>
            <Button onClick={onClose} style={{ fontSize: 11, minHeight: 34, padding: '0 12px' }}>关闭</Button>
          </View>
        )}
      </View>
    </View>
  )
}
