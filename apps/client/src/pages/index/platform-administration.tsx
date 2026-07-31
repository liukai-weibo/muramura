import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { PlatformUserPage, PlatformUserSummary } from '@knowledge-base/contracts'
import { apiClient, isApiClientAbort, type ApiClientError } from './api-client'
import {
  acceptPlatformUserQueryDraft,
  createRoleUnknownFact,
  createOperationId,
  isConfirmationCompatible,
  isUnknownWriteError,
  platformErrorNotice,
  platformPageCount,
  platformRoleLabel,
  PlatformReadCoordinator,
  reconcileRoleUnknownRead,
  replacePlatformUser,
  rolesForAction,
  shouldApplyPlatformRead,
  unknownTargetState,
  type PlatformAdministrationAction,
  type PlatformAdministrationConfirmation,
  type PlatformAdministrationNotice,
  type PlatformTargetWriteState,
  type RoleUnknownFact,
} from './platform-administration-state'

type ListState = 'initial-loading' | 'ready' | 'refreshing' | 'initial-error' | 'refresh-error'

interface PlatformAdministrationProps {
  authenticationContext: string
  currentUserId: string
  visible: boolean
}

function formatRegistrationTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function confirmationCopy(confirmation: PlatformAdministrationConfirmation): { title: string; description: string; confirm: string; dangerous: boolean } {
  if (confirmation.action === 'grant-role') return {
    title: `授予“${confirmation.targetUsername}”平台管理员权限？`,
    description: '授予后，该用户可以进入用户管理、调整其他用户的平台管理员角色，并撤销他人的登录会话。不会获得查看其他用户业务数据的权限。',
    confirm: '确认授予',
    dangerous: false,
  }
  if (confirmation.action === 'revoke-role') return {
    title: `撤销“${confirmation.targetUsername}”的平台管理员权限？`,
    description: '该用户仍保留成员身份及自己的业务数据，但之后不能继续进入用户管理。此操作不会撤销其登录会话。',
    confirm: '撤销管理员',
    dangerous: true,
  }
  return {
    title: `撤销“${confirmation.targetUsername}”的全部登录会话？`,
    description: '该用户当前所有有效登录会话都会失效，需要重新登录。角色、账号和业务数据不会改变。',
    confirm: '撤销全部会话',
    dangerous: true,
  }
}

export function PlatformAdministration({ authenticationContext, currentUserId, visible }: PlatformAdministrationProps) {
  const [snapshot, setSnapshot] = useState<PlatformUserPage>()
  const snapshotRef = useRef<PlatformUserPage>()
  const [listState, setListState] = useState<ListState>('initial-loading')
  const [queryDraft, setQueryDraft] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [listNotice, setListNotice] = useState<PlatformAdministrationNotice>()
  const [targetNotices, setTargetNotices] = useState<Record<string, PlatformAdministrationNotice>>({})
  const [confirmation, setConfirmation] = useState<PlatformAdministrationConfirmation>()
  const confirmationRef = useRef<PlatformAdministrationConfirmation>()
  const [openMenuId, setOpenMenuId] = useState<string>()
  const [targetLocks, setTargetLocks] = useState<Record<string, PlatformTargetWriteState>>({})
  const targetLocksRef = useRef<Record<string, PlatformTargetWriteState>>({})
  const occupiedTargetsRef = useRef(new Set<string>())
  const writeAttemptsRef = useRef(new Map<string, symbol>())
  const roleUnknownFactsRef = useRef(new Map<string, RoleUnknownFact>())
  const readAbortRef = useRef<AbortController>()
  const readGenerationRef = useRef(0)
  const readCoordinatorRef = useRef(new PlatformReadCoordinator())
  const factGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const authenticationContextRef = useRef(authenticationContext)

  const updateSnapshot = (next: PlatformUserPage | undefined) => {
    snapshotRef.current = next
    setSnapshot(next)
  }

  const updateLock = (targetId: string, state: PlatformTargetWriteState) => {
    const next = { ...targetLocksRef.current }
    if (state === 'idle') delete next[targetId]
    else next[targetId] = state
    targetLocksRef.current = next
    setTargetLocks(next)
  }

  const updateTargetNotice = (targetId: string, notice?: PlatformAdministrationNotice) => {
    setTargetNotices((current) => {
      const next = { ...current }
      if (notice) next[targetId] = notice
      else delete next[targetId]
      return next
    })
  }

  const clearConfirmation = () => {
    confirmationRef.current = undefined
    setConfirmation(undefined)
  }

  const readUsers = async (nextPage = page, nextQuery = appliedQuery) => {
    readAbortRef.current?.abort()
    const controller = new AbortController()
    readAbortRef.current = controller
    const generation = ++readGenerationRef.current
    const authentication = authenticationContextRef.current
    const factGeneration = factGenerationRef.current
    readCoordinatorRef.current.begin({ generation, authenticationContext: authentication, factGeneration })
    setListNotice(undefined)
    setListState(snapshotRef.current ? 'refreshing' : 'initial-loading')
    try {
      const result = await apiClient.listPlatformUsers({ page: nextPage, query: nextQuery || undefined }, controller.signal)
      if (!shouldApplyPlatformRead({
        mounted: mountedRef.current,
        aborted: controller.signal.aborted,
        requestGeneration: generation,
        currentGeneration: readGenerationRef.current,
        authenticationContext: authentication,
        currentAuthenticationContext: authenticationContextRef.current,
        factGeneration,
        currentFactGeneration: factGenerationRef.current,
      })) {
        if (mountedRef.current && !controller.signal.aborted && generation === readGenerationRef.current
          && authentication === authenticationContextRef.current && factGeneration !== factGenerationRef.current
          && readCoordinatorRef.current.complete(generation, authentication)) setListState(snapshotRef.current ? 'ready' : 'initial-loading')
        return
      }

      const reconciliation = reconcileRoleUnknownRead(result, roleUnknownFactsRef.current, factGeneration)
      updateSnapshot(reconciliation.snapshot)
      for (const { targetId } of reconciliation.resolved) {
        roleUnknownFactsRef.current.delete(targetId)
        updateLock(targetId, 'idle')
        updateTargetNotice(targetId)
      }
      if (readCoordinatorRef.current.complete(generation, authentication)) setListState('ready')
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || generation !== readGenerationRef.current || authentication !== authenticationContextRef.current) return
      if (!readCoordinatorRef.current.complete(generation, authentication)) return
      if (isApiClientAbort(error)) {
        setListState(snapshotRef.current ? 'ready' : 'initial-error')
        if (!snapshotRef.current) setListNotice({ kind: 'error', message: '用户列表读取已取消。' })
        return
      }
      setListState(snapshotRef.current ? 'refresh-error' : 'initial-error')
      setListNotice(platformErrorNotice(error, '无法读取用户列表。'))
    }
  }

  useEffect(() => {
    mountedRef.current = true
    authenticationContextRef.current = authenticationContext
    void readUsers(1, '')
    return () => {
      mountedRef.current = false
      readGenerationRef.current += 1
      readCoordinatorRef.current.reset()
      readAbortRef.current?.abort()
      occupiedTargetsRef.current.clear()
      writeAttemptsRef.current.clear()
      roleUnknownFactsRef.current.clear()
    }
  }, [authenticationContext])

  useEffect(() => {
    if (!confirmation) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const lock = targetLocksRef.current[confirmation.targetId]
      if (lock === 'submitting-role' || lock === 'submitting-sessions') return
      if (confirmation.returnToSessionsUnknown) updateLock(confirmation.targetId, 'sessions-unknown')
      clearConfirmation()
    }
    globalThis.addEventListener?.('keydown', onKeyDown)
    return () => globalThis.removeEventListener?.('keydown', onKeyDown)
  }, [confirmation])

  useEffect(() => {
    if (!openMenuId) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenuId(undefined) }
    globalThis.addEventListener?.('keydown', onKeyDown)
    return () => globalThis.removeEventListener?.('keydown', onKeyDown)
  }, [openMenuId])

  const openConfirmation = (target: PlatformUserSummary, action: PlatformAdministrationAction, returnToSessionsUnknown = false) => {
    const lock = targetLocksRef.current[target.id]
    if (target.id === currentUserId || (lock && !(returnToSessionsUnknown && lock === 'sessions-unknown'))) return
    const next: PlatformAdministrationConfirmation = {
      targetId: target.id,
      targetUsername: target.username,
      expectedRoles: [...target.roles],
      action,
      returnToSessionsUnknown,
    }
    confirmationRef.current = next
    setConfirmation(next)
    setOpenMenuId(undefined)
  }

  const closeConfirmation = () => {
    const current = confirmationRef.current
    if (!current) return
    const lock = targetLocksRef.current[current.targetId]
    if (lock === 'submitting-role' || lock === 'submitting-sessions') return
    if (current.returnToSessionsUnknown) updateLock(current.targetId, 'sessions-unknown')
    clearConfirmation()
  }

  const submitConfirmation = async () => {
    const current = confirmationRef.current
    if (!current || occupiedTargetsRef.current.has(current.targetId)) return
    if (!isConfirmationCompatible(current, snapshotRef.current, currentUserId)) {
      clearConfirmation()
      updateTargetNotice(current.targetId, { kind: 'error', message: '目标事实已变化，请刷新列表后重新操作。', refreshSuggested: true })
      return
    }
    const lastConfirmedSummary = snapshotRef.current!.items.find((item) => item.id === current.targetId)!
    occupiedTargetsRef.current.add(current.targetId)
    const operationId = createOperationId()
    if (!operationId) {
      occupiedTargetsRef.current.delete(current.targetId)
      updateTargetNotice(current.targetId, { kind: 'error', message: '当前浏览器无法生成安全操作标识，未发送请求。' })
      return
    }
    const attempt = Symbol(current.action)
    writeAttemptsRef.current.set(current.targetId, attempt)
    factGenerationRef.current += 1
    if (readCoordinatorRef.current.supersedeByWrite(authenticationContextRef.current, factGenerationRef.current)) {
      setListState(snapshotRef.current ? 'ready' : 'initial-loading')
      setListNotice(undefined)
    }
    const roleAction = current.action !== 'revoke-sessions'
    updateLock(current.targetId, roleAction ? 'submitting-role' : 'submitting-sessions')
    updateTargetNotice(current.targetId)
    try {
      if (roleAction) {
        const roles = rolesForAction(current.action)!
        const result = await apiClient.setPlatformUserRoles(current.targetId, { roles, operationId })
        if (!mountedRef.current || authenticationContextRef.current !== authenticationContext || writeAttemptsRef.current.get(current.targetId) !== attempt) return
        const currentSnapshot = snapshotRef.current
        if (currentSnapshot) updateSnapshot(replacePlatformUser(currentSnapshot, result))
        updateLock(current.targetId, 'idle')
        updateTargetNotice(current.targetId, { kind: 'success', message: current.action === 'grant-role' ? '已授予平台管理员权限。' : '已撤销平台管理员权限。' })
      } else {
        const result = await apiClient.revokePlatformUserSessions(current.targetId, { operationId })
        if (!mountedRef.current || authenticationContextRef.current !== authenticationContext || writeAttemptsRef.current.get(current.targetId) !== attempt) return
        updateLock(current.targetId, 'idle')
        updateTargetNotice(current.targetId, { kind: 'success', message: result.revokedSessionCount > 0 ? `已撤销 ${result.revokedSessionCount} 个登录会话。` : '当前没有需要撤销的有效会话。' })
      }
      clearConfirmation()
    } catch (error) {
      if (!mountedRef.current || authenticationContextRef.current !== authenticationContext || writeAttemptsRef.current.get(current.targetId) !== attempt) return
      const apiError = error as ApiClientError
      if (apiError.status === 401 || apiError.status === 403) return
      if (isUnknownWriteError(error)) {
        const unknownState = unknownTargetState(current.action)
        updateLock(current.targetId, unknownState)
        if (roleAction) roleUnknownFactsRef.current.set(current.targetId, createRoleUnknownFact(lastConfirmedSummary, factGenerationRef.current))
        updateTargetNotice(current.targetId, { kind: 'unknown', message: roleAction ? '操作结果尚未确认。请显式刷新用户列表确认真实角色。' : '无法确认会话撤销是否完成。', requestId: apiError.requestId })
      } else {
        updateLock(current.targetId, 'idle')
        updateTargetNotice(current.targetId, platformErrorNotice(error, '管理操作失败。', apiError.status === 404 || apiError.status === 409))
      }
      clearConfirmation()
    } finally {
      if (writeAttemptsRef.current.get(current.targetId) === attempt) writeAttemptsRef.current.delete(current.targetId)
      occupiedTargetsRef.current.delete(current.targetId)
    }
  }

  const submitSearch = () => {
    const query = queryDraft.trim()
    setAppliedQuery(query)
    setPage(1)
    void readUsers(1, query)
  }

  const clearSearch = () => {
    setQueryDraft('')
    setAppliedQuery('')
    setPage(1)
    void readUsers(1, '')
  }

  const changePage = (nextPage: number) => {
    if (nextPage < 1 || listState === 'initial-loading' || listState === 'refreshing') return
    setPage(nextPage)
    void readUsers(nextPage, appliedQuery)
  }

  const refreshing = listState === 'refreshing'
  const reading = refreshing || listState === 'initial-loading'
  const pageCount = platformPageCount(snapshot?.total ?? 0)
  const confirmationContent = confirmation ? confirmationCopy(confirmation) : undefined

  return <View className={`platform-administration ${visible ? '' : 'platform-administration-hidden'}`}>
    <View className='platform-administration-header'>
      <View><Text className='platform-administration-title'>用户管理</Text><Text className='platform-administration-description'>管理平台管理员角色与用户登录会话</Text></View>
      <Button className='platform-administration-refresh' disabled={refreshing || listState === 'initial-loading'} onClick={() => void readUsers(page, appliedQuery)}>刷新</Button>
    </View>

    <View className='platform-administration-search'>
      <input
        aria-label='按用户名搜索'
        value={queryDraft}
        maxLength={80}
        disabled={reading}
        placeholder='按用户名搜索'
        onInput={(event) => {
          const nextValue = event.currentTarget.value
          setQueryDraft((current) => acceptPlatformUserQueryDraft(current, nextValue))
        }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !reading) submitSearch() }}
      />
      {queryDraft && <Button className='platform-administration-clear' disabled={reading} onClick={clearSearch}>清除</Button>}
      <Button className='platform-administration-search-button' disabled={reading} onClick={submitSearch}>搜索</Button>
    </View>

    {refreshing && <Text className='platform-administration-updating'>正在读取最新用户信息</Text>}
    {listState === 'refresh-error' && snapshot && <View className='platform-administration-error'><Text>以下为刷新前内容。{listNotice?.message}</Text>{listNotice?.requestId && <Text>requestId：{listNotice.requestId}</Text>}</View>}

    {listState === 'initial-loading' && !snapshot ? <View className='platform-administration-skeleton' aria-label='正在读取用户列表'>{Array.from({ length: 6 }, (_, index) => <View key={index} />)}</View>
      : listState === 'initial-error' && !snapshot ? <View className='platform-administration-initial-error'><Text>{listNotice?.message || '无法读取用户列表。'}</Text>{listNotice?.requestId && <Text>requestId：{listNotice.requestId}</Text>}<Button onClick={() => void readUsers(page, appliedQuery)}>重新加载</Button></View>
        : snapshot && <>
          {snapshot.items.length === 0 ? <View className='platform-administration-empty'>
            <Text>{appliedQuery ? `没有找到匹配“${appliedQuery}”的用户。` : snapshot.total === 0 ? '暂无用户。' : '当前页没有用户。'}</Text>
            {appliedQuery && <Button onClick={clearSearch}>清除搜索</Button>}
          </View> : <View className='platform-user-list'>
            <View className='platform-user-table-heading'><Text>用户名</Text><Text>角色</Text><Text>注册时间</Text><Text>操作</Text></View>
            {snapshot.items.map((user) => {
              const current = user.id === currentUserId
              const lock = targetLocks[user.id] ?? 'idle'
              const locked = lock !== 'idle'
              const notice = targetNotices[user.id]
              return <View className='platform-user-row' key={user.id}>
                <Text className='platform-user-name'>{user.username}</Text>
                <Text className={`platform-role-badge ${user.roles.length === 2 ? 'administrator' : 'member'}`}>{platformRoleLabel(user)}</Text>
                <Text className='platform-user-created'>注册于 {formatRegistrationTime(user.createdAt)}</Text>
                <View className='platform-user-actions'>
                  {current ? <Text className='platform-current-user'>当前账号</Text> : <>
                    {lock === 'role-unknown' && <Button className='platform-inline-action' onClick={() => void readUsers(page, appliedQuery)}>刷新用户列表</Button>}
                    {lock === 'sessions-unknown' && <Button className='platform-inline-action danger' onClick={() => openConfirmation(user, 'revoke-sessions', true)}>再次撤销会话</Button>}
                    {!locked && <Button {...{ role: 'button' }} className='platform-more-button' aria-label={`管理${user.username}`} onClick={() => setOpenMenuId((value) => value === user.id ? undefined : user.id)}>更多</Button>}
                    {openMenuId === user.id && !locked && <><View className='platform-menu-dismiss-layer' onClick={() => setOpenMenuId(undefined)} /><View className='platform-user-menu' onClick={(event) => event.stopPropagation()}>
                      <Button onClick={() => openConfirmation(user, user.roles.length === 2 ? 'revoke-role' : 'grant-role')}>{user.roles.length === 2 ? '撤销管理员' : '授予管理员'}</Button>
                      <View className='platform-user-menu-divider' />
                      <Button className='danger' onClick={() => openConfirmation(user, 'revoke-sessions')}>撤销全部会话</Button>
                    </View></>}
                  </>}
                </View>
                {notice && <View className={`platform-target-notice ${notice.kind}`}><Text>{notice.message}</Text>{notice.requestId && <Text>requestId：{notice.requestId}</Text>}{notice.refreshSuggested && <Button onClick={() => void readUsers(page, appliedQuery)}>刷新列表</Button>}</View>}
              </View>
            })}
          </View>}
          <View className='platform-administration-pagination'>
            <Text>共 {snapshot.total} 位用户</Text>
            <View><Button className={`platform-pagination-button ${page <= 1 || refreshing ? 'platform-pagination-button-disabled' : ''}`} disabled={page <= 1 || refreshing} onClick={() => changePage(page - 1)}>上一页</Button><Text>第 {page} / {pageCount} 页</Text><Button className={`platform-pagination-button ${page >= pageCount || refreshing ? 'platform-pagination-button-disabled' : ''}`} disabled={page >= pageCount || refreshing} onClick={() => changePage(page + 1)}>下一页</Button></View>
          </View>
        </>}

    {confirmation && confirmationContent && <View className='platform-confirmation-backdrop' onClick={closeConfirmation}>
      <View className='platform-confirmation' role='dialog' aria-modal='true' aria-label={confirmationContent.title} onClick={(event) => event.stopPropagation()}>
        <Text className='platform-confirmation-title'>{confirmationContent.title}</Text>
        <Text className='platform-confirmation-description'>{confirmationContent.description}</Text>
        <View className='platform-confirmation-actions'>
          <Button disabled={targetLocks[confirmation.targetId] === 'submitting-role' || targetLocks[confirmation.targetId] === 'submitting-sessions'} onClick={closeConfirmation}>取消</Button>
          <Button className={confirmationContent.dangerous ? 'danger' : 'primary'} disabled={targetLocks[confirmation.targetId] === 'submitting-role' || targetLocks[confirmation.targetId] === 'submitting-sessions'} onClick={() => void submitConfirmation()}>{targetLocks[confirmation.targetId]?.startsWith('submitting') ? '正在提交…' : confirmationContent.confirm}</Button>
        </View>
      </View>
    </View>}
  </View>
}
