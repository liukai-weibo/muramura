import type { AiChatMessage, AiStreamEvent } from '@knowledge-base/contracts'

export const AI_PROVIDER_TIMEOUT_MS = 120_000

export interface ProviderAdapter { stream(messages: AiChatMessage[], signal: AbortSignal): AsyncGenerator<AiStreamEvent> }
export interface SSEParser { parse(chunk: string): AiStreamEvent[] }
export interface StreamWriter { write(event: AiStreamEvent): void; close(): void }
export class AbortControllerFactory { create(parent?: AbortSignal): AbortController { const controller = new AbortController(); parent?.addEventListener('abort', () => controller.abort(), { once: true }); return controller } }
export class TimeoutController { constructor(private readonly milliseconds = AI_PROVIDER_TIMEOUT_MS) {} attach(controller: AbortController): ReturnType<typeof setTimeout> { return setTimeout(() => controller.abort(), this.milliseconds) } }
export function mapProviderError(error: unknown): AiStreamEvent { return { type: 'error', code: error instanceof Error && error.name === 'AbortError' ? 'AI_PROVIDER_TIMEOUT' : 'AI_STREAM_FAILED', message: 'AI provider request failed' } }
export class SingleUserActiveStream {
  private active?: AbortController
  begin(): AbortController { this.active?.abort(); this.active = new AbortController(); return this.active }
  finish(controller: AbortController): void { if (this.active === controller) this.active = undefined }
}

/**
 * Coordinates server-side AI streams by owner and conversation. A new request
 * only aborts the previous request for the same key; other conversations keep
 * running independently.
 */
export class ConversationActiveStreams {
  private readonly active = new Map<string, AbortController>()
  private readonly parentListeners = new Map<string, { parent: AbortSignal; listener: () => void }>()

  begin(key: string, parent: AbortSignal): AbortController {
    const previousListener = this.parentListeners.get(key)
    if (previousListener) previousListener.parent.removeEventListener('abort', previousListener.listener)
    this.active.get(key)?.abort()
    const controller = new AbortController()
    const onParentAbort = () => controller.abort()
    if (parent.aborted) controller.abort()
    else parent.addEventListener('abort', onParentAbort, { once: true })
    this.active.set(key, controller)
    this.parentListeners.set(key, { parent, listener: onParentAbort })
    return controller
  }

  finish(key: string, controller: AbortController): void {
    if (this.active.get(key) !== controller) return
    this.active.delete(key)
    const parentListener = this.parentListeners.get(key)
    if (parentListener) parentListener.parent.removeEventListener('abort', parentListener.listener)
    this.parentListeners.delete(key)
  }
}
export class OpenAiSseParser implements SSEParser {
  parse(chunk: string): AiStreamEvent[] {
    const events: AiStreamEvent[] = []
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const value = line.slice(5).trim()
      if (value === '[DONE]') { events.push({ type: 'done' }); continue }
      try { const data = JSON.parse(value) as { choices?: Array<{ delta?: { content?: string } }> }; const token = data.choices?.[0]?.delta?.content; if (token) events.push({ type: 'token', content: token }) }
      catch { events.push({ type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider stream invalid' }) }
    }
    return events
  }
}
