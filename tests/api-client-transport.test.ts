import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, isApiClientAbort, isApiClientUnknownOutcome } from '../apps/client/src/pages/index/api-client'

describe('H5 API client transport outcomes', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it.each([400, 409, 500, 503])('keeps a confirmed HTTP %i write failure distinct from an unknown outcome', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `HTTP ${status}` } }), { status })))

    await expect(apiClient.createIdea({ title: '' })).rejects.toThrow(`HTTP ${status}`)
    await apiClient.createIdea({ title: '' }).catch((error: unknown) => expect(isApiClientUnknownOutcome(error)).toBe(false))
  })
})
