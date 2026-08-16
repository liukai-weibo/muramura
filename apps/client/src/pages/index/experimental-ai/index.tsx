import { useEffect, useRef, useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import type { AiChatMessage, AiConversation, AiConversationSnapshot } from '@knowledge-base/contracts'
import { apiClient } from '../api-client'
import { Bubble, BubbleContent } from './components/experimental-ai-bubble'
import { Message, MessageContent, MessageGroup } from './components/experimental-ai-message'
import { ExperimentalAiMessageList } from './components/experimental-ai-message-list'
import { ExperimentalAiMarkdown } from './components/experimental-ai-markdown'
import { ExperimentalAiMascot } from './components/experimental-ai-mascot'
import { ExperimentalAiThinkingIndicator } from './components/experimental-ai-thinking-indicator'
import { ExperimentalAiStreamSurface } from './components/experimental-ai-stream-surface'
import type { ExperimentalAiStreamSurfaceHandle } from './components/experimental-ai-stream-surface.types'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; status?: 'streaming' | 'done' | 'incomplete' | 'aborted' | 'error'; sequence?: number }
type ConversationView = { messages: ChatMessage[]; hasMoreBefore: boolean; oldestSequence?: number; loadingOlder: boolean; isGenerating: boolean; hasReceivedToken: boolean; error?: string }

const MAX_CONTEXT_MESSAGES = 30
const MAX_CONTEXT_CHARACTERS = 12000
const MAX_CONTEXT_TOKENS = 6000
const DRAFT_TITLE = '发起新会话'
const emptyView = (): ConversationView => ({ messages: [], hasMoreBefore: false, loadingOlder: false, isGenerating: false, hasReceivedToken: false })
const toView = (snapshot: AiConversationSnapshot): ConversationView => ({ messages: snapshot.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, status: message.status === 'completed' ? 'done' : message.status, sequence: message.sequence })), hasMoreBefore: Boolean(snapshot.hasMoreBefore), oldestSequence: snapshot.messages[0]?.sequence, loadingOlder: false, isGenerating: false, hasReceivedToken: false })
const estimatedTokens = (value: string) => Math.max(1, Math.ceil(Array.from(value).length / 4))
const isDefaultTitle = (title: string) => title === '新会话' || title === '默认会话'
const titleFromFirstMessage = (content: string) => { const chars = Array.from(content.trim()); return chars.slice(0, 40).join('') + (chars.length > 40 ? '…' : '') }
const readableStreamError = (error: unknown) => { const message = error instanceof Error ? error.message : ''; return message.includes('provider request failed') || message.includes('AI stream failed') ? 'AI 服务暂时中断，已保留当前内容，请稍后继续。' : message || 'AI 回复失败' }
function limitChatContext(messages: Array<{ role: string; content: string }>): AiChatMessage[] { const selected: AiChatMessage[] = []; let chars = 0; let tokens = 0; for (let index = messages.length - 1; index >= 0 && selected.length < MAX_CONTEXT_MESSAGES; index -= 1) { const message = messages[index]!; const nextChars = chars + Array.from(message.content).length; const nextTokens = tokens + estimatedTokens(message.content); if (selected.length > 0 && (nextChars > MAX_CONTEXT_CHARACTERS || nextTokens > MAX_CONTEXT_TOKENS)) break; selected.unshift({ role: message.role as 'user' | 'assistant', content: message.content }); chars = nextChars; tokens = nextTokens } return selected }

export default function ExperimentalAiPage() {
  const [input, setInput] = useState('')
  const [conversations, setConversations] = useState<AiConversation[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [draftActive, setDraftActive] = useState(true)
  const [draftError, setDraftError] = useState<string>()
  const [startingConversation, setStartingConversation] = useState(false)
  const [views, setViews] = useState<Record<string, ConversationView>>({})
  const viewsRef = useRef(views)
  viewsRef.current = views
  const aborts = useRef(new Map<string, AbortController>())
  const pendingStreamChunks = useRef(new Map<string, string>())
  const streamFlushTimers = useRef(new Map<string, number>())
  const streamContents = useRef(new Map<string, string>())
  const streamGenerationIds = useRef(new Map<string, number>())
  const streamSurfaces = useRef(new Map<string, ExperimentalAiStreamSurfaceHandle>())
  const tokenReceived = useRef(new Set<string>())
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string>()
  const [pendingDelete, setPendingDelete] = useState<AiConversation>()
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const [welcomeVisible, setWelcomeVisible] = useState(true)
  const [welcomeDismissing, setWelcomeDismissing] = useState(false)
  const welcomeDismissTimer = useRef<number>()

  const updateView = (id: string, updater: (current: ConversationView) => ConversationView) => setViews((current) => ({ ...current, [id]: updater(current[id] ?? emptyView()) }))
  const focusComposer = () => { window.setTimeout(() => inputRef.current?.focus(), 0) }
  const loadConversation = async (id: string) => { if (viewsRef.current[id]) return; try { const snapshot = await apiClient.getExperimentalAiConversationById(id, { limit: 40 }); updateView(id, () => toView(snapshot)) } catch { updateView(id, (current) => ({ ...current, error: '会话加载失败' })) } }
  const resolveVisibleConversations = async (items: AiConversation[]) => (await Promise.all(items.filter((item) => !item.deletedAt && !item.archivedAt).map(async (item) => { if (!isDefaultTitle(item.title)) return item; try { const snapshot = await apiClient.getExperimentalAiConversationById(item.id, { limit: 1 }); return snapshot.messages.length > 0 ? item : undefined } catch { return item } }))).filter((item): item is AiConversation => Boolean(item))

  useEffect(() => { let active = true; void apiClient.listAiConversations().then(async (items) => { const available = await resolveVisibleConversations(items); if (!active) return; setConversations(available); setDraftActive(true); setActiveId(undefined) }).catch(() => undefined); return () => { active = false; aborts.current.forEach((controller) => controller.abort()); streamFlushTimers.current.forEach((timer) => window.clearTimeout(timer)); streamFlushTimers.current.clear(); pendingStreamChunks.current.clear(); streamSurfaces.current.clear() } }, [])
  useEffect(() => () => { if (welcomeDismissTimer.current !== undefined) window.clearTimeout(welcomeDismissTimer.current) }, [])
  useEffect(() => { const closeMenu = () => setOpenMenuId(undefined); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu() }; document.addEventListener('click', closeMenu); document.addEventListener('keydown', closeOnEscape); return () => { document.removeEventListener('click', closeMenu); document.removeEventListener('keydown', closeOnEscape) } }, [])
  useEffect(() => { if (!pendingDelete) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !deleteSubmitting) setPendingDelete(undefined) }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [pendingDelete, deleteSubmitting])

  const activeView = activeId ? views[activeId] ?? emptyView() : emptyView()
  const activateDraft = () => { if (welcomeDismissTimer.current !== undefined) window.clearTimeout(welcomeDismissTimer.current); setWelcomeVisible(true); setWelcomeDismissing(false); setInput(''); setDraftActive(true); setActiveId(undefined); setDraftError(undefined); setOpenMenuId(undefined); setDrawerOpen(false); focusComposer() }
  const selectConversation = async (id: string) => { setOpenMenuId(undefined); setDraftActive(false); setActiveId(id); setDrawerOpen(false); await loadConversation(id) }
  const deleteConversation = (conversation: AiConversation) => { setOpenMenuId(undefined); setDeleteError(undefined); setPendingDelete(conversation) }
  const confirmDeleteConversation = async () => {
    if (!pendingDelete || deleteSubmitting) return
    setDeleteSubmitting(true)
    setDeleteError(undefined)
    try {
      await apiClient.deleteAiConversation(pendingDelete.id)
      const remaining = conversations.filter((item) => item.id !== pendingDelete.id)
      setConversations(remaining)
      const wasActive = activeId === pendingDelete.id
      setPendingDelete(undefined)
      if (wasActive) {
        const next = remaining[0]
        if (next) void selectConversation(next.id)
        else activateDraft()
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除会话失败，请稍后重试')
    } finally {
      setDeleteSubmitting(false)
    }
  }
  const renameConversation = async (conversation: AiConversation) => { const title = window.prompt('修改会话标题', conversation.title); if (!title?.trim()) return; const updated = await apiClient.updateAiConversationTitle(conversation.id, title.trim()); setOpenMenuId(undefined); setConversations((current) => current.map((item) => item.id === updated.id ? updated : item)) }
  const loadOlder = async () => { if (!activeId || activeView.loadingOlder || !activeView.hasMoreBefore || !activeView.oldestSequence) return; const id = activeId; updateView(id, (current) => ({ ...current, loadingOlder: true })); try { const snapshot = await apiClient.getExperimentalAiConversationById(id, { limit: 20, beforeSequence: activeView.oldestSequence }); const older = toView(snapshot); updateView(id, (current) => ({ ...current, messages: [...older.messages.filter((message) => !current.messages.some((entry) => entry.id === message.id)), ...current.messages], hasMoreBefore: older.hasMoreBefore, oldestSequence: older.oldestSequence ?? current.oldestSequence, loadingOlder: false })) } catch { updateView(id, (current) => ({ ...current, loadingOlder: false })) } }

  const send = async () => {
    const content = input.trim()
    if (!content || activeView.isGenerating || (draftActive && startingConversation)) return
    let id = activeId
    let previousMessages: ChatMessage[] = id ? (viewsRef.current[id]?.messages ?? []) : []
    if (draftActive && welcomeVisible) { setWelcomeDismissing(true); if (welcomeDismissTimer.current !== undefined) window.clearTimeout(welcomeDismissTimer.current); welcomeDismissTimer.current = window.setTimeout(() => { welcomeDismissTimer.current = undefined; setWelcomeVisible(false) }, 180) }
    setInput(''); setDraftError(undefined)
    if (!id && draftActive) { setStartingConversation(true); try { const created = await apiClient.createAiConversation(); id = created.id; previousMessages = []; setConversations((current) => [{ ...created, title: titleFromFirstMessage(content) }, ...current]); setActiveId(id); setDraftActive(false); updateView(id, emptyView) } catch (error) { setDraftError(error instanceof Error ? error.message : '无法创建会话'); setStartingConversation(false); return } }
    if (!id) return
    const userId = `user-${Date.now()}`
    const assistantId = `assistant-${Date.now()}`
    const generationId = (streamGenerationIds.current.get(id) ?? 0) + 1
    streamGenerationIds.current.set(id, generationId)
    const controller = new AbortController()
    aborts.current.set(id, controller)
    streamContents.current.set(id, '')
    tokenReceived.current.delete(id)
    updateView(id, (current) => ({ ...current, isGenerating: true, hasReceivedToken: false, error: undefined, messages: [...current.messages, { id: userId, role: 'user', content, status: 'done' }, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }] }))
    const flushStream = () => { const chunk = pendingStreamChunks.current.get(id!); if (!chunk) return; pendingStreamChunks.current.delete(id!); streamContents.current.set(id!, `${streamContents.current.get(id!) ?? ''}${chunk}`); streamSurfaces.current.get(id!)?.append(chunk) }
    const queueStreamChunk = (chunk: string) => { if (!tokenReceived.current.has(id!)) { tokenReceived.current.add(id!); updateView(id!, (current) => ({ ...current, hasReceivedToken: true })) }; pendingStreamChunks.current.set(id!, `${pendingStreamChunks.current.get(id!) ?? ''}${chunk}`); if (streamFlushTimers.current.has(id!)) return; streamFlushTimers.current.set(id!, window.setTimeout(() => { streamFlushTimers.current.delete(id!); flushStream() }, 32)) }
    const history = limitChatContext([...previousMessages, { role: 'user', content }].map(({ role, content: text }) => ({ role, content: text })))
    try { let done = false; let incomplete = false; for await (const event of apiClient.streamExperimentalAiChat(history, controller.signal, id)) { if (event.type === 'token' && event.content) queueStreamChunk(event.content); if (event.type === 'error') throw new Error(event.message ?? 'AI stream failed'); if (event.type === 'done') done = true; if (event.type === 'incomplete') incomplete = true }; const timer = streamFlushTimers.current.get(id); if (timer !== undefined) { window.clearTimeout(timer); streamFlushTimers.current.delete(id) }; flushStream(); if (!done && !incomplete) throw new Error('AI stream ended before completion'); const finalContent = streamContents.current.get(id) ?? ''; streamSurfaces.current.get(id)?.flush(); updateView(id, (current) => ({ ...current, isGenerating: false, messages: current.messages.map((message) => message.id === assistantId ? { ...message, content: finalContent, status: incomplete ? 'incomplete' : 'done' } : message) })) } catch (error) { const timer = streamFlushTimers.current.get(id); if (timer !== undefined) { window.clearTimeout(timer); streamFlushTimers.current.delete(id) }; flushStream(); streamSurfaces.current.get(id)?.flush(); const finalContent = streamContents.current.get(id) ?? ''; updateView(id, (current) => ({ ...current, isGenerating: false, error: controller.signal.aborted ? undefined : readableStreamError(error), messages: current.messages.map((message) => message.id === assistantId ? { ...message, status: controller.signal.aborted ? 'aborted' : 'error', content: finalContent || (controller.signal.aborted ? '已停止生成' : '暂时无法获取回复') } : message) })) } finally { pendingStreamChunks.current.delete(id); aborts.current.delete(id); setStartingConversation(false) }
  }
  const stop = () => { if (!activeId) return; aborts.current.get(activeId)?.abort(); updateView(activeId, (current) => ({ ...current, isGenerating: false })) }

  const renderAssistant = (message: ChatMessage, showMentor = false) => {
    if (message.status === 'streaming' && activeId) {
      if (activeView.hasReceivedToken) return <ExperimentalAiStreamSurface ref={(handle) => { if (handle) streamSurfaces.current.set(activeId, handle); else streamSurfaces.current.delete(activeId) }} initialContent={streamContents.current.get(activeId) ?? message.content} generationId={streamGenerationIds.current.get(activeId) ?? 0} isStreaming />
      return <View className="experimental-ai-thinking-row"><ExperimentalAiMascot compact isListening={false} isThinking sessionKind="existing" useRiveMascot generationId={streamGenerationIds.current.get(activeId) ?? 0} /><ExperimentalAiThinkingIndicator isGenerating hasReceivedToken={false} generationId={streamGenerationIds.current.get(activeId) ?? 0} /></View>
    }
    const mentor = showMentor ? <ExperimentalAiMascot compact isListening={false} isThinking={false} sessionKind="existing" useRiveMascot outcome="complete" generationId={streamGenerationIds.current.get(activeId ?? '')} /> : undefined
    return <ExperimentalAiMarkdown content={message.content} mentor={mentor} />
  }
  const renderMessage = (message: ChatMessage) => {
    const isAssistant = message.role === 'assistant'
    const isThinking = isAssistant && message.status === 'streaming' && !activeView.hasReceivedToken
    const latestAssistantId = [...activeView.messages].reverse().find((item) => item.role === 'assistant')?.id
    const isLatestCompletedAssistant = isAssistant && message.id === latestAssistantId && message.status === 'done'
    return <Message key={message.id} className={[isThinking ? 'experimental-ai-message-is-thinking' : '', isLatestCompletedAssistant ? 'experimental-ai-message-is-latest' : ''].filter(Boolean).join(' ')} align={isAssistant ? 'start' : 'end'}>
      <MessageContent className={isThinking ? 'experimental-ai-thinking-content' : ''}>
        {isThinking ? renderAssistant(message) : isAssistant ? renderAssistant(message, message.id === latestAssistantId && message.status === 'done') : <Bubble align="end" variant="secondary"><BubbleContent><Text>{message.content}</Text></BubbleContent></Bubble>}
      </MessageContent>
    </Message>
  }
  return <View className="experimental-ai-page">
    {draftActive && activeView.messages.length === 0 && welcomeVisible && <View className={`experimental-ai-welcome-mascot${welcomeDismissing ? ' is-dismissing' : ''}`}><ExperimentalAiMascot compact isListening={false} isThinking={false} sessionKind="new" persistentBubble useRiveMascot /></View>}
    <View className={`experimental-ai-conversation-drawer ${drawerOpen ? 'is-open' : ''}`} onClick={(event) => event.stopPropagation()}><View className="experimental-ai-conversation-list"><View className={`experimental-ai-conversation-row experimental-ai-draft-row ${draftActive ? 'is-active' : ''}`} onClick={activateDraft}><Text className="experimental-ai-conversation-title">{DRAFT_TITLE}</Text></View>{conversations.map((conversation) => <View key={conversation.id} className={`experimental-ai-conversation-row ${activeId === conversation.id ? 'is-active' : ''} ${openMenuId === conversation.id ? 'is-menu-open' : ''}`} onClick={() => void selectConversation(conversation.id)}><Text className="experimental-ai-conversation-title">{conversation.title}</Text>{views[conversation.id]?.isGenerating && <Text className="experimental-ai-generating">生成中</Text>}<Button className="experimental-ai-more" aria-label="会话操作" onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === conversation.id ? undefined : conversation.id) }}>⋯</Button>{openMenuId === conversation.id && <View className="experimental-ai-conversation-menu" onClick={(event) => event.stopPropagation()}><Button size="mini" onClick={() => void renameConversation(conversation)}>重命名</Button><Button size="mini" onClick={() => void deleteConversation(conversation)}>删除</Button></View>}</View>)}</View></View>
    <View className="experimental-ai-main"><View className="experimental-ai-toolbar"><Button className="experimental-ai-conversation-toggle" size="mini" onClick={(event) => { event.stopPropagation(); setDrawerOpen((value) => !value) }}>会话列表</Button><Text className="experimental-ai-title">{draftActive ? DRAFT_TITLE : conversations.find((conversation) => conversation.id === activeId)?.title ?? '新会话'}</Text></View><ExperimentalAiMessageList messages={activeView.messages} renderMessage={renderMessage} onReachTop={() => void loadOlder()} scrollKey={`${activeId ?? 'draft'}:${activeView.messages.length}`} /><View className="experimental-ai-composer-shell"><View className="experimental-ai-composer" style={{ width: '100%', minWidth: 0 }}><textarea ref={inputRef} className="experimental-ai-input taro-textarea" style={{ display: 'block', width: '100%', minWidth: 0, flex: '1 1 auto', boxSizing: 'border-box' }} value={input} maxLength={MAX_CONTEXT_CHARACTERS} onInput={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="输入你想复盘的问题" /><Button className="experimental-ai-send-button" disabled={!activeView.isGenerating && !input.trim()} aria-label={activeView.isGenerating ? '停止生成' : '发送消息'} onClick={activeView.isGenerating ? stop : () => void send()}>{activeView.isGenerating ? '停止生成' : '发送'}</Button></View></View>{(activeView.error || draftError) && <Text className="experimental-ai-error">{activeView.error ?? draftError}</Text>}</View>
    {pendingDelete && <View className="experimental-ai-delete-backdrop" onClick={() => !deleteSubmitting && setPendingDelete(undefined)}><View className="experimental-ai-delete-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><Text className="experimental-ai-delete-title">删除会话？</Text><Text className="experimental-ai-delete-description">确定删除“{pendingDelete.title}”吗？删除后无法恢复。</Text>{deleteError && <Text className="experimental-ai-delete-error">{deleteError}</Text>}<View className="experimental-ai-delete-actions"><Button className="experimental-ai-delete-cancel" disabled={deleteSubmitting} onClick={() => setPendingDelete(undefined)}>取消</Button><Button className="experimental-ai-delete-confirm" disabled={deleteSubmitting} onClick={() => void confirmDeleteConversation()}>{deleteSubmitting ? '正在删除…' : '确认删除'}</Button></View></View></View>}
  </View>
}
