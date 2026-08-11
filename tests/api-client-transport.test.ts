import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, isApiClientAbort, isApiClientUnknownOutcome, resolveApiTransport } from '../apps/client/src/pages/index/api-client'

describe('H5 API client transport outcomes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps Web requests on the same-origin /api proxy even when a desktop base URL is configured', () => {
    expect(resolveApiTransport({ isTauri: false, configuredOrigin: 'http://127.0.0.1:32146' })).toEqual({ origin: '', credentials: 'same-origin' })
  })

  it('uses the local API directly in Tauri when no override is configured', () => {
    expect(resolveApiTransport({ isTauri: true, configuredOrigin: '' })).toEqual({ origin: 'http://127.0.0.1:32146', credentials: 'include' })
  })

  it('uses the configured API directly in Tauri and removes trailing slashes', () => {
    expect(resolveApiTransport({ isTauri: true, configuredOrigin: 'https://api.example.test///' })).toEqual({ origin: 'https://api.example.test', credentials: 'include' })
  })

  it('forwards an AbortSignal and preserves an intentional read cancellation', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(aborted)
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.listItems(controller.signal)).rejects.toBe(aborted)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/items', expect.objectContaining({ signal: controller.signal }))
    expect(isApiClientAbort(aborted)).toBe(true)
  })

  it('treats a write transport failure before a response as an unknown outcome without retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network interrupted'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.createIdea({ title: '可能已创建' })).rejects.toSatisfy(isApiClientUnknownOutcome)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the overwrite confirmation only when the caller explicitly provides it', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: 'item-1' }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.startExecution('item-1', { startAction: '新动作', overwriteExistingStartAction: true })
    await apiClient.startExecution('item-1', { startAction: '同值动作' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/items/item-1/start', expect.objectContaining({ method: 'POST', body: JSON.stringify({ startAction: '新动作', overwriteExistingStartAction: true }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/items/item-1/start', expect.objectContaining({ method: 'POST', body: JSON.stringify({ startAction: '同值动作' }) }))
  })

  it('requests the frozen exploration-track trash filter through the existing trash route', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.listTrashEntries('exploration-track', controller.signal)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/trash?filter=exploration-track', expect.objectContaining({ signal: controller.signal }))
  })

  it.each([400, 409, 500, 503])('keeps a confirmed HTTP %i write failure distinct from an unknown outcome', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `HTTP ${status}` } }), { status })))

    await expect(apiClient.createIdea({ title: '' })).rejects.toThrow(`HTTP ${status}`)
    await apiClient.createIdea({ title: '' }).catch((error: unknown) => expect(isApiClientUnknownOutcome(error)).toBe(false))
  })
})
