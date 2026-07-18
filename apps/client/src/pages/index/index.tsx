import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import { ItemApplicationService, ReviewApplicationService, type ItemAction } from '@knowledge-base/application'
import type { Item, ItemStatus, Method, Review } from '@knowledge-base/contracts'
import { createIndexedDbRepository } from '@knowledge-base/storage-indexeddb'
import './index.scss'

const statusLabels: Record<ItemStatus, string> = {
  idea_to_try: '想试试', idea_later: '以后再说', doing: '进行中', paused: '已暂停',
  waiting_review: '待复盘', reviewed: '已复盘', archived_no_review: '不复盘归档', abandoned: '已放弃',
}

const filterGroups: Array<{ label: string; entries: Array<{ label: string; status: ItemStatus }> }> = [
  {
    label: '想法 / 灵感',
    entries: [
      { label: '想试试', status: 'idea_to_try' },
      { label: '以后再说', status: 'idea_later' },
    ],
  },
  {
    label: '正在做的事',
    entries: [
      { label: '进行中', status: 'doing' },
      { label: '已暂停', status: 'paused' },
    ],
  },
  {
    label: '复盘',
    entries: [
      { label: '待复盘', status: 'waiting_review' },
      { label: '已复盘', status: 'reviewed' },
    ],
  },
]

const ITEMS_PER_PAGE = 5

const emptyReview = {
  actualAction: '', result: '', effective: '', incompatible: '', reason: '', adjustment: '', newIdeas: '',
}
const emptyMethod = { title: '', applicable: '', unsuitable: '', steps: '' }

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default function IndexPage() {
  const storage = useMemo(() => createIndexedDbRepository(), [])
  const application = useMemo(() => new ItemApplicationService(storage.repository), [storage])
  const reviewApplication = useMemo(() => new ReviewApplicationService(
    storage.reviewRepository, storage.methodRepository, storage.reviewWorkflowRepository,
  ), [storage])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [trashItems, setTrashItems] = useState<Item[]>([])
  const [methods, setMethods] = useState<Method[]>([])
  const [filter, setFilter] = useState<ItemStatus | undefined>()
  const [showTrash, setShowTrash] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedReview, setSelectedReview] = useState<Review>()
  const [reviewForm, setReviewForm] = useState(emptyReview)
  const [methodForm, setMethodForm] = useState(emptyMethod)
  const [message, setMessage] = useState('正在读取本地事项…')
  const [busy, setBusy] = useState(false)

  const selectedItem = (showTrash ? trashItems : items).find((item) => item.id === selectedId)
  const visibleItems = showTrash ? trashItems : filter ? items.filter((item) => item.status === filter) : items
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / ITEMS_PER_PAGE))
  const pagedItems = visibleItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const hasCaptureContent = Boolean(title.trim() || content.trim())
  const methodStarted = Object.values(methodForm).some((value) => value.trim())
  const [reviewError, setReviewError] = useState('')

  const refresh = async (nextSelectedId = selectedId) => {
    const [nextItems, nextTrashItems, nextMethods] = await Promise.all([
      application.listItems(), application.listTrash(), reviewApplication.listMethods(),
    ])
    setItems(nextItems)
    setTrashItems(nextTrashItems)
    setMethods(nextMethods)
    const selectionPool = [...nextItems, ...nextTrashItems]
    if (nextSelectedId && selectionPool.some((item) => item.id === nextSelectedId)) setSelectedId(nextSelectedId)
    else if (selectedId && !selectionPool.some((item) => item.id === selectedId)) setSelectedId(undefined)
    setMessage(`${nextItems.length} 条有效事项 · ${nextMethods.length} 条当前方法 · 回收站 ${nextTrashItems.length} 条`)
  }

  useEffect(() => {
    refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '本地数据库初始化失败'))
    return () => storage.database.close()
  }, [storage])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!selectedId) { setSelectedReview(undefined); return }
    reviewApplication.getReviewForItem(selectedId).then(setSelectedReview).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '读取复盘失败')
    })
  }, [selectedId, reviewApplication, items])

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await operation() }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }

  const createIdea = (saveForLater: boolean) => run(async () => {
    const item = await application.createIdea({ title, content, saveForLater })
    setTitle(''); setContent(''); setFilter(undefined)
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
    setDeleteConfirm(false)
    setSelectedId(undefined)
    await refresh(undefined)
    setMessage('事项已移入回收站，30 天内可以恢复')
  })

  const restoreSelected = () => run(async () => {
    if (!selectedItem) return
    const restored = await application.restoreItem(selectedItem.id)
    setShowTrash(false)
    setFilter(undefined)
    await refresh(restored.id)
    setMessage(`“${restored.title}”已恢复`)
  })

  const openActiveItems = () => {
    setShowTrash(false)
    setCurrentPage(1)
    setSelectedId(undefined)
    setDeleteConfirm(false)
  }

  const openTrash = () => {
    setShowTrash(true)
    setCurrentPage(1)
    setSelectedId(undefined)
    setDeleteConfirm(false)
  }

  const completeReview = () => run(async () => {
    if (!selectedItem) return
    const missingReviewFields = ([
      ['实际行动', reviewForm.actualAction],
      ['结果', reviewForm.result],
    ] satisfies Array<[string, string]>).filter(([, value]) => !value.trim()).map(([label]) => label)
    if (missingReviewFields.length) {
      setReviewError(`请填写：${missingReviewFields.join('、')}`)
      return
    }

    const missingMethodFields = methodStarted
      ? ([
        ['方法名称', methodForm.title],
        ['适用情况', methodForm.applicable],
        ['具体步骤', methodForm.steps],
      ] satisfies Array<[string, string]>).filter(([, value]) => !value.trim()).map(([label]) => label)
      : []
    if (missingMethodFields.length) {
      setReviewError(`已开始提炼方法，请填写：${missingMethodFields.join('、')}`)
      return
    }

    setReviewError('')
    const result = await reviewApplication.completeReview({
      itemId: selectedItem.id,
      ...reviewForm,
      method: methodStarted ? methodForm : undefined,
    })
    setSelectedReview(result.review)
    setReviewForm(emptyReview)
    setMethodForm(emptyMethod)
    await refresh(selectedItem.id)
    setMessage(result.createdIdea
      ? `复盘已完成，新想法“${result.createdIdea.title}”已进入想试试`
      : '复盘已完成')
  })

  const reviewField = (key: keyof typeof emptyReview, label: string, placeholder: string, optional = false) => (
    <View className='review-field'>
      <Text className='field-label'>{label}{optional ? '（可选）' : ''}</Text>
      <Textarea
        className='review-input'
        value={reviewForm[key]}
        maxlength={1200}
        placeholder={placeholder}
        onInput={(event) => {
          setReviewError('')
          setReviewForm((current) => ({ ...current, [key]: event.detail.value }))
        }}
      />
    </View>
  )

  return (
    <View className='page'>
      <View className='hero'>
        <View><Text className='eyebrow'>SPRINT 2 · 复盘与方法</Text><Text className='title'>让经历沉淀成方法</Text><Text className='subtitle'>捕获想法，推动执行，用现实证据更新自己的做法。</Text></View>
        <View className='local-status'><View className='status-dot' /><Text>{message}</Text></View>
      </View>

      <View className='capture-card'>
        <Text className='section-kicker'>快速捕获</Text>
        <Text className='field-label'>一句话标题</Text>
        <Input className='title-input' value={title} maxlength={120} placeholder='例如：我想学写字' onInput={(event) => setTitle(event.detail.value)} />
        <Text className='field-label content-label'>补充说明（可选）</Text>
        <Textarea className='content-input' value={content} maxlength={1000} placeholder='为什么想做、希望得到什么、准备从哪一步开始' onInput={(event) => setContent(event.detail.value)} />
        <Text className='capture-hint'>只填补充说明也可以保存，第一行会自动成为标题。</Text>
        <View className='capture-actions'>
          <Button className='secondary-button' disabled={busy || !hasCaptureContent} onClick={() => createIdea(true)}>加入以后再说</Button>
          <Button className='primary-button' disabled={busy || !hasCaptureContent} onClick={() => createIdea(false)}>加入想试试</Button>
        </View>
      </View>

      <View className='workspace'>
        <View className='list-panel'>
          <View className='panel-heading'><View><Text className='section-kicker'>{showTrash ? '回收站' : '事项池'}</Text><Text className='panel-title'>{visibleItems.length} 件事</Text></View></View>
          <View className='filter-header'>
            <Text className='filter-guidance'>{showTrash ? '删除后保留 30 天，之后自动永久清理' : '按运行阶段查看'}</Text>
            <View className='auxiliary-actions'>
              <Button className={`all-filter-button ${!showTrash && filter === undefined ? 'active' : ''}`} size='mini' onClick={() => { openActiveItems(); setFilter(undefined) }}>全部事项</Button>
              <Button className={`all-filter-button ${showTrash ? 'active' : ''}`} size='mini' onClick={openTrash}>回收站{trashItems.length ? ` ${trashItems.length}` : ''}</Button>
            </View>
          </View>
          {!showTrash && <View className='filter-groups'>
            {filterGroups.map((group) => <View className='filter-group' key={group.label}>
              <Text className='filter-group-label'>{group.label}</Text>
              <View className='filters'>{group.entries.map((entry) => <Button key={entry.status} className={`filter-button ${filter === entry.status ? 'active' : ''}`} size='mini' onClick={() => { setFilter(entry.status); setCurrentPage(1); setSelectedId(undefined) }}>{entry.label}</Button>)}</View>
            </View>)}
          </View>}
          <View className='list'>
            {visibleItems.length === 0 ? <View className='empty'><Text>{showTrash ? '回收站是空的。' : '这个状态下还没有事项。'}</Text><Text>{showTrash ? '删除的事项会在这里保留 30 天。' : '先捕获一个真实想法，让系统开始运转。'}</Text></View> : pagedItems.map((item) => (
              <View className={`item ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}>
                <View className='item-main'><Text className='item-title'>{item.title}</Text>{item.content && <Text className='item-content'>{item.content}</Text>}</View>
                <View className='item-meta'>{showTrash
                  ? <><Text className='trash-badge'>待清理</Text><Text className='time'>{Math.max(1, 30 - Math.floor((Date.now() - new Date(item.deletedAt ?? '').getTime()) / 86400000))} 天后清理</Text></>
                  : <><Text className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</Text><Text className='time'>{formatTime(item.updatedAt)}</Text></>}</View>
              </View>
            ))}
          </View>
          {visibleItems.length > ITEMS_PER_PAGE && <View className='pagination'>
            <Button className='pagination-button' size='mini' disabled={currentPage === 1} onClick={() => { setCurrentPage((page) => page - 1); setSelectedId(undefined) }}>上一页</Button>
            <Text className='pagination-status'>第 {currentPage} / {totalPages} 页</Text>
            <Button className='pagination-button' size='mini' disabled={currentPage === totalPages} onClick={() => { setCurrentPage((page) => page + 1); setSelectedId(undefined) }}>下一页</Button>
          </View>}
        </View>

        <View className={`detail-panel ${!showTrash && (selectedItem?.status === 'waiting_review' || selectedItem?.status === 'reviewed') ? 'review-mode' : ''}`}>
          {selectedItem ? <>
            <Text className='section-kicker'>{showTrash ? '回收站事项' : '当前事项'}</Text><Text className='detail-title'>{selectedItem.title}</Text>
            {showTrash
              ? <Text className='detail-status trash-badge'>将在 30 天内自动清理</Text>
              : <Text className={`detail-status status-${selectedItem.status}`}>{statusLabels[selectedItem.status]}</Text>}
            <Text className={`detail-content ${selectedItem.content ? '' : 'muted'}`}>{selectedItem.content || '没有补充说明。'}</Text>
            <View className='detail-time'><Text>创建于 {formatTime(selectedItem.createdAt)}</Text><Text>更新于 {formatTime(selectedItem.updatedAt)}</Text></View>

            {!showTrash && selectedItem.status === 'waiting_review' && <View className='review-form'>
        <View className='review-heading'><Text className='section-kicker'>完成复盘</Text><Text>先还原事实，再提炼方法。</Text></View>
              {reviewField('actualAction', '实际做了什么', '只写实际发生的行动，不写计划')}
              {reviewField('result', '结果怎样', '结果、产出或可观察变化')}
              {reviewField('effective', '哪些地方有效或舒服', '保留哪些做法', true)}
              {reviewField('incompatible', '哪些地方不兼容', '阻力、代价或不适配之处', true)}
              {reviewField('reason', '原因判断', '为什么有效或无效', true)}
              {reviewField('adjustment', '下次怎么调整', '下一轮具体改变什么', true)}
              {reviewField('newIdeas', '产生了什么新想法', '先记录，后续再转成待验证想法', true)}

              <View className='method-draft'>
                <Text className='section-kicker'>提炼当前有效的方法（可选）</Text>
                <Input className='method-input' value={methodForm.title} placeholder='方法名称' onInput={(event) => { setReviewError(''); setMethodForm((current) => ({ ...current, title: event.detail.value })) }} />
                <Textarea className='method-textarea' value={methodForm.applicable} placeholder='适用于什么情况' onInput={(event) => setMethodForm((current) => ({ ...current, applicable: event.detail.value }))} />
                <Textarea className='method-textarea' value={methodForm.unsuitable} placeholder='不适用于什么情况（可选）' onInput={(event) => setMethodForm((current) => ({ ...current, unsuitable: event.detail.value }))} />
                <Textarea className='method-textarea' value={methodForm.steps} placeholder='具体步骤' onInput={(event) => setMethodForm((current) => ({ ...current, steps: event.detail.value }))} />
              </View>
              {reviewError && <Text className='form-error'>{reviewError}</Text>}
              <Button className='action-button primary' disabled={busy} onClick={completeReview}>完成复盘{methodStarted ? '并形成方法' : ''}</Button>
            </View>}

            {!showTrash && selectedItem.status === 'reviewed' && selectedReview && <View className='review-record'>
              <Text className='section-kicker'>复盘证据</Text>
              {[['实际行动', selectedReview.actualAction], ['结果', selectedReview.result], ['有效之处', selectedReview.effective], ['不兼容之处', selectedReview.incompatible], ['原因判断', selectedReview.reason], ['下次调整', selectedReview.adjustment], ['新想法', selectedReview.newIdeas]].filter(([, value]) => value).map(([label, value]) => <View className='review-record-row' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}
            </View>}

            {showTrash ? <View className='action-stack'>
              <Button className='action-button primary' disabled={busy} onClick={restoreSelected}>恢复事项</Button>
            </View> : selectedItem.status !== 'waiting_review' && <View className='action-stack'>
              {application.actionsFor(selectedItem).map((action) => <Button key={action.status} className={`action-button ${action.tone}`} disabled={busy} onClick={() => changeStatus(action)}>{action.label}</Button>)}
              {deleteConfirm ? <View className='delete-confirm'>
                <Text>确定删除“{selectedItem.title}”？删除后可在回收站保留 30 天。</Text>
                <View className='delete-confirm-actions'>
                  <Button className='action-button secondary' disabled={busy} onClick={() => setDeleteConfirm(false)}>取消</Button>
                  <Button className='action-button delete-confirm-button' disabled={busy} onClick={removeSelected}>确认删除</Button>
                </View>
              </View> : <Button className='action-button delete' disabled={busy} onClick={() => setDeleteConfirm(true)}>删除事项</Button>}
            </View>}
          </> : <View className='detail-empty'><Text className='detail-empty-title'>选择一件事</Text><Text>查看详情，并推动它进入下一个真实状态。</Text></View>}
        </View>
      </View>

      <View className='methods-panel'>
        <View><Text className='section-kicker'>当前有效的方法</Text><Text className='panel-title'>{methods.length} 条方法</Text></View>
        {methods.length === 0 ? <View className='methods-empty'><Text>完成复盘时，可以把已验证的结论提炼成方法。</Text></View> : <View className='method-grid'>{methods.map((method) => <View className='method-card' key={method.id}>
          <View className='method-card-heading'><Text>{method.title}</Text><Text>v{method.version} · 验证 {method.validationCount} 次</Text></View>
          <Text className='method-label'>适用情况</Text><Text className='method-value'>{method.applicable}</Text>
          {method.unsuitable && <><Text className='method-label'>不适用情况</Text><Text className='method-value'>{method.unsuitable}</Text></>}
          <Text className='method-label'>具体步骤</Text><Text className='method-value'>{method.steps}</Text>
        </View>)}</View>}
      </View>
    </View>
  )
}
