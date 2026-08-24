import type { AiChatMessage, AiConversationMessageStatus } from '@knowledge-base/contracts'
import { AiConfigError } from '@knowledge-base/application'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { createOpenApiApp } from '../openapi'
import { ConversationActiveStreams } from '../../experimental-ai/streaming'

const jsonObject = async (context: any): Promise<Record<string, unknown>> => {
  const value = await context.req.json().catch(() => undefined)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid request body')
  return value as Record<string, unknown>
}

function requireConversationId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!value.trim() || value.length > 128) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid conversation id')
  return value
}

function parsePage(context: any): { limit?: number; beforeSequence?: number } {
  const rawLimit = context.req.query('limit')
  const rawBefore = context.req.query('beforeSequence')
  const limit = rawLimit === undefined ? undefined : Number(rawLimit)
  const beforeSequence = rawBefore === undefined ? undefined : Number(rawBefore)
  if ((limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) || (beforeSequence !== undefined && (!Number.isInteger(beforeSequence) || beforeSequence < 1))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'invalid AI conversation paging')
  }
  return { limit, beforeSequence }
}

function sse(event: unknown): string { return `data: ${JSON.stringify(event)}\n\n` }

const activeStreams = new ConversationActiveStreams()

function mapAiConfigFailure(error: unknown): never {
  if (error instanceof AiConfigError) {
    if (error.code === 'invalid') throw new ApiError(400, 'VALIDATION_FAILED', 'AI 配置参数无效，请检查服务名称、模型名称、Base URL、API Key 和采样参数。')
    if (error.code === 'write-failed') throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI 配置无法写入本机安全存储，请重启 API 后重试。')
    throw new ApiError(503, 'MYSQL_UNAVAILABLE', '本机安全存储当前不可用，请重启 API 后重试。')
  }
  throw error
}

export function createAiRoutes() {
  return createOpenApiApp()
    .get('/admin/experimental/ai-config', async (context: any) => {
      const actor = context.get('actor')
      if (!actor?.roles.includes('platform_admin')) throw new ApiError(403, 'FORBIDDEN', 'administrator required')
      const services = requireServices(context)
      let metadata
      try { metadata = await services.aiConfig?.load() } catch (error) { mapAiConfigFailure(error) }
      if (!metadata) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI configuration unavailable')
      return context.json(metadata, 200)
    })
    .put('/admin/experimental/ai-config', async (context: any) => {
      const actor = context.get('actor')
      if (!actor?.roles.includes('platform_admin')) throw new ApiError(403, 'FORBIDDEN', 'administrator required')
      const services = requireServices(context)
      const body = await jsonObject(context)
      const input = {
        serviceName: String(body.serviceName ?? ''), modelName: String(body.modelName ?? ''), baseUrl: String(body.baseUrl ?? ''), apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
        ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
        ...(body.topP !== undefined ? { topP: Number(body.topP) } : {}),
        ...(body.presencePenalty !== undefined ? { presencePenalty: Number(body.presencePenalty) } : {}),
        ...(body.frequencyPenalty !== undefined ? { frequencyPenalty: Number(body.frequencyPenalty) } : {}),
      }
      let metadata
      try { metadata = await services.aiConfig?.replace(input) } catch (error) { mapAiConfigFailure(error) }
      if (!metadata) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI configuration unavailable')
      return context.json(metadata, 200)
    })
    .delete('/admin/experimental/ai-config', async (context: any) => {
      const actor = context.get('actor')
      if (!actor?.roles.includes('platform_admin')) throw new ApiError(403, 'FORBIDDEN', 'administrator required')
      const services = requireServices(context)
      try { await services.aiConfig?.clear() } catch (error) { mapAiConfigFailure(error) }
      return context.body(null, 204)
    })
    .get('/ai/preferences', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiPreferences) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'AI preferences unavailable')
      return context.json(await services.aiPreferences.listMine(), 200)
    })
    .post('/ai/preferences', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiPreferences) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'AI preferences unavailable')
      const body = await jsonObject(context)
      return context.json(await services.aiPreferences.createConfirmed({ key: body.key as any, value: String(body.value ?? '') }), 201)
    })
    .put('/ai/preferences/:id', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiPreferences) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'AI preferences unavailable')
      const body = await jsonObject(context)
      return context.json(await services.aiPreferences.updateMine(context.req.param('id'), { key: body.key as any, value: String(body.value ?? '') }), 200)
    })
    .delete('/ai/preferences/:id', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiPreferences) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'AI preferences unavailable')
      await services.aiPreferences.deleteMine(context.req.param('id'))
      return context.body(null, 204)
    })
    .get('/experimental/ai-config-status', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConfig) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI configuration unavailable')
      let metadata
      try { metadata = await services.aiConfig.load() } catch (error) { mapAiConfigFailure(error) }
      return context.json({ configured: Boolean(metadata?.apiKeyConfigured) }, 200)
    })
    .get('/experimental/ai-conversation', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      return context.json(await services.aiConversation.getDefault(parsePage(context)), 200)
    })
    .get('/experimental/ai-conversations', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      return context.json(await services.aiConversation.listConversations(context.req.query('includeDeleted') === 'true'), 200)
    })
    .get('/experimental/ai-conversations/trash', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      return context.json((await services.aiConversation.listConversations(true)).filter((entry) => entry.deletedAt), 200)
    })
    .post('/experimental/ai-conversations', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      const body = await jsonObject(context)
      const title = body.title === undefined ? '新会话' : String(body.title)
      if (title.trim().length > 160) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid conversation title')
      return context.json(await services.aiConversation.createConversation(title), 201)
    })
    .get('/experimental/ai-conversations/:id', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      const snapshot = await services.aiConversation.getById(context.req.param('id'), parsePage(context))
      if (!snapshot) throw new ApiError(404, 'NOT_FOUND', 'AI conversation not found')
      return context.json(snapshot, 200)
    })
    .patch('/experimental/ai-conversations/:id/title', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
      const body = await jsonObject(context)
      const result = await services.aiConversation.updateConversationTitle(context.req.param('id'), String(body.title ?? ''))
      if (!result) throw new ApiError(404, 'NOT_FOUND', 'AI conversation not found')
      return context.json(result, 200)
    })
    .post('/experimental/ai-conversations/:id/archive', async (context: any) => updateConversation(context, 'archive'))
    .post('/experimental/ai-conversations/:id/restore', async (context: any) => updateConversation(context, 'restore'))
    .delete('/experimental/ai-conversations/:id', async (context: any) => updateConversation(context, 'delete'))
    .delete('/experimental/ai-conversations/:id/purge', async (context: any) => {
      const services = requireServices(context)
      if (!services.aiConversation || !(await services.aiConversation.purgeConversation(context.req.param('id')))) throw new ApiError(404, 'NOT_FOUND', 'AI conversation not found')
      return context.body(null, 204)
    })
    .post('/experimental/ai-chat/stream', async (context: any) => {
      const services = requireServices(context)
      if (!services.ai || !services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI configuration unavailable')
      const body = await jsonObject(context)
      const messages = body.messages
      if (!Array.isArray(messages) || messages.length === 0 || messages.some((entry) => !entry || (entry as any).role !== 'user' && (entry as any).role !== 'assistant' || typeof (entry as any).content !== 'string')) throw new ApiError(400, 'VALIDATION_FAILED', 'system messages are server-owned')
      const conversationId = requireConversationId(typeof body.conversationId === 'string' ? body.conversationId : undefined)
      const conversation = conversationId ? await services.aiConversation.getById(conversationId) : await services.aiConversation.getDefault()
      if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'AI conversation not found')
      const last = messages[messages.length - 1] as AiChatMessage
      if (last.role !== 'user' || !last.content.trim()) throw new ApiError(400, 'VALIDATION_FAILED', 'last message must be a user message')
      const actor = context.get('actor')
      const streamKey = `${actor.id}:${conversation.conversation.id}`
      const streamController = activeStreams.begin(streamKey, context.req.raw.signal)
      const existingLast = conversation.messages[conversation.messages.length - 1]
      try {
        if (!existingLast || existingLast.role !== 'user' || existingLast.content !== last.content) await services.aiConversation.append({ conversationId: conversation.conversation.id, role: 'user', status: 'completed', content: last.content })
      } catch (error) {
        activeStreams.finish(streamKey, streamController)
        throw error
      }
      const assistantParts: string[] = []
      const stream = services.ai.stream(messages as AiChatMessage[], streamController.signal, actor, context.get('requestId'), conversation.conversation.id)
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          let finalStatus: AiConversationMessageStatus = 'completed'
          try {
            for await (const event of stream) {
              if (event.type === 'token') assistantParts.push(event.content)
              if (event.type === 'incomplete') finalStatus = 'incomplete'
              if (event.type === 'error') finalStatus = streamController.signal.aborted ? 'aborted' : 'error'
              controller.enqueue(encoder.encode(sse(event)))
            }
          } catch {
            finalStatus = streamController.signal.aborted ? 'aborted' : 'error'
          } finally {
            if (assistantParts.length) await services.aiConversation!.append({ conversationId: conversation.conversation.id, role: 'assistant', status: finalStatus, content: assistantParts.join('') }).catch(() => undefined)
            activeStreams.finish(streamKey, streamController)
            controller.close()
          }
        },
      })
      const response = new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
      const origin = context.req.header('origin')
      if (origin) {
        response.headers.set('access-control-allow-origin', origin)
        response.headers.set('access-control-allow-credentials', 'true')
        response.headers.set('access-control-expose-headers', 'x-kb-session-token')
        response.headers.set('vary', 'origin')
      }
      return response
    })

    .post('/experimental/ai-chat/stream-ephemeral', async (context: any) => {
      const services = requireServices(context)
      if (!services.ai) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI configuration unavailable')
      const body = await jsonObject(context)
      const messages = body.messages
      if (!Array.isArray(messages) || messages.length === 0 || messages.some((entry) => !entry || (entry as any).role !== 'user' && (entry as any).role !== 'assistant' || typeof (entry as any).content !== 'string')) throw new ApiError(400, 'VALIDATION_FAILED', 'system messages are server-owned')
      const last = messages[messages.length - 1] as AiChatMessage
      if (last.role !== 'user' || !last.content.trim()) throw new ApiError(400, 'VALIDATION_FAILED', 'last message must be a user message')
      const actor = context.get('actor')
      const streamKey = `${actor.id}:ephemeral:${crypto.randomUUID()}`
      const streamController = activeStreams.begin(streamKey, context.req.raw.signal)
      const stream = services.ai.stream(messages as AiChatMessage[], streamController.signal, actor, context.get('requestId'))
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          try { for await (const event of stream) controller.enqueue(encoder.encode(sse(event))) }
          catch { /* stream terminated */ } finally { activeStreams.finish(streamKey, streamController); controller.close() }
        },
      })
      const response = new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
      const origin = context.req.header('origin')
      if (origin) {
        response.headers.set('access-control-allow-origin', origin)
        response.headers.set('access-control-allow-credentials', 'true')
        response.headers.set('access-control-expose-headers', 'x-kb-session-token')
        response.headers.set('vary', 'origin')
      }
      return response
    })
}

async function updateConversation(context: any, action: 'archive' | 'restore' | 'delete') {
  const services = requireServices(context)
  if (!services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'AI conversation unavailable')
  const result = action === 'archive' ? await services.aiConversation.archiveConversation(context.req.param('id')) : action === 'restore' ? await services.aiConversation.restoreConversation(context.req.param('id')) : await services.aiConversation.deleteConversation(context.req.param('id'))
  if (!result) throw new ApiError(404, 'NOT_FOUND', 'AI conversation not found')
  return context.json(result, 200)
}
