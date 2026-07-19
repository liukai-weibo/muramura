import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import { BackupApplicationService, DashboardApplicationService, ItemApplicationService, MethodApplicationService, ReviewApplicationService, SearchApplicationService, type ItemAction } from '@knowledge-base/application'
import type { BackupDocument, DashboardReport, DashboardWindow, Item, ItemStatus, Method, MethodApplicationContext, MethodVersion, Review, SearchResult } from '@knowledge-base/contracts'
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

type MethodMode = 'none' | 'create' | 'validate'

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
  const searchApplication = useMemo(() => new SearchApplicationService(storage.searchRepository), [storage])
  const methodApplication = useMemo(() => new MethodApplicationService(storage.methodApplicationRepository), [storage])
  const backupApplication = useMemo(() => new BackupApplicationService(storage.backupRepository), [storage])
  const dashboardApplication = useMemo(() => new DashboardApplicationService(storage.dashboardRepository), [storage])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [dashboardWindow, setDashboardWindow] = useState<DashboardWindow>('7d')
  const [dashboardReport, setDashboardReport] = useState<DashboardReport>()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [trashItems, setTrashItems] = useState<Item[]>([])
  const [methods, setMethods] = useState<Method[]>([])
  const [expandedMethodId, setExpandedMethodId] = useState<string>()
  const [methodHistories, setMethodHistories] = useState<Record<string, MethodVersion[]>>({})
  const [historyReviews, setHistoryReviews] = useState<Record<string, Review>>({})
  const [filter, setFilter] = useState<ItemStatus | undefined>()
  const [showTrash, setShowTrash] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pendingBackup, setPendingBackup] = useState<BackupDocument>()
  const [backupMessage, setBackupMessage] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedReview, setSelectedReview] = useState<Review>()
  const [reviewForm, setReviewForm] = useState(emptyReview)
  const [methodForm, setMethodForm] = useState(emptyMethod)
  const [methodMode, setMethodMode] = useState<MethodMode>('none')
  const [selectedMethodId, setSelectedMethodId] = useState('')
  const [reviseMethod, setReviseMethod] = useState(false)
  const [methodApplicationContext, setMethodApplicationContext] = useState<MethodApplicationContext>()
  const [applyingMethodId, setApplyingMethodId] = useState<string>()
  const [methodActionTitle, setMethodActionTitle] = useState('')
  const [methodActionContent, setMethodActionContent] = useState('')
  const [message, setMessage] = useState('正在读取本地事项…')
  const [busy, setBusy] = useState(false)

  const selectedItem = (showTrash ? trashItems : items).find((item) => item.id === selectedId)
  const visibleItems = showTrash ? trashItems : filter ? items.filter((item) => item.status === filter) : items
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / ITEMS_PER_PAGE))
  const pagedItems = visibleItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
  const hasCaptureContent = Boolean(title.trim() || content.trim())
  const selectedMethod = methods.find((method) => method.id === selectedMethodId)
  const methodStarted = methodMode === 'create' || (methodMode === 'validate' && reviseMethod)
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
    if (!dashboardOpen) return

    dashboardApplication.getReport(dashboardWindow).then(setDashboardReport).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '读取仪表盘失败')
    })
  }, [dashboardOpen, dashboardWindow, dashboardApplication, items, methods])

  useEffect(() => {
    let active = true
    searchApplication.search(searchQuery).then((results) => active && setSearchResults(results)).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : '搜索失败')
    })
    return () => { active = false }
  }, [searchQuery, searchApplication, items, methods])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!selectedId) { setSelectedReview(undefined); return }
    reviewApplication.getReviewForItem(selectedId).then(setSelectedReview).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '读取复盘失败')
    })
  }, [selectedId, reviewApplication, items])

  useEffect(() => {
    if (!selectedId) { setMethodApplicationContext(undefined); return }
    methodApplication.getContextForItem(selectedId).then((context) => {
      setMethodApplicationContext(context)
      const item = items.find((entry) => entry.id === selectedId)
      if (context && item?.status === 'waiting_review' && methodMode === 'none') {
        setMethodMode('validate')
        setSelectedMethodId(context.method.id)
        setReviseMethod(false)
        setMethodForm(emptyMethod)
      }
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '读取方法应用信息失败'))
  }, [selectedId, methodApplication, items])

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await operation() }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }

  const locateSearchResult = (result: SearchResult) => {
    if (result.itemId) {
      setShowTrash(false)
      setFilter(undefined)
      setCurrentPage(1)
      setSelectedId(result.itemId)
      document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (!result.methodId) return
    run(async () => {
      if (result.methodVersion && expandedMethodId !== result.methodId) {
        const versions = methodHistories[result.methodId!] ?? await reviewApplication.listMethodVersions(result.methodId!)
        const reviewIds = [...new Set(versions.flatMap((version) => version.sourceReviewId ? [version.sourceReviewId] : []))]
        const loadedReviews = await Promise.all(reviewIds.filter((reviewId) => !historyReviews[reviewId]).map((reviewId) => reviewApplication.getReview(reviewId)))
        setMethodHistories((current) => ({ ...current, [result.methodId!]: versions }))
        setHistoryReviews((current) => ({ ...current, ...Object.fromEntries(loadedReviews.filter((review): review is Review => Boolean(review)).map((review) => [review.id, review])) }))
        setExpandedMethodId(result.methodId)
      }
      window.setTimeout(() => document.getElementById(`method-${result.methodId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
    })
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

  const exportBackup = () => run(async () => {
    const backup = await backupApplication.createBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `knowledge-base-backup-${backup.exportedAt.slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setBackupMessage(`已导出 ${backup.data.items.length} 条事项、${backup.data.reviews.length} 条复盘和 ${backup.data.methods.length} 条方法`)
  })

  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const backup = backupApplication.parseAndValidate(await file.text())
      setPendingBackup(backup)
      setBackupMessage('备份校验通过，请确认是否覆盖当前全部数据')
    } catch (error: unknown) {
      setPendingBackup(undefined)
      setBackupMessage(error instanceof Error ? error.message : '备份文件校验失败')
    }
  }

  const restoreBackup = () => run(async () => {
    if (!pendingBackup) return
    await backupApplication.restoreBackup(pendingBackup)
    setPendingBackup(undefined)
    setSelectedId(undefined)
    setFilter(undefined)
    setShowTrash(false)
    setCurrentPage(1)
    await refresh(undefined)
    setBackupMessage('备份恢复完成，全部数据已替换')
  })

  const chooseMethodMode = (mode: MethodMode) => {
    setMethodMode(mode)
    setSelectedMethodId('')
    setReviseMethod(false)
    setMethodForm(emptyMethod)
    setReviewError('')
  }

  const chooseExistingMethod = (methodId: string) => {
    setSelectedMethodId(methodId)
    setReviseMethod(false)
    setMethodForm(emptyMethod)
    setReviewError('')
  }

  const toggleRevision = () => {
    if (!selectedMethod) return
    const next = !reviseMethod
    setReviseMethod(next)
    setMethodForm(next ? {
      title: selectedMethod.title,
      applicable: selectedMethod.applicable,
      unsuitable: selectedMethod.unsuitable,
      steps: selectedMethod.steps,
    } : emptyMethod)
  }

  const openMethodApplication = (method: Method) => {
    if (applyingMethodId === method.id) {
      setApplyingMethodId(undefined)
      setMethodActionTitle('')
      setMethodActionContent('')
      return
    }
    setApplyingMethodId(method.id)
    setMethodActionTitle(`使用“${method.title}”完成一次行动`)
    setMethodActionContent('')
  }

  const createMethodAction = (method: Method) => run(async () => {
    const item = await methodApplication.createItem(method.id, methodActionTitle, methodActionContent)
    setApplyingMethodId(undefined)
    setMethodActionTitle('')
    setMethodActionContent('')
    setFilter(undefined)
    setShowTrash(false)
    await refresh(item.id)
    setMessage(`已基于“${method.title}”v${method.version} 创建行动事项`)
  })

  const toggleMethodHistory = (methodId: string) => {
    if (expandedMethodId === methodId) {
      setExpandedMethodId(undefined)
      return
    }
    run(async () => {
      const versions = methodHistories[methodId] ?? await reviewApplication.listMethodVersions(methodId)
      const reviewIds = [...new Set(versions.flatMap((version) => version.sourceReviewId ? [version.sourceReviewId] : []))]
      const missingReviewIds = reviewIds.filter((reviewId) => !historyReviews[reviewId])
      const loadedReviews = await Promise.all(missingReviewIds.map((reviewId) => reviewApplication.getReview(reviewId)))
      setMethodHistories((current) => ({ ...current, [methodId]: versions }))
      setHistoryReviews((current) => ({
        ...current,
        ...Object.fromEntries(loadedReviews.filter((review): review is Review => Boolean(review)).map((review) => [review.id, review])),
      }))
      setExpandedMethodId(methodId)
    })
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

    if (methodMode === 'validate' && !selectedMethodId) {
      setReviewError('请选择本次复盘验证的方法')
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
      method: methodMode === 'create' ? methodForm : undefined,
      existingMethod: methodMode === 'validate' ? {
        methodId: selectedMethodId,
        revision: reviseMethod ? methodForm : undefined,
      } : undefined,
    })
    setSelectedReview(result.review)
    setReviewForm(emptyReview)
    setMethodForm(emptyMethod)
    setMethodMode('none')
    setSelectedMethodId('')
    setReviseMethod(false)
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

      <View className='search-panel'>
        <View className='search-heading'><Text className='section-kicker'>全局搜索</Text><Text>查找事项、复盘、当前方法与历史版本</Text></View>
        <View className='search-input-row'>
          <Input className='search-input' value={searchQuery} maxlength={120} placeholder='输入关键词，例如：练字、启动、低能量' onInput={(event) => setSearchQuery(event.detail.value)} />
          {searchQuery && <View className='search-clear' onClick={() => setSearchQuery('')}><Text>清空</Text></View>}
        </View>
        {searchQuery.trim() && <View className='search-results'>
          {searchResults.length === 0 ? <Text className='search-empty'>没有找到相关记录。</Text> : (['item', 'review', 'method'] as const).map((type) => {
            const grouped = searchResults.filter((result) => result.type === type)
            if (!grouped.length) return null
            return <View className='search-group' key={type}>
              <Text className='search-group-title'>{type === 'item' ? '事项' : type === 'review' ? '复盘' : '方法'} · {grouped.length}</Text>
              {grouped.map((result) => <View className='search-result' key={result.id} onClick={() => locateSearchResult(result)}>
                <View><Text className='search-result-title'>{result.title}</Text><Text className='search-result-excerpt'>{result.excerpt}</Text></View>
                <Text className='search-result-action'>{result.methodVersion ? `定位 v${result.methodVersion}` : '定位'}</Text>
              </View>)}
            </View>
          })}
        </View>}
      </View>

      <View className='dashboard-panel'>
        <View className='dashboard-header'>
          <View>
            <Text className='section-kicker'>周期复盘</Text>
            <Text className='dashboard-title'>系统运行仪表盘</Text>
          </View>
          <View className={`dashboard-toggle ${dashboardOpen ? 'active' : ''}`} onClick={() => setDashboardOpen((open) => !open)}>
            <Text>{dashboardOpen ? '收起仪表盘' : '查看系统状态'}</Text>
          </View>
        </View>

        {dashboardOpen && dashboardReport && <>
          <View className='dashboard-windows'>
            {([['7d', '最近 7 天'], ['30d', '最近 30 天'], ['all', '全部']] as Array<[DashboardWindow, string]>).map(([value, label]) => (
              <View key={value} className={`dashboard-window ${dashboardWindow === value ? 'active' : ''}`} onClick={() => setDashboardWindow(value)}>
                <Text>{label}</Text>
              </View>
            ))}
          </View>

          <View className='dashboard-section'>
            <Text className='dashboard-section-title'>窗口内发生</Text>
            <View className='metric-grid'>
              {[
                ['新增事项', dashboardReport.metrics.newItems],
                ['进入执行次数', dashboardReport.metrics.startedExecutions],
                ['完成复盘', dashboardReport.metrics.completedReviews],
                ['形成方法', dashboardReport.metrics.newMethods],
                ['仅验证方法', dashboardReport.metrics.methodValidations],
                ['修订方法', dashboardReport.metrics.methodRevisions],
                ['方法发起行动', dashboardReport.metrics.methodApplications],
              ].map(([label, value]) => <View className='metric-card' key={label}>
                <Text>{value}</Text><Text>{label}</Text>
              </View>)}
            </View>
          </View>

          <View className='dashboard-columns'>
            <View className='dashboard-section'>
              <Text className='dashboard-section-title'>当前堵塞</Text>
              {[
                ['想试试', dashboardReport.backlog.ideaToTry],
                ['进行中', dashboardReport.backlog.doing],
                ['待复盘', dashboardReport.backlog.waitingReview],
                ['暂停', dashboardReport.backlog.paused],
                ['以后再说', dashboardReport.backlog.ideaLater],
              ].map(([label, value]) => <View className='backlog-row' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}
            </View>

            <View className='dashboard-section'>
              <Text className='dashboard-section-title'>方法复利</Text>
              {[dashboardReport.mostValidated, dashboardReport.mostApplied, dashboardReport.recentlyRevised]
                .filter(Boolean)
                .map((insight) => <View className='insight-row' key={`${insight!.methodId}-${insight!.detail}`}>
                  <Text>{insight!.title}</Text><Text>{insight!.detail}</Text>
                </View>)}
              {!dashboardReport.mostValidated && !dashboardReport.mostApplied && !dashboardReport.recentlyRevised && (
                <Text className='dashboard-empty'>该窗口内还没有方法活动。</Text>
              )}
            </View>
          </View>

          <View className='dashboard-section dashboard-facts'>
            <Text className='dashboard-section-title'>事实提示</Text>
            {dashboardReport.facts.map((fact) => <Text key={fact}>· {fact}</Text>)}
          </View>
        </>}
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

      <View className='workspace' id='workspace'>
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

            {methodApplicationContext && <View className='method-application-context'>
              <Text className='method-label'>本次行动使用的方法</Text>
              <Text>{methodApplicationContext.version.title} v{methodApplicationContext.application.methodVersion}</Text>
              {selectedItem.status === 'waiting_review' && <Text>已为本次复盘推荐验证该方法，你仍可切换其他处理方式。</Text>}
            </View>}

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
                <Text className='section-kicker'>本次复盘如何沉淀方法（可选）</Text>
                <View className='method-mode-actions'>
                  <Button className={`method-mode-button ${methodMode === 'none' ? 'active' : ''}`} size='mini' onClick={() => chooseMethodMode('none')}>不沉淀方法</Button>
                  <Button className={`method-mode-button ${methodMode === 'create' ? 'active' : ''}`} size='mini' onClick={() => chooseMethodMode('create')}>形成新方法</Button>
                  <Button className={`method-mode-button ${methodMode === 'validate' ? 'active' : ''}`} size='mini' disabled={methods.length === 0} onClick={() => chooseMethodMode('validate')}>验证已有方法</Button>
                </View>

                {methodMode === 'validate' && <View className='existing-methods'>
                  {methods.map((method) => <Button key={method.id} className={`existing-method-button ${selectedMethodId === method.id ? 'active' : ''}`} size='mini' onClick={() => chooseExistingMethod(method.id)}>
                    {method.title} · v{method.version} · 已验证 {method.validationCount} 次
                  </Button>)}
                  {selectedMethod && <View className='selected-method-summary'>
                    <Text>当前步骤：{selectedMethod.steps}</Text>
                    <Button className={`method-revision-button ${reviseMethod ? 'active' : ''}`} size='mini' onClick={toggleRevision}>{reviseMethod ? '取消修订，仅验证' : '根据本次复盘修订方法'}</Button>
                  </View>}
                </View>}

                {(methodMode === 'create' || reviseMethod) && <>
                  <Input className='method-input' value={methodForm.title} placeholder='方法名称' onInput={(event) => { setReviewError(''); setMethodForm((current) => ({ ...current, title: event.detail.value })) }} />
                  <Textarea className='method-textarea' value={methodForm.applicable} placeholder='适用于什么情况' onInput={(event) => setMethodForm((current) => ({ ...current, applicable: event.detail.value }))} />
                  <Textarea className='method-textarea' value={methodForm.unsuitable} placeholder='不适用于什么情况（可选）' onInput={(event) => setMethodForm((current) => ({ ...current, unsuitable: event.detail.value }))} />
                  <Textarea className='method-textarea' value={methodForm.steps} placeholder='具体步骤' onInput={(event) => setMethodForm((current) => ({ ...current, steps: event.detail.value }))} />
                </>}
              </View>
              {reviewError && <Text className='form-error'>{reviewError}</Text>}
              <Button className='action-button primary' disabled={busy} onClick={completeReview}>完成复盘{methodMode === 'create' ? '并形成方法' : methodMode === 'validate' ? reviseMethod ? '并修订方法' : '并验证方法' : ''}</Button>
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

      <View className='backup-panel'>
        <View className='backup-heading'>
          <View><Text className='section-kicker'>数据备份</Text><Text className='panel-title'>导出与恢复</Text></View>
          <Text className='backup-description'>数据仅保存在当前浏览器。建议每周及重大更新前导出一次 JSON 备份。</Text>
        </View>
        <View className='backup-actions'>
          <Button className='secondary-button' disabled={busy} onClick={exportBackup}>导出完整备份</Button>
          <label className={`file-button ${busy ? 'disabled' : ''}`}>选择备份文件<input className='backup-file-input' style={{ display: 'none' }} type='file' accept='application/json,.json' disabled={busy} onChange={selectBackup} /></label>
        </View>
        {backupMessage && <Text className={`backup-message ${pendingBackup ? 'warning' : ''}`}>{backupMessage}</Text>}
        {pendingBackup && <View className='restore-confirm'>
          <Text>备份时间：{formatTime(pendingBackup.exportedAt)}</Text>
          <Text>{pendingBackup.data.items.length} 条事项 · {pendingBackup.data.reviews.length} 条复盘 · {pendingBackup.data.methods.length} 条方法</Text>
          <Text className='restore-warning'>恢复会完整覆盖当前浏览器中的全部数据，此操作不可撤销。建议先导出当前数据。</Text>
          <View className='restore-actions'>
            <Button className='secondary-button' disabled={busy} onClick={() => { setPendingBackup(undefined); setBackupMessage('已取消恢复') }}>取消</Button>
            <Button className='action-button delete-confirm-button' disabled={busy} onClick={restoreBackup}>确认覆盖并恢复</Button>
          </View>
        </View>}
      </View>

      <View className='methods-panel'>
        <View><Text className='section-kicker'>当前有效的方法</Text><Text className='panel-title'>{methods.length} 条方法</Text></View>
        {methods.length === 0 ? <View className='methods-empty'><Text>完成复盘时，可以把已验证的结论提炼成方法。</Text></View> : <View className='method-grid'>{methods.map((method) => {
          const history = methodHistories[method.id] ?? []
          const expanded = expandedMethodId === method.id
          return <View id={`method-${method.id}`} className={`method-card ${expanded ? 'history-open' : ''}`} key={method.id}>
            <View className='method-card-heading'><Text>{method.title}</Text><Text>v{method.version} · 验证 {method.validationCount} 次</Text></View>
            <Text className='method-label'>适用情况</Text><Text className='method-value'>{method.applicable}</Text>
            {method.unsuitable && <><Text className='method-label'>不适用情况</Text><Text className='method-value'>{method.unsuitable}</Text></>}
            <Text className='method-label'>具体步骤</Text><Text className='method-value'>{method.steps}</Text>
            <View className={`method-apply-button ${applyingMethodId === method.id ? 'active' : ''}`} onClick={() => openMethodApplication(method)}>
              <Text>{applyingMethodId === method.id ? '取消创建行动' : '用此方法开始行动'}</Text>
            </View>
            {applyingMethodId === method.id && <View className='method-apply-form'>
              <Input className='method-action-input' value={methodActionTitle} maxlength={120} placeholder='这次具体要完成什么' onInput={(event) => setMethodActionTitle(event.detail.value)} />
              <Textarea className='method-action-textarea' value={methodActionContent} maxlength={1000} placeholder='补充目标、场景或约束（可选）' onInput={(event) => setMethodActionContent(event.detail.value)} />
              <View className={`method-action-submit ${methodActionTitle.trim() && !busy ? '' : 'disabled'}`} onClick={() => methodActionTitle.trim() && !busy && createMethodAction(method)}><Text>创建到想试试</Text></View>
            </View>}
            <View className={`method-history-button ${expanded ? 'active' : ''}`} onClick={() => toggleMethodHistory(method.id)}>
              <Text>{expanded ? '收起版本历史' : `查看版本历史（${method.version}）`}</Text>
            </View>
            {expanded && <View className='method-history'>
              <Text className='method-history-title'>演化轨迹与复盘证据</Text>
              {[...history].reverse().map((version) => {
                const sourceReview = version.sourceReviewId ? historyReviews[version.sourceReviewId] : undefined
                return <View className='method-version' key={version.id}>
                  <View className='method-version-heading'><Text>v{version.version}</Text><Text>{formatTime(version.createdAt)}</Text></View>
                  <Text className='method-label'>方法名称</Text><Text className='method-value'>{version.title}</Text>
                  <Text className='method-label'>适用情况</Text><Text className='method-value'>{version.applicable}</Text>
                  {version.unsuitable && <><Text className='method-label'>不适用情况</Text><Text className='method-value'>{version.unsuitable}</Text></>}
                  <Text className='method-label'>具体步骤</Text><Text className='method-value'>{version.steps}</Text>
                  <View className='method-version-evidence'>
                    <Text className='method-label'>来源复盘</Text>
                    {sourceReview
                      ? <><Text>实际行动：{sourceReview.actualAction}</Text><Text>结果：{sourceReview.result}</Text></>
                      : <Text className='muted'>{version.sourceReviewId ? '来源复盘当前不可用' : '历史迁移快照，无来源复盘记录'}</Text>}
                  </View>
                </View>
              })}
            </View>}
          </View>
        })}</View>}
      </View>
    </View>
  )
}
