import { describe, expect, it } from 'vitest'
import type { AiChatMessage, AiKnowledgeOverview, AiStreamEvent } from '../packages/contracts/src'
import { buildAiSystemMessage, AiChatApplicationService } from '../packages/application/src/experimental-ai'

/** 记录调用的 mock 集合，验证 ephemeral 模式只做最少的准备工作。 */
function createMocks() {
  const calls = {
    search: 0,
    conversation: 0,
    preferences: 0,
    dailyNotes: 0,
    knowledge: 0,
    providerMessages: [] as AiChatMessage[][],
  }
  const config = { current: async () => ({ config: { serviceName: 'test', modelName: 'model', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', temperature: 0.8, topP: 0.9, presencePenalty: 0.3, frequencyPenalty: 0.4 }, generation: 1 }) }
  const search = { search: async () => { calls.search++; return [] } } as any
  const provider = {
    async *stream(_config: unknown, messages: AiChatMessage[]) {
      calls.providerMessages.push(messages)
      yield { type: 'token', content: 'hi' } as AiStreamEvent
      yield { type: 'done' } as AiStreamEvent
    },
  }
  const knowledge = { read: async (_user: unknown) => {
    calls.knowledge++
    return {
      profile: { username: 'u1', roles: ['admin'], createdAt: '2026-01-01T00:00:00.000Z' },
      itemStatusCounts: { doing: 1, reviewed: 0 },
      items: [], explorations: [], reviews: [], methods: [],
      moodEntries: [{ entryDate: '2026-08-26', moodLevel: 4, content: '平稳' }],
      mealEntries: [], trash: [],
      dashboard: { metrics: {}, backlog: { doing: 1 }, unreviewedMethodActions: 0, facts: [] },
    } as unknown as AiKnowledgeOverview
  } }
  const conversation = { getDefault: async () => { calls.conversation++; return { id: 'conv-1' } }, listMessages: async () => [] } as any
  const preferences = { readForAi: async () => { calls.preferences++; return [] } }
  const dailyNotes = { listMine: async () => { calls.dailyNotes++; return [] } } as any
  return { calls, config, search, provider, knowledge, conversation, preferences, dailyNotes }
}

async function drain(service: AiChatApplicationService, mode: 'full' | 'ephemeral' = 'ephemeral', timeAnchor?: string) {
  for await (const _event of service.stream([{ role: 'user', content: '分析下我最近的状态' }], new AbortController().signal, { id: 'u1' } as any, 'req-1', undefined, mode, timeAnchor)) { /* consume */ }
}

describe('AI ephemeral generation mode', () => {
  it('skips search/conversation/preferences/dailyNotes but keeps knowledge overview', async () => {
    const m = createMocks()
    const service = new AiChatApplicationService(m.config as any, m.search, m.provider as any, m.knowledge as any, m.conversation as any, undefined, m.preferences as any, m.dailyNotes as any)
    await drain(service, 'ephemeral')
    expect(m.calls.search).toBe(0)
    expect(m.calls.conversation).toBe(0)
    expect(m.calls.preferences).toBe(0)
    expect(m.calls.dailyNotes).toBe(0)
    expect(m.calls.knowledge).toBe(1)
    // provider 收到 system + 拼接了 overview 上下文的 user 消息
    expect(m.calls.providerMessages).toHaveLength(1)
    const prompt = m.calls.providerMessages[0]!
    expect(prompt[0]!.role).toBe('system')
    expect(prompt[1]!.content).toContain('Profile: username=')
  })

  it('uses the brief system message without chat-only sections', async () => {
    const m = createMocks()
    const service = new AiChatApplicationService(m.config as any, m.search, m.provider as any, m.knowledge as any, m.conversation as any, undefined, m.preferences as any, m.dailyNotes as any)
    await drain(service, 'ephemeral')
    const system = m.calls.providerMessages[0]![0]!.content
    expect(system).toContain('AI response policy')
    expect(system).toContain('business semantics')
    expect(system).not.toContain('concept categories')
    expect(system).not.toContain('leading hunter personality')
    // full 模式仍然完整
    const full = buildAiSystemMessage(false).content
    expect(full).toContain('concept categories')
    expect(full).toContain('leading hunter personality')
  })

  it('injects the client time anchor into the system message', async () => {
    const m = createMocks()
    const service = new AiChatApplicationService(m.config as any, m.search, m.provider as any, m.knowledge as any, m.conversation as any, undefined, m.preferences as any, m.dailyNotes as any)
    await drain(service, 'ephemeral', '现在是 2026-08-27 星期四 13:20')
    const system = m.calls.providerMessages[0]![0]!.content
    expect(system).toContain('Current user local time')
    expect(system).toContain('现在是 2026-08-27 星期四 13:20')
  })

  it('falls back to a server-generated anchor when timeAnchor is absent', async () => {
    const m = createMocks()
    const service = new AiChatApplicationService(m.config as any, m.search, m.provider as any, m.knowledge as any, m.conversation as any, undefined, m.preferences as any, m.dailyNotes as any)
    await drain(service, 'ephemeral')
    const system = m.calls.providerMessages[0]![0]!.content
    expect(system).toContain('Current user local time')
    expect(system).toMatch(/现在是 /)
  })

  it('full mode keeps reading conversation and preferences', async () => {
    const m = createMocks()
    const service = new AiChatApplicationService(m.config as any, m.search, m.provider as any, m.knowledge as any, m.conversation as any, undefined, m.preferences as any, m.dailyNotes as any)
    await drain(service, 'full')
    expect(m.calls.search).toBe(1)
    expect(m.calls.conversation).toBe(1)
    expect(m.calls.preferences).toBe(1)
    expect(m.calls.dailyNotes).toBe(1)
  })
})
