import type { AiChatMessage, AiStreamEvent } from '@knowledge-base/contracts'
import { aiChatCompletionsUrl, type AiProvider } from '@knowledge-base/application'

// Streaming responses can legitimately take longer than the old 15-second
// guard, especially when the provider is still producing tokens. This is a
// request lifetime limit, not a token limit; user aborts still cancel it
// immediately.
export const AI_PROVIDER_TIMEOUT_MS = 120_000

function anthropicMessagesUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/v1') ? `${path}/messages` : `${path}/v1/messages`
  url.search = ''; url.hash = ''
  return url
}

/** API-owned provider adapter with explicit upstream reader cancellation. */
export class LoopbackProviderAdapter implements AiProvider {
  async *stream(config: { baseUrl: string; modelName: string; apiKey: Buffer; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }, messages: AiChatMessage[], signal: AbortSignal): AsyncGenerator<AiStreamEvent> {
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => { if (!controller.signal.aborted) controller.abort() }
    signal.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => { timedOut = true; onAbort() }, AI_PROVIDER_TIMEOUT_MS)
    const upstreamSignal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const anthropic = config.modelName.startsWith('claude-')
      let response: Response | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = providerBody(config, messages, anthropic, attempt > 0)
        response = await fetch(anthropic ? anthropicMessagesUrl(config.baseUrl) : aiChatCompletionsUrl(config.baseUrl), {
          method: 'POST', signal: upstreamSignal,
          headers: anthropic
            ? { 'content-type': 'application/json', 'x-api-key': config.apiKey.toString('utf8'), 'anthropic-version': '2023-06-01' }
            : { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey.toString('utf8')}` },
          body: JSON.stringify(body),
        })
        if (response.ok || !isUnsupportedSamplingParameter(response.status, await response.clone().text())) break
      }
      if (!response) throw new Error('provider response unavailable')
      if (!response.ok || !response.body) {
        const detail = response.ok ? 'empty response body' : `upstream HTTP ${response.status}`
        yield { type: 'error', code: 'AI_STREAM_FAILED', message: `AI provider request failed (${detail})` }; return
      }
      reader = response.body.getReader()
      const decoder = new TextDecoder(); let buffer = ''
      while (!upstreamSignal.aborted) {
        const next = await reader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { yield { type: 'done' }; return }
          try {
            const data = JSON.parse(payload) as { type?: string; choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; delta?: { type?: string; text?: string; stop_reason?: string | null } }
            if (anthropic && data.type === 'message_stop') { yield { type: 'done' }; return }
            if (anthropic && data.type === 'message_delta' && data.delta?.stop_reason === 'max_tokens') { yield { type: 'incomplete', reason: 'length' }; return }
            const finishReason = data.choices?.[0]?.finish_reason
            if (!anthropic && finishReason === 'length') { yield { type: 'incomplete', reason: 'length' }; return }
            if (!anthropic && finishReason === 'stop') { yield { type: 'done' }; return }
            const content = anthropic ? (data.delta?.type === 'text_delta' ? data.delta.text : undefined) : data.choices?.[0]?.delta?.content
            if (content) yield { type: 'token', content }
          }
          catch { yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider stream invalid' }; return }
        }
      }
      // Some providers close the stream immediately after the final SSE data
      // line without sending the customary blank-line delimiter. Parse that
      // buffered final line before emitting completion so the last token is
      // not silently dropped.
      if (!upstreamSignal.aborted && buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') { yield { type: 'done' }; return }
          try {
            const data = JSON.parse(payload) as { type?: string; choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; delta?: { type?: string; text?: string; stop_reason?: string | null } }
            if (anthropic && data.type === 'message_stop') { yield { type: 'done' }; return }
            if (anthropic && data.type === 'message_delta' && data.delta?.stop_reason === 'max_tokens') { yield { type: 'incomplete', reason: 'length' }; return }
            const finishReason = data.choices?.[0]?.finish_reason
            if (!anthropic && finishReason === 'length') { yield { type: 'incomplete', reason: 'length' }; return }
            if (!anthropic && finishReason === 'stop') { yield { type: 'done' }; return }
            const content = anthropic ? (data.delta?.type === 'text_delta' ? data.delta.text : undefined) : data.choices?.[0]?.delta?.content
            if (content) yield { type: 'token', content }
          } catch {
            // A provider may leave a partial delimiter in the final buffer;
            // only treat a complete JSON-looking payload as malformed.
            if (payload.startsWith('{')) { yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider stream invalid' }; return }
          }
        }
      }
      if (signal.aborted) return
      if (timedOut) yield { type: 'error', code: 'AI_PROVIDER_TIMEOUT', message: 'AI provider request failed' }
      else yield { type: 'incomplete', reason: 'stream-ended' }
    } catch (error) {
      if (signal.aborted) return
      if (timedOut) { yield { type: 'error', code: 'AI_PROVIDER_TIMEOUT', message: 'AI provider request failed' }; return }
      yield { type: 'error', code: 'AI_STREAM_FAILED', message: 'AI provider request failed' }
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', onAbort)
      onAbort()
      if (reader) { try { await reader.cancel() } catch { /* already closed */ } }
      config.apiKey.fill(0)
    }
  }
}

function providerBody(config: { modelName: string; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }, messages: AiChatMessage[], anthropic: boolean, fallback: boolean): Record<string, unknown> {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const providerMessages = anthropic ? messages.filter((message) => message.role !== 'system') : messages
  const body: Record<string, unknown> = { model: config.modelName, ...(anthropic ? { max_tokens: 4096, ...(system ? { system } : {}) } : config.modelName.toLowerCase().startsWith('gpt-5') ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }), stream: true, messages: providerMessages }
  if (!fallback) {
    if (config.temperature !== undefined) body.temperature = config.temperature
    if (config.topP !== undefined) body.top_p = config.topP
    if (!anthropic && config.presencePenalty !== undefined) { body.presence_penalty = config.presencePenalty; body.frequency_penalty = config.frequencyPenalty }
  }
  return body
}

function isUnsupportedSamplingParameter(status: number, detail: string): boolean {
  return (status === 400 || status === 422) && /unknown|unsupported|unrecognized|unexpected|invalid\s+(?:request\s+)?parameter/i.test(detail) && /temperature|top[_ -]?p|presence[_ -]?penalty|frequency[_ -]?penalty/i.test(detail)
}
