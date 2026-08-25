import { z, createRoute } from '@hono/zod-openapi'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { ApiError } from '../errors'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { ConversationActiveStreams } from '../../experimental-ai/streaming'
import type { AiConversationMessageStatus, DailyNoteAiCommand } from '@knowledge-base/contracts'

const dailyAiStreams = new ConversationActiveStreams()
const aiCommands: Record<DailyNoteAiCommand, string> = {
  emotion: '梳理这篇小记中表达的情绪、触发因素和需要照顾的部分。不要诊断，不要虚构。',
  daily_actions: '总结当天已知行动事实与小记内容，严格区分事实和建议。',
  improve_writing: '在不编造事实的前提下，给出更清晰、具体的记录表达建议。',
  extract_todos: '从小记提取可执行的下一步。仅返回 JSON 数组，每项为 {"title":"...","content":"..."}，最多 20 项。',
  resistance: '分析记录中可观察到的执行阻力、证据和一个最小可验证调整，不把猜测写成事实。',
}
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

function parseTodoCandidates(output: string): unknown[] {
  const normalized = output.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = normalized.indexOf('[')
  const end = normalized.lastIndexOf(']')
  const parsed: unknown = JSON.parse(start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized)
  if (!Array.isArray(parsed)) throw new Error('todo output is not an array')
  return parsed
}

const noteSchema = z.object({ id: z.string(), entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), content: z.string(), aiConversationId: z.string().optional(), createdAt: z.string(), updatedAt: z.string() })
const idSchema = z.object({ id: z.string().min(1) })
const updateSchema = z.object({ content: z.string().max(100000) })
const appendSchema = z.object({ content: z.string().min(1).max(100000) })

export function createDailyNoteRoutes() {
  return createOpenApiApp()
    .openapi(createRoute({ method: 'get', path: '/today', tags: ['Daily notes'], responses: { 200: jsonSuccess(noteSchema.nullable(), 'today note or empty'), 401: commonErrorResponses[401] } }), async context => {
      const service = requireServices(context).dailyNotes
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily notes unavailable')
      return context.json(await service.getToday(), 200)
    })
    .openapi(createRoute({ method: 'post', path: '/today', tags: ['Daily notes'], request: { body: { required: false, content: { 'application/json': { schema: z.object({}) } } } }, responses: { 200: jsonSuccess(noteSchema, 'today note'), 401: commonErrorResponses[401] } }), async context => {
      const service = requireServices(context).dailyNotes
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily notes unavailable')
      return context.json(await service.getOrCreateToday(), 200)
    })
    .openapi(createRoute({ method: 'get', path: '/', tags: ['Daily notes'], responses: { 200: jsonSuccess(z.array(noteSchema), 'notes'), 401: commonErrorResponses[401] } }), async context => {
      const service = requireServices(context).dailyNotes
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily notes unavailable')
      return context.json(await service.listMine(), 200)
    })
    .openapi(createRoute({ middleware: [requireJson], method: 'put', path: '/{id}', tags: ['Daily notes'], request: { params: idSchema, body: { required: true, content: { 'application/json': { schema: updateSchema } } } }, responses: { 200: jsonSuccess(noteSchema, 'saved note'), 401: commonErrorResponses[401], 404: commonErrorResponses[404] } }), async context => {
      const service = requireServices(context).dailyNotes
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily notes unavailable')
      const body = await context.req.json()
      return context.json(await service.updateMine(context.req.param('id'), body.content), 200)
    })
    .openapi(createRoute({ middleware: [requireJson], method: 'post', path: '/today/append', tags: ['Daily notes'], request: { body: { required: true, content: { 'application/json': { schema: appendSchema } } } }, responses: { 200: jsonSuccess(noteSchema, 'appended note'), 401: commonErrorResponses[401] } }), async context => {
      const service = requireServices(context).dailyNotes
      if (!service) throw new ApiError(503, 'MYSQL_SCHEMA_NOT_READY', 'daily notes unavailable')
      const body = await context.req.json()
      return context.json(await service.appendToday(body.content), 200)
    })
    .post('/:id/ai/stream', async (context: any) => {
      const services = requireServices(context)
      if (!services.dailyNotes || !services.ai || !services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'daily note AI unavailable')
      const body = await context.req.json().catch(() => undefined)
      const command = body?.command as DailyNoteAiCommand
      const draft = body?.draft
      if (!aiCommands[command] || typeof draft !== 'string' || draft.length > 100000) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid daily note AI request')
      const note = await services.dailyNotes.getMine(context.req.param('id'))
      if (!note) throw new ApiError(404, 'NOT_FOUND', 'daily note not found')
      let conversationId = note.aiConversationId
      let conversation = conversationId ? await services.aiConversation.getById(conversationId) : undefined
      if (!conversation) {
        conversation = { conversation: await services.aiConversation.createConversation(`今日小记 ${note.entryDate}`, 'daily_note'), messages: [] }
        conversationId = conversation.conversation.id
        await services.dailyNotes.setAiConversationId(note.id, conversationId)
      }
      const facts = command === 'daily_actions' ? await services.dailyNotes.listActionFactsForDate(note.entryDate) : []
      const moodFacts = await services.moodEntries?.listRange(note.entryDate, note.entryDate) ?? []
      const mealFacts = await services.meals?.listRange(note.entryDate, note.entryDate) ?? []
      const dayFacts = [
        command === 'daily_actions' ? `服务端筛选的当天事项事实：\n${JSON.stringify(facts)}` : '',
        moodFacts.length ? `当天情绪：\n${JSON.stringify(moodFacts.map(e => ({ level: e.moodLevel, content: e.content })))}` : '',
        mealFacts.length ? `当天三餐：\n${JSON.stringify(mealFacts.map(e => ({ mealType: e.mealType, content: e.content, feeling: e.feeling })))}` : '',
      ].filter(Boolean).join('\n\n')
      const userContent = [
        `这是 ${note.entryDate} 的个人小记专属请求：${aiCommands[command]}`,,
        '当前编辑器草稿（可能尚未保存）：', draft || '（空）',,
        dayFacts,
      ].filter(Boolean).join('\n\n')
      const actor = context.get('actor')
      const activeConversationId = conversationId!
      const streamKey = `${actor.id}:${activeConversationId}`
      const controller = dailyAiStreams.begin(streamKey, context.req.raw.signal)
      await services.aiConversation.append({ conversationId: activeConversationId, role: 'user', status: 'completed', content: command === 'emotion' ? '梳理今日情绪' : command === 'daily_actions' ? '总结今日全部行动' : command === 'improve_writing' ? '扩写 / 优化记录文案' : '复盘今日执行阻力分析' })
      const parts: string[] = []
      const stream = services.ai.stream([{ role: 'user', content: userContent }], controller.signal, actor, context.get('requestId'), activeConversationId, 'daily-note')
      const readable = new ReadableStream<Uint8Array>({ async start(writer) {
        const encoder = new TextEncoder(); let status: AiConversationMessageStatus = 'completed'
        try { for await (const event of stream) { if (event.type === 'token') parts.push(event.content); if (event.type === 'incomplete') status = 'incomplete'; if (event.type === 'error') status = controller.signal.aborted ? 'aborted' : 'error'; writer.enqueue(encoder.encode(sse(event))) } }
        catch { status = controller.signal.aborted ? 'aborted' : 'error' }
        finally { if (parts.length) await services.aiConversation!.append({ conversationId: activeConversationId, role: 'assistant', status, content: parts.join('') }).catch(() => undefined); dailyAiStreams.finish(streamKey, controller); writer.close() }
      }})
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
    .get('/:id/ai/chat', async (context: any) => {
      const services = requireServices(context)
      if (!services.dailyNotes || !services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'daily note AI unavailable')
      const note = await services.dailyNotes.getMine(context.req.param('id'))
      if (!note) throw new ApiError(404, 'NOT_FOUND', 'daily note not found')
      if (!note.aiConversationId) return context.json({ messages: [] }, 200)
      const snapshot = await services.aiConversation.getById(note.aiConversationId)
      return context.json({ messages: snapshot?.messages ?? [] }, 200)
    })
    .post('/:id/ai/chat/stream', async (context: any) => {
      const services = requireServices(context)
      if (!services.dailyNotes || !services.ai || !services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'daily note AI unavailable')
      const body = await context.req.json().catch(() => undefined)
      const message = body?.message
      const draft = body?.draft
      if (typeof message !== 'string' || !message.trim() || message.length > 10000 || typeof draft !== 'string' || draft.length > 100000) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid daily note AI chat request')
      const note = await services.dailyNotes.getMine(context.req.param('id'))
      if (!note) throw new ApiError(404, 'NOT_FOUND', 'daily note not found')
      let conversationId = note.aiConversationId
      let conversation = conversationId ? await services.aiConversation.getById(conversationId) : undefined
      if (!conversation) {
        conversation = { conversation: await services.aiConversation.createConversation(`浠婃棩灏忚 ${note.entryDate}`, 'daily_note'), messages: [] }
        conversationId = conversation.conversation.id
        await services.dailyNotes.setAiConversationId(note.id, conversationId)
      }
      const facts = await services.dailyNotes.listActionFactsForDate(note.entryDate)
      const moodFacts = await services.moodEntries?.listRange(note.entryDate, note.entryDate) ?? []
      const mealFacts = await services.meals?.listRange(note.entryDate, note.entryDate) ?? []
      const dayFacts = [
        `鏈嶅姟绔寜涓婃捣鏃ユ湡绛涢€夌殑浠婃棩琛屽姩浜嬪疄锛歕n${JSON.stringify(facts)}`,
        moodFacts.length ? `当天情绪：\n${JSON.stringify(moodFacts.map(e => ({ level: e.moodLevel, content: e.content })))}` : '',
        mealFacts.length ? `当天三餐：\n${JSON.stringify(mealFacts.map(e => ({ mealType: e.mealType, content: e.content, feeling: e.feeling })))}` : '',
      ].filter(Boolean).join('\n\n')
      const userContent = [
        `褰撳墠鏄 ${note.entryDate} 鐨勬墜璁伴噸鏂板鐩樿姹傦細${message.trim()}`,
        '褰撳墠缂栬緫鍣ㄧ殑鏈€鏂拌崏绋匡紙鏈潵鍙兘杩樻湭淇濆瓨锛夛細', draft.trim() || '锛堢┖锛?',
        dayFacts,
      ].join('\n\n')
      const actor = context.get('actor')
      const activeConversationId = conversationId!
      const streamKey = `${actor.id}:${activeConversationId}`
      const controller = dailyAiStreams.begin(streamKey, context.req.raw.signal)
      await services.aiConversation.append({ conversationId: activeConversationId, role: 'user', status: 'completed', content: message.trim() })
      const parts: string[] = []
      const stream = services.ai.stream([{ role: 'user', content: userContent }], controller.signal, actor, context.get('requestId'), activeConversationId, 'daily-note')
      const readable = new ReadableStream<Uint8Array>({ async start(writer) {
        const encoder = new TextEncoder(); let status: AiConversationMessageStatus = 'completed'
        try { for await (const event of stream) { if (event.type === 'token') parts.push(event.content); if (event.type === 'incomplete') status = 'incomplete'; if (event.type === 'error') status = controller.signal.aborted ? 'aborted' : 'error'; writer.enqueue(encoder.encode(sse(event))) } }
        catch { status = controller.signal.aborted ? 'aborted' : 'error' }
        finally { if (parts.length) await services.aiConversation!.append({ conversationId: activeConversationId, role: 'assistant', status, content: parts.join('') }).catch(() => undefined); dailyAiStreams.finish(streamKey, controller); writer.close() }
      }})
      const response = new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
      const origin = context.req.header('origin')
      if (origin) { response.headers.set('access-control-allow-origin', origin); response.headers.set('access-control-allow-credentials', 'true'); response.headers.set('access-control-expose-headers', 'x-kb-session-token'); response.headers.set('vary', 'origin') }
      return response
    })
    .post('/:id/ai/todos', async (context: any) => {
      const services = requireServices(context)
      if (!services.dailyNotes || !services.ai || !services.aiConversation) throw new ApiError(503, 'MYSQL_UNAVAILABLE', 'daily note AI unavailable')
      const body = await context.req.json().catch(() => undefined); const draft = body?.draft
      if (typeof draft !== 'string' || draft.length > 100000) throw new ApiError(400, 'VALIDATION_FAILED', 'invalid daily note draft')
      const note = await services.dailyNotes.getMine(context.req.param('id')); if (!note) throw new ApiError(404, 'NOT_FOUND', 'daily note not found')
      let output = ''
      for await (const event of services.ai.stream([{ role: 'user', content: `从以下小记提取待办。只输出 JSON 数组，最多20项，每项 title 不超过120字，可选 content。\n\n${draft}` }], new AbortController().signal, context.get('actor'), context.get('requestId'))) if (event.type === 'token') output += event.content
      try {
        const parsed = parseTodoCandidates(output)
        if (!Array.isArray(parsed)) throw new Error()
        const candidates = parsed.slice(0, 20).map((entry: any, index: number) => ({ id: `${note.id}-${Date.now()}-${index}`, title: typeof entry?.title === 'string' ? entry.title.trim().slice(0, 120) : '', ...(typeof entry?.content === 'string' ? { content: entry.content.slice(0, 100000) } : {}) })).filter((entry: any) => entry.title)
        return context.json(candidates, 200)
      } catch { throw new ApiError(400, 'VALIDATION_FAILED', 'AI todo extraction was invalid') }
    })
}
