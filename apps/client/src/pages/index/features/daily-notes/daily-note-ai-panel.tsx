import { useEffect, useRef, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import type { DailyNote, DailyNoteAiCommand, Item } from '@knowledge-base/contracts'
import { apiClient } from '../../api-client'
import { ExperimentalAiMarkdown } from '../../experimental-ai/components/experimental-ai-markdown'

const actions: Array<[DailyNoteAiCommand, string]> = [['emotion', '梳理今日情绪'], ['extract_todos', '提取待办']]
type Candidate = { id: string; title: string; content?: string; creating?: boolean; error?: string }
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; status?: 'streaming' | 'done' | 'error' }

const normalizeAssistantContent = (content: string) => content.replace(/^(?:[ \t]*\r?\n)+/, '')

export function DailyNoteAiPanel({ note, draft, onAppend, onReplace, onAbortReady, onItemsChanged, onItemCreated }: { note?: DailyNote; draft: string; onAppend: (content: string) => Promise<boolean>; onReplace: (content: string) => Promise<boolean>; onAbortReady: (abort: () => void) => void; onItemsChanged?: () => Promise<void>; onItemCreated?: (item: Item) => void }) {
  const abortRef = useRef<AbortController>(); const activeNote = useRef<string>(); const requestId = useRef(0)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [input, setInput] = useState(''); const [running, setRunning] = useState(false); const [error, setError] = useState(''); const [candidates, setCandidates] = useState<Candidate[]>([]); const [todoExtractionDone, setTodoExtractionDone] = useState(false)
  const stop = () => { requestId.current += 1; abortRef.current?.abort(); abortRef.current = undefined; setRunning(false) }
  useEffect(() => { onAbortReady(stop); return stop }, [onAbortReady])
  useEffect(() => { if (!messages.length) return; window.requestAnimationFrame(() => { const node = messagesRef.current; if (node) node.scrollTop = node.scrollHeight }) }, [messages.length])
  useEffect(() => {
    stop(); setMessages([]); setInput(''); setError(''); setCandidates([]); setTodoExtractionDone(false); activeNote.current = note?.id
    if (!note) return
    const currentId = note.id
    void apiClient.getDailyNoteAiConversation(currentId).then(snapshot => { if (activeNote.current !== currentId) return; setMessages(snapshot.messages.map(message => ({ id: message.id, role: message.role, content: message.role === 'assistant' ? normalizeAssistantContent(message.content) : message.content, status: message.status === 'error' ? 'error' : 'done' }))) }).catch(() => undefined)
  }, [note?.id])
  const updateAssistant = (id: string, content: string, status: ChatMessage['status'] = 'streaming') => setMessages(list => list.map(message => message.id === id ? { ...message, content, status } : message))
  const run = async (command: DailyNoteAiCommand) => {
    if (!note || running) return
    const label = actions.find(([code]) => code === command)?.[1] ?? command; stop(); const controller = new AbortController(); const currentRequest = requestId.current + 1; requestId.current = currentRequest; abortRef.current = controller; activeNote.current = note.id
    const userId = `command-user-${Date.now()}`; const assistantId = `command-assistant-${Date.now()}`
    setMessages(list => [...list, { id: userId, role: 'user', content: label, status: 'done' }, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }]); setRunning(true); setError(''); setCandidates([]); setTodoExtractionDone(command === 'extract_todos')
    try {
      if (command === 'extract_todos') {
        const entries = await apiClient.extractDailyNoteTodos(note.id, draft, controller.signal)
        if (controller.signal.aborted || activeNote.current !== note.id || requestId.current !== currentRequest) return
        setCandidates(entries); updateAssistant(assistantId, entries.length ? `已提取 ${entries.length} 条待办候选，请确认后创建。` : '未识别到可执行待办。', 'done'); return
      }
      let output = ''
      for await (const event of apiClient.streamDailyNoteAi(note.id, command, draft, controller.signal)) { if (controller.signal.aborted || activeNote.current !== note.id || requestId.current !== currentRequest) return; if (event.type === 'token') { output += event.content; updateAssistant(assistantId, normalizeAssistantContent(output)) }; if (event.type === 'error') setError(event.message) }
      updateAssistant(assistantId, normalizeAssistantContent(output), 'done')
    } catch (cause) { if (!controller.signal.aborted && activeNote.current === note.id) { setError(cause instanceof Error ? cause.message : 'AI 请求失败'); updateAssistant(assistantId, 'AI 暂时无法完成这次复盘。', 'error') } }
    finally { if (abortRef.current === controller) abortRef.current = undefined; if (activeNote.current === note.id && requestId.current === currentRequest) setRunning(false) }
  }
  const send = async () => {
    const content = input.trim(); if (!note || !content || running) return
    stop(); const controller = new AbortController(); const currentRequest = requestId.current + 1; requestId.current = currentRequest; abortRef.current = controller; activeNote.current = note.id
    const userId = `user-${Date.now()}`; const assistantId = `assistant-${Date.now()}`; setInput(''); setError(''); setCandidates([]); setTodoExtractionDone(false); setMessages(list => [...list, { id: userId, role: 'user', content, status: 'done' }, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }]); setRunning(true)
    try { let output = ''; for await (const event of apiClient.streamDailyNoteAiChat(note.id, content, draft, controller.signal)) { if (controller.signal.aborted || activeNote.current !== note.id || requestId.current !== currentRequest) return; if (event.type === 'token') { output += event.content; updateAssistant(assistantId, normalizeAssistantContent(output)) }; if (event.type === 'error') setError(event.message) }; updateAssistant(assistantId, normalizeAssistantContent(output), 'done') }
    catch (cause) { if (!controller.signal.aborted && activeNote.current === note.id) { setError(cause instanceof Error ? cause.message : 'AI 请求失败'); updateAssistant(assistantId, 'AI 暂时无法完成这次复盘。', 'error') } }
    finally { if (abortRef.current === controller) abortRef.current = undefined; if (activeNote.current === note.id && requestId.current === currentRequest) setRunning(false) }
  }
  const create = async (candidate: Candidate) => {
    if (candidate.creating) return
    setCandidates(list => list.map(entry => entry.id === candidate.id ? { ...entry, creating: true, error: undefined } : entry))
    try { const created = await apiClient.createIdea({ title: candidate.title, content: candidate.content }); onItemCreated?.(created); await onItemsChanged?.(); window.dispatchEvent(new CustomEvent('knowledge-base-items-changed')); setCandidates(list => list.filter(entry => entry.id !== candidate.id)) }
    catch (cause) { setCandidates(list => list.map(entry => entry.id === candidate.id ? { ...entry, creating: false, error: cause instanceof Error ? cause.message : '创建失败' } : entry)) }
  }
  const hasMessages = messages.length > 0
  const handleInput = (event: { detail: { value: string } }) => setInput(event.detail.value)
  const handleKeyDown = (event: any) => {
    const nativeEvent = event.nativeEvent ?? event.detail?.event ?? event
    const isComposing = Boolean(event.isComposing || nativeEvent.isComposing || event.nativeEvent?.isComposing || event.key === 'Process' || nativeEvent.key === 'Process')
    const key = event.key ?? nativeEvent.key ?? event.detail?.key
    const keyCode = event.keyCode ?? nativeEvent.keyCode ?? event.detail?.keyCode
    if (isComposing || (key !== 'Enter' && keyCode !== 13) || event.shiftKey || nativeEvent.shiftKey) return
    event.preventDefault?.()
    event.stopPropagation?.()
    void send()
  }
  return <View className={`daily-notes-ai-panel ${hasMessages ? 'has-messages' : 'is-empty'}`}>
    <View className='daily-note-ai-heading'><View><Text>AI 复盘助手</Text><Text>自动读取当前日记 + 今日全部行动生成复盘</Text></View>{running && <Button onClick={stop}>停止</Button>}</View>
    {hasMessages && <View className='daily-note-ai-actions'>{actions.map(([code, label]) => <Button key={code} className='control-transition' disabled={!note || running} onClick={() => void run(code)}>{label}</Button>)}</View>}
    <View ref={messagesRef as any} className='daily-note-ai-messages'>
      {!hasMessages && !running && <View className='daily-note-ai-empty-state'><Text className='daily-note-ai-empty-title'>从今天的记录开始复盘</Text><Text className='daily-note-ai-empty'>输入一个问题，AI 会结合当前手记和今日行动回答。</Text></View>}
      {messages.map(message => <View key={message.id} className={`daily-note-ai-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}><View className='daily-note-ai-message-bubble'>{message.role === 'assistant' ? <ExperimentalAiMarkdown content={message.content || (message.status === 'streaming' ? '正在思考…' : '')} /> : <Text>{message.content}</Text>}</View></View>)}
      {candidates.length > 0 && <View className='daily-note-ai-candidates'>{candidates.map(candidate => <View key={candidate.id} className='daily-note-ai-candidate'><Input value={candidate.title} maxlength={120} onInput={event => setCandidates(list => list.map(entry => entry.id === candidate.id ? { ...entry, title: event.detail.value } : entry))} /><Text>{candidate.content || '创建为“想试试”事项'}</Text>{candidate.error && <Text>{candidate.error}</Text>}<Button className='control-transition' disabled={candidate.creating || !candidate.title.trim()} onClick={() => void create(candidate)}>{candidate.creating ? '创建中...' : candidate.error ? '重试创建' : '确认创建'}</Button></View>)}</View>}
    </View>
    {error && <Text className='daily-note-ai-error'>{error}</Text>}
    <View className={`daily-note-ai-composer ${hasMessages ? 'is-bottom' : 'is-centered'}`}><textarea className='daily-note-ai-input' value={input} maxLength={10000} placeholder='输入你想复盘的问题...' onInput={event => setInput(event.currentTarget.value)} onKeyDown={handleKeyDown} /><Button className='daily-note-ai-send' disabled={!note || running || !input.trim()} onClick={() => void send()}>{running ? '停止' : '发送'}</Button></View>
  </View>
}
