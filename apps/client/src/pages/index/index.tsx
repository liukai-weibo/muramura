import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import { ItemApplicationService, type ItemAction } from '@knowledge-base/application'
import type { Item, ItemStatus } from '@knowledge-base/contracts'
import { createIndexedDbRepository } from '@knowledge-base/storage-indexeddb'
import './index.scss'

const statusLabels: Record<ItemStatus, string> = {
  idea_to_try: '想试试',
  idea_later: '以后再说',
  doing: '进行中',
  paused: '已暂停',
  waiting_review: '待复盘',
  reviewed: '已复盘',
  archived_no_review: '不复盘归档',
  abandoned: '已放弃',
}

const filters: Array<{ label: string; status?: ItemStatus }> = [
  { label: '全部' },
  { label: '想试试', status: 'idea_to_try' },
  { label: '以后再说', status: 'idea_later' },
  { label: '进行中', status: 'doing' },
  { label: '已暂停', status: 'paused' },
  { label: '待复盘', status: 'waiting_review' },
]

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function IndexPage() {
  const storage = useMemo(() => createIndexedDbRepository(), [])
  const application = useMemo(() => new ItemApplicationService(storage.repository), [storage])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<ItemStatus | undefined>()
  const [selectedId, setSelectedId] = useState<string>()
  const [message, setMessage] = useState('正在读取本地事项…')
  const [busy, setBusy] = useState(false)

  const selectedItem = items.find((item) => item.id === selectedId)
  const visibleItems = filter ? items.filter((item) => item.status === filter) : items

  const refresh = async (nextSelectedId = selectedId) => {
    const nextItems = await application.listItems()
    setItems(nextItems)
    if (nextSelectedId && nextItems.some((item) => item.id === nextSelectedId)) {
      setSelectedId(nextSelectedId)
    } else if (selectedId && !nextItems.some((item) => item.id === selectedId)) {
      setSelectedId(undefined)
    }
    setMessage(`${nextItems.length} 条有效事项，仅保存在当前浏览器`)
  }

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '本地数据库初始化失败')
    })
    return () => storage.database.close()
  }, [storage])

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const hasCaptureContent = Boolean(title.trim() || content.trim())

  const createIdea = (saveForLater: boolean) => run(async () => {
    const item = await application.createIdea({ title, content, saveForLater })
    setTitle('')
    setContent('')
    setFilter(undefined)
    await refresh(item.id)
  })

  const changeStatus = (action: ItemAction) => run(async () => {
    if (!selectedItem) return
    await application.changeStatus(selectedItem.id, action.status)
    await refresh(selectedItem.id)
  })

  const removeSelected = () => run(async () => {
    if (!selectedItem) return
    await application.deleteItem(selectedItem.id)
    setSelectedId(undefined)
    await refresh(undefined)
  })

  return (
    <View className='page'>
      <View className='hero'>
        <View>
          <Text className='eyebrow'>SPRINT 1 · 事项主链路</Text>
          <Text className='title'>现在真正重要的事</Text>
          <Text className='subtitle'>捕获想法，推动执行，把完成的事送进复盘。</Text>
        </View>
        <View className='local-status'><View className='status-dot' /><Text>{message}</Text></View>
      </View>

      <View className='capture-card'>
        <Text className='section-kicker'>快速捕获</Text>
        <Text className='field-label'>一句话标题</Text>
        <Input
          className='title-input'
          value={title}
          maxlength={120}
          placeholder='例如：我想学写字'
          onInput={(event) => setTitle(event.detail.value)}
        />
        <Text className='field-label content-label'>补充说明（可选）</Text>
        <Textarea
          className='content-input'
          value={content}
          maxlength={1000}
          placeholder='为什么想做、希望得到什么、准备从哪一步开始'
          onInput={(event) => setContent(event.detail.value)}
        />
        <Text className='capture-hint'>只填补充说明也可以保存，第一行会自动成为标题。</Text>
        <View className='capture-actions'>
          <Button className='secondary-button' disabled={busy || !hasCaptureContent} onClick={() => createIdea(true)}>以后再说</Button>
          <Button className='primary-button' disabled={busy || !hasCaptureContent} onClick={() => createIdea(false)}>加入想试试</Button>
        </View>
      </View>

      <View className='workspace'>
        <View className='list-panel'>
          <View className='panel-heading'>
            <View><Text className='section-kicker'>事项池</Text><Text className='panel-title'>{visibleItems.length} 件事</Text></View>
          </View>
          <View className='filters'>
            {filters.map((entry) => (
              <Button
                key={entry.label}
                className={`filter-button ${filter === entry.status ? 'active' : ''}`}
                size='mini'
                onClick={() => setFilter(entry.status)}
              >{entry.label}</Button>
            ))}
          </View>
          <View className='list'>
            {visibleItems.length === 0 ? (
              <View className='empty'><Text>这个状态下还没有事项。</Text><Text>先捕获一个真实想法，让系统开始运转。</Text></View>
            ) : visibleItems.map((item) => (
              <View
                className={`item ${selectedId === item.id ? 'selected' : ''}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <View className='item-main'>
                  <Text className='item-title'>{item.title}</Text>
                  {item.content && <Text className='item-content'>{item.content}</Text>}
                </View>
                <View className='item-meta'>
                  <Text className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</Text>
                  <Text className='time'>{formatTime(item.updatedAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className='detail-panel'>
          {selectedItem ? (
            <>
              <Text className='section-kicker'>当前事项</Text>
              <Text className='detail-title'>{selectedItem.title}</Text>
              <Text className={`detail-status status-${selectedItem.status}`}>{statusLabels[selectedItem.status]}</Text>
              <Text className={`detail-content ${selectedItem.content ? '' : 'muted'}`}>
                {selectedItem.content || '没有补充说明。'}
              </Text>
              <View className='detail-time'>
                <Text>创建于 {formatTime(selectedItem.createdAt)}</Text>
                <Text>更新于 {formatTime(selectedItem.updatedAt)}</Text>
              </View>
              <View className='action-stack'>
                {application.actionsFor(selectedItem).map((action) => (
                  <Button
                    key={action.status}
                    className={`action-button ${action.tone}`}
                    disabled={busy}
                    onClick={() => changeStatus(action)}
                  >{action.label}</Button>
                ))}
                <Button className='action-button delete' disabled={busy} onClick={removeSelected}>删除事项</Button>
              </View>
            </>
          ) : (
            <View className='detail-empty'>
              <Text className='detail-empty-title'>选择一件事</Text>
              <Text>查看详情，并推动它进入下一个真实状态。</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
