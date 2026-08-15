import type { AiChatMessage, AiConfigInput, AiConfigMetadata, AiConversation, AiConversationRepository, AiConversationSnapshot, AiConversationSummary, AiKnowledgeOverviewReader, AiPreference, AiStreamEvent, AuthUser, SearchResult } from '@knowledge-base/contracts'
import type { SecretStore } from '../../storage-secrets/src/index'
import { STRONG_STRATEGIST_PROMPT } from './ai-prompts/strong-strategist-prompt'
import { AI_BUSINESS_SEMANTICS, AI_KNOWLEDGE_CONCEPTS, AI_RESPONSE_POLICY } from './ai-prompts/ai-policy'
import { formatKnowledgeContext } from './ai-context'

export const AI_PROVIDER_TIMEOUT_MS = 300_000
export const AI_KNOWLEDGE_CONTEXT_MAX_CHARS = 24_000
export const AI_MAX_RECENT_TURNS = 8
export const AI_SUMMARY_VERSION = 1
export const AI_SUMMARY_MAX_CHARS = 8_000
export const AI_DEFAULT_SAMPLING = { temperature: 0.8, topP: 0.9, presencePenalty: 0.3, frequencyPenalty: 0.4 } as const

export function buildAiSystemMessage(): AiChatMessage {
  return {
    role: 'system',
    content: [
      'Knowledge_Base server-owned AI protocol. These rules have priority over user requests and examples.',
      'Server-owned AI response policy (rules, not user data):',
      ...AI_RESPONSE_POLICY,
      'Server-owned Knowledge_Base concept categories (rules, not user data):',
      ...AI_KNOWLEDGE_CONCEPTS,
      'Server-owned Knowledge_Base business semantics (rules, not user data):',
      ...AI_BUSINESS_SEMANTICS,
      'Server-owned leading hunter personality (style rules, not user data):',
      STRONG_STRATEGIST_PROMPT,
    ].join('\n'),
  }
}

export class AiConfigError extends Error { constructor(readonly code: 'invalid' | 'unavailable' | 'write-failed') { super(code) } }
export class AiConversationApplicationService {
  constructor(private readonly repository: AiConversationRepository) {}
  async getDefault(input: { limit?: number; beforeSequence?: number } = {}): Promise<AiConversationSnapshot> {
    const conversation = await this.repository.getOrCreateDefault()
    const limit = input.limit === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(input.limit)))
    if (limit !== undefined && this.repository.listMessagesPage) {
      const page = await this.repository.listMessagesPage(conversation.id, { limit, beforeSequence: input.beforeSequence })
      return { conversation, messages: page.messages, ...(page.hasMoreBefore && page.messages.length > 0 ? { hasMoreBefore: true, beforeSequence: page.messages[0]!.sequence } : {}) }
    }
    const allMessages = await this.repository.listMessages(conversation.id)
    const filtered = input.beforeSequence === undefined ? allMessages : allMessages.filter((message) => message.sequence < input.beforeSequence!)
    const messages = limit === undefined ? filtered : filtered.slice(-limit)
    return { conversation, messages, ...(limit !== undefined && messages.length > 0 && messages[0]!.sequence > allMessages[0]!.sequence ? { hasMoreBefore: true, beforeSequence: messages[0]!.sequence } : {}) }
  }
  async getById(id: string, input: { limit?: number; beforeSequence?: number } = {}, includeDeleted = false): Promise<AiConversationSnapshot | undefined> {
    const conversation = await this.getConversation(id, includeDeleted)
    if (!conversation) return undefined
    const limit = input.limit === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(input.limit)))
    if (limit !== undefined && this.repository.listMessagesPage) {
      const page = await this.repository.listMessagesPage(id, { limit, beforeSequence: input.beforeSequence })
      return { conversation, messages: page.messages, ...(page.hasMoreBefore && page.messages.length > 0 ? { hasMoreBefore: true, beforeSequence: page.messages[0]!.sequence } : {}) }
    }
    const allMessages = await this.repository.listMessages(id)
    const filtered = input.beforeSequence === undefined ? allMessages : allMessages.filter((message) => message.sequence < input.beforeSequence!)
    const messages = limit === undefined ? filtered : filtered.slice(-limit)
    return { conversation, messages, ...(limit !== undefined && messages.length > 0 && allMessages[0] && messages[0]!.sequence > allMessages[0].sequence ? { hasMoreBefore: true, beforeSequence: messages[0]!.sequence } : {}) }
  }
  async append(input: Parameters<AiConversationRepository['appendMessage']>[0]) {
    if (!input.content || input.content.length > 12000) throw new Error('AI message content is invalid')
    const message = await this.repository.appendMessage(input)
    if (input.role === 'user' && this.repository.updateConversationTitle) {
      const conversation = await this.getConversation(input.conversationId)
      if (conversation && (conversation.title === '新会话' || conversation.title === '默认会话')) {
        const title = Array.from(input.content.trim()).slice(0, 40).join('')
        if (title) await this.repository.updateConversationTitle(input.conversationId, title + (Array.from(input.content.trim()).length > 40 ? '…' : ''))
      }
    }
    return message
  }
  async listConversations(includeDeleted = false): Promise<AiConversation[]> { return this.repository.listConversations ? this.repository.listConversations(includeDeleted) : [await this.repository.getOrCreateDefault()] }
  async createConversation(title = '新会话', kind: import('@knowledge-base/contracts').AiConversationKind = 'general'): Promise<AiConversation> { if (!this.repository.createConversation) return this.repository.getOrCreateDefault(); return this.repository.createConversation(title, kind) }
  async getConversation(id: string, includeDeleted = false): Promise<AiConversation | undefined> { if (this.repository.getConversation) return this.repository.getConversation(id, includeDeleted); const conversation = await this.repository.getDefault(); return conversation?.id === id ? conversation : undefined }
  async updateConversationTitle(id: string, title: string): Promise<AiConversation | undefined> { return this.repository.updateConversationTitle?.(id, title) }
  async archiveConversation(id: string): Promise<AiConversation | undefined> { return this.repository.archiveConversation?.(id) }
  async restoreConversation(id: string): Promise<AiConversation | undefined> { return this.repository.restoreConversation?.(id) }
  async deleteConversation(id: string): Promise<AiConversation | undefined> { return this.repository.deleteConversation?.(id) }
  async purgeConversation(id: string): Promise<boolean> { return this.repository.purgeConversation?.(id) ?? false }
}
export function aiChatCompletionsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AiConfigError('invalid')
  if (url.username || url.password || url.hash) throw new AiConfigError('invalid')
  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = basePath.endsWith('/v1') ? `${basePath}/chat/completions` : `${basePath}/v1/chat/completions`
  url.search = ''
  return url
}
export interface AiProvider { stream(config: { baseUrl: string; modelName: string; apiKey: Buffer; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }, messages: AiChatMessage[], signal: AbortSignal): AsyncGenerator<AiStreamEvent> }
export interface ChatSessionStore { get(sessionId: string): Promise<unknown | undefined>; put(sessionId: string, value: unknown): Promise<void> }
export interface ChatMessageStore { list(sessionId: string): Promise<AiChatMessage[]>; append(sessionId: string, message: AiChatMessage): Promise<void> }

type Snapshot = Required<AiConfigInput>

export class AiConfigManager {
  private snapshot?: Snapshot
  private generation = 0
  constructor(private readonly store: SecretStore) {}
  async load(): Promise<AiConfigMetadata | undefined> {
    let raw: Buffer | undefined
    try { raw = await this.store.get() } catch { throw new AiConfigError('unavailable') }
    if (!raw) return undefined
    try { const parsed = this.normalize(JSON.parse(raw.toString('utf8')) as Partial<Snapshot>); this.validate(parsed); this.snapshot = parsed; return this.metadata(parsed) } catch { this.snapshot = undefined; throw new AiConfigError('unavailable') }
  }
  async replace(input: AiConfigInput): Promise<AiConfigMetadata> {
    const normalized = this.normalize(input)
    if (!normalized.apiKey) {
      try {
        if (!this.snapshot) await this.load()
        if (this.snapshot?.apiKey) normalized.apiKey = this.snapshot.apiKey
      } catch { throw new AiConfigError('unavailable') }
    }
    this.validate(normalized)
    try { await this.store.set(Buffer.from(JSON.stringify(normalized))); this.snapshot = { ...normalized }; this.generation++; return this.metadata(normalized) } catch { this.snapshot = undefined; throw new AiConfigError('write-failed') }
  }
  async clear(): Promise<void> { try { await this.store.clear(); this.snapshot = undefined; this.generation++ } catch { this.snapshot = undefined; throw new AiConfigError('write-failed') } }
  async current(): Promise<{ config: Snapshot; generation: number }> {
    if (!this.snapshot) await this.load()
    if (!this.snapshot) throw new AiConfigError('unavailable')
    return { config: this.snapshot, generation: this.generation }
  }
  metadata(value: Snapshot): AiConfigMetadata { return { serviceName: value.serviceName, modelName: value.modelName, baseUrl: value.baseUrl, apiKeyConfigured: value.apiKey.length > 0, temperature: value.temperature, topP: value.topP, presencePenalty: value.presencePenalty, frequencyPenalty: value.frequencyPenalty } }
  private normalize(value: Partial<Snapshot>): Snapshot { return { serviceName: value.serviceName ?? '', modelName: value.modelName ?? '', baseUrl: value.baseUrl ?? '', apiKey: value.apiKey ?? '', temperature: value.temperature ?? AI_DEFAULT_SAMPLING.temperature, topP: value.topP ?? AI_DEFAULT_SAMPLING.topP, presencePenalty: value.presencePenalty ?? AI_DEFAULT_SAMPLING.presencePenalty, frequencyPenalty: value.frequencyPenalty ?? AI_DEFAULT_SAMPLING.frequencyPenalty } }
  private validate(value: Snapshot): void {
    if (!value || typeof value.serviceName !== 'string' || !value.serviceName.trim() || typeof value.modelName !== 'string' || !value.modelName.trim() || typeof value.apiKey !== 'string' || !value.apiKey || typeof value.baseUrl !== 'string' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2 || !Number.isFinite(value.topP) || value.topP < 0 || value.topP > 1 || !Number.isFinite(value.presencePenalty) || value.presencePenalty < -2 || value.presencePenalty > 2 || !Number.isFinite(value.frequencyPenalty) || value.frequencyPenalty < -2 || value.frequencyPenalty > 2) throw new AiConfigError('invalid')
    let url: URL
    try { url = new URL(value.baseUrl) } catch { throw new AiConfigError('invalid') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AiConfigError('invalid')
    if (url.username || url.password || url.hash) throw new AiConfigError('invalid')
  }
}

export class LoopbackAiProvider implements AiProvider {
  async *stream(config: { baseUrl: string; modelName: string; apiKey: Buffer; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }, messages: AiChatMessage[], signal: AbortSignal): AsyncGenerator<AiStreamEvent> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS)
    const onAbort = () => controller.abort(); signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(aiChatCompletionsUrl(config.baseUrl), { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey.toString('utf8')}` }, body: JSON.stringify({ model: config.modelName, stream: true, messages, temperature: config.temperature ?? AI_DEFAULT_SAMPLING.temperature, top_p: config.topP ?? AI_DEFAULT_SAMPLING.topP, presence_penalty: config.presencePenalty ?? AI_DEFAULT_SAMPLING.presencePenalty, frequency_penalty: config.frequencyPenalty ?? AI_DEFAULT_SAMPLING.frequencyPenalty }) })
      if (!response.ok || !response.body) { yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider request failed' }; return }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      let ended = false
      while (true) { const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; for (const line of lines) { if (!line.startsWith('data:')) continue; const payload = line.slice(5).trim(); if (payload === '[DONE]') { ended = true; yield { type: 'done' }; return } try { const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> }; const choice = data.choices?.[0]; if (choice?.finish_reason === 'length') { ended = true; yield { type: 'incomplete', reason: 'length' }; return } if (choice?.finish_reason === 'stop') { ended = true; yield { type: 'done' }; return } const content = choice?.delta?.content; if (content) yield { type: 'token', content } } catch { yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider stream invalid' }; return } } }
      if (!ended) yield { type: 'incomplete', reason: 'stream-ended' }
    } catch (error) { yield { type: 'error', code: (error instanceof Error && error.name === 'AbortError') ? 'AI_PROVIDER_TIMEOUT' : 'AI_STREAM_FAILED', message: 'AI provider request failed' } }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); config.apiKey.fill(0) }
  }
}

export interface ReadonlySearch { search(query: string): Promise<SearchResult[]> }
export interface AiLatencyDiagnostic {
  requestId?: string
  searchMs: number
  configMs: number
  conversationMs: number
  overviewMs: number
  providerToFirstTokenMs?: number
  providerToDoneMs?: number
  backgroundSummary: boolean
  usedExistingSummary: boolean
}

const backgroundSummaryTasks = new Map<string, Promise<void>>()

export class AiChatApplicationService {
  constructor(private readonly config: AiConfigManager, private readonly search: ReadonlySearch, private readonly provider: AiProvider, private readonly knowledge?: AiKnowledgeOverviewReader, private readonly conversation?: AiConversationRepository, private readonly onLatency?: (diagnostic: AiLatencyDiagnostic) => void, private readonly preferences?: { readForAi(): Promise<AiPreference[]> }) {}
  async *stream(messages: AiChatMessage[], signal: AbortSignal, user?: AuthUser, requestId?: string, conversationId?: string, contextMode: 'full' | 'daily-note' = 'full'): AsyncGenerator<AiStreamEvent> {
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30 || messages.some((m) => !m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > 12000) || messages.reduce((total, m) => total + (typeof m.content === 'string' ? m.content.length : 0), 0) > 12000 || messages.reduce((total, m) => total + (typeof m.content === 'string' ? Math.ceil(m.content.length / 4) : 0), 0) > 6000) { yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'invalid messages' }; return }
    const last = messages[messages.length - 1]!.content
    const searchStartedAt = Date.now()
    const context = contextMode === 'daily-note' ? [] : (await this.search.search(last.slice(0, 200))).sort((a, b) => String((b as SearchResult & { updatedAt?: string }).updatedAt ?? '').localeCompare(String((a as SearchResult & { updatedAt?: string }).updatedAt ?? '')) || typeOrder(a.type) - typeOrder(b.type) || a.id.localeCompare(b.id)).slice(0, 30)
    const searchMs = Date.now() - searchStartedAt
    const configStartedAt = Date.now()
    const current = await this.config.current()
    const configMs = Date.now() - configStartedAt
    const conversationStartedAt = Date.now()
    const conversation = this.conversation ? (conversationId ? await this.conversation.getConversation?.(conversationId) : await this.conversation.getDefault()) : undefined
    const persisted = conversation ? await this.conversation!.listMessages(conversation.id) : []
    const conversationMs = Date.now() - conversationStartedAt
    const summary = conversation?.summary
    const summaryNeeded = Boolean(conversation && persisted.length > AI_MAX_RECENT_TURNS * 2 && (!summary || summary.throughSequence < persisted[persisted.length - (AI_MAX_RECENT_TURNS * 2)]!.sequence))
    if (summaryNeeded && conversation) this.scheduleSummaryRefresh(conversation.id, persisted)
    const contextLines = context.slice(0, 10).map((entry) => `${entry.type}: ${entry.title}`).join('\n')
    const overviewStartedAt = Date.now()
    const overview = contextMode === 'daily-note' ? undefined : this.knowledge && user ? await this.knowledge.read(user) : undefined
    const overviewMs = Date.now() - overviewStartedAt
    const confirmedPreferences = contextMode === 'daily-note' ? [] : this.preferences ? await this.preferences.readForAi() : []
    const readonlyContext = formatKnowledgeContext(overview, contextLines, summary, confirmedPreferences, AI_KNOWLEDGE_CONTEXT_MAX_CHARS)
    const sourceMessages = persisted.length > 0 ? selectRecentMessages(persisted, summary?.throughSequence) : messages
    const prompt: AiChatMessage[] = [buildAiSystemMessage(), ...sourceMessages.map((message, index) => index === 0 && message.role === 'user' ? { role: 'user' as const, content: `${readonlyContext}${message.content}` } : { role: message.role, content: message.content })]
    if (sourceMessages.length === 0 || sourceMessages[sourceMessages.length - 1]?.content !== last) prompt.push({ role: 'user', content: `${readonlyContext}${last}` })
    const providerStartedAt = Date.now()
    let firstTokenAt: number | undefined
    let doneAt: number | undefined
    try {
      const key = Buffer.from(current.config.apiKey)
      for await (const event of this.provider.stream({ ...current.config, apiKey: key }, prompt, signal)) {
        if (event.type === 'token' && firstTokenAt === undefined) firstTokenAt = Date.now()
        if (event.type === 'done') doneAt = Date.now()
        yield event.type === 'token' ? { ...event, content: sanitizeAiOutput(event.content) } : event
      }
    } finally {
      this.onLatency?.({ requestId, searchMs, configMs, conversationMs, overviewMs, providerToFirstTokenMs: firstTokenAt ? firstTokenAt - providerStartedAt : undefined, providerToDoneMs: doneAt ? doneAt - providerStartedAt : undefined, backgroundSummary: summaryNeeded, usedExistingSummary: Boolean(summary) })
    }
  }

  private scheduleSummaryRefresh(conversationId: string, messages: Array<{ sequence: number; role: 'user' | 'assistant'; content: string }>): void {
    if (!this.conversation || backgroundSummaryTasks.has(conversationId)) return
    let task: Promise<void>
    task = Promise.resolve().then(async () => { await this.ensureSummary(conversationId, messages, new AbortController().signal) }).catch(() => undefined).finally(() => { if (backgroundSummaryTasks.get(conversationId) === task) backgroundSummaryTasks.delete(conversationId) })
    backgroundSummaryTasks.set(conversationId, task)
  }

  private async ensureSummary(conversationId: string, messages: Array<{ sequence: number; role: 'user' | 'assistant'; content: string }>, signal: AbortSignal): Promise<void> {
    const cutoff = Math.max(0, messages[messages.length - (AI_MAX_RECENT_TURNS * 2)]!.sequence)
    const older = messages.filter((message) => message.sequence <= cutoff && message.content)
    if (older.length === 0 || !this.conversation) return
    const transcript = older.map((message) => `${message.role}: ${message.content}`).join('\n').slice(0, 20_000)
    const summaryPrompt: AiChatMessage[] = [{ role: 'user', content: `Summarize the following conversation for future continuity. Preserve user goals, decisions, constraints, unresolved questions, and important corrections. Do not invent facts. Return plain text only, concise, without IDs or meta commentary.\n\n${transcript}` }]
    let content = ''
    try {
      const current = await this.config.current()
      for await (const event of this.provider.stream({ ...current.config, apiKey: Buffer.from(current.config.apiKey) }, [buildAiSystemMessage(), ...summaryPrompt], signal)) {
        if (event.type === 'token') content += event.content
        if (event.type === 'error' || event.type === 'incomplete') return
        if (event.type === 'done') break
      }
    } catch { return }
    content = content.trim().slice(0, AI_SUMMARY_MAX_CHARS)
    if (!content) return
    const summary: AiConversationSummary = { content, version: AI_SUMMARY_VERSION, throughSequence: cutoff, updatedAt: new Date().toISOString() }
    try {
      const latest = await this.conversation.getConversation?.(conversationId)
      if (latest?.summary && latest.summary.throughSequence > summary.throughSequence) return
      await this.conversation.updateSummary(conversationId, summary)
    } catch { return }
  }
}

function selectRecentMessages(messages: Array<{ sequence: number; role: 'user' | 'assistant'; content: string }>, throughSequence?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recent = messages.filter((message) => !throughSequence || message.sequence > throughSequence)
  const window = recent.slice(-AI_MAX_RECENT_TURNS * 2)
  while (window[0]?.role === 'assistant') window.shift()
  return window.map(({ role, content }) => ({ role, content }))
}

function typeOrder(type: SearchResult['type']): number { return type === 'item' ? 0 : type === 'review' ? 1 : 2 }

function sanitizeAiOutput(content: string): string {
  return content
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '')
    .replace(/(事项|复盘|方法|探索主线)\s*\[[^\]]*\]/g, '$1')
}
