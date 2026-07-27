import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/index.tsx'), 'utf8')
const apiClientSource = fs.readFileSync(path.resolve(process.cwd(), 'apps/client/src/pages/index/api-client.ts'), 'utf8')

function completeReviewBody() {
  const start = pageSource.indexOf('const completeReview = () => run(async () => {')
  const end = pageSource.indexOf('  const reviewField', start)
  return start === -1 || end === -1 ? undefined : pageSource.slice(start, end)
}

describe('H5 review submission failure boundary', () => {
  it('keeps the editor and draft state intact when review submission fails', () => {
    const body = completeReviewBody()

    expect(body).toBeDefined()
    expect(body).toContain('try {')
    expect(body).toContain('await reviewApplication.completeReview({')
    expect(body).toContain('} catch (error: unknown) {')
    expect(body).toContain('setReviewError(message)')

    const failureHandler = body?.match(/\} catch \(error: unknown\) \{([\s\S]*?)\n    \}/)?.[1]
    expect(failureHandler).not.toContain('setReviewEditorItemId(undefined)')
    expect(failureHandler).not.toContain('resetReviewForm()')
    expect(failureHandler).not.toContain('updateHasNewIdea(false)')
    expect(failureHandler).not.toContain('refresh(')
  })

  it('clears the review editor only after the one complete-review request succeeds', () => {
    const body = completeReviewBody()
    const requestIndex = body?.indexOf('const result = await reviewApplication.completeReview({') ?? -1
    const catchIndex = body?.indexOf('} catch (error: unknown) {') ?? -1
    const clearEditorIndex = body?.indexOf('setReviewEditorItemId(undefined)') ?? -1
    const clearDraftIndex = body?.indexOf('resetReviewForm()') ?? -1
    const refreshIndex = body?.indexOf('await refresh(selectedItem.id)') ?? -1

    expect(body?.match(/reviewApplication\.completeReview\(/g)).toHaveLength(1)
    expect(requestIndex).toBeGreaterThan(-1)
    expect(clearEditorIndex).toBeGreaterThan(requestIndex)
    expect(clearDraftIndex).toBeGreaterThan(requestIndex)
    expect(refreshIndex).toBeGreaterThan(requestIndex)
    expect(catchIndex).toBeGreaterThan(clearEditorIndex)
    expect(catchIndex).toBeGreaterThan(clearDraftIndex)
  })

  it('submits the latest input snapshot after a failed attempt without resending the failed request', () => {
    const body = completeReviewBody()

    expect(pageSource).toContain('const reviewFormRef = useRef({ ...emptyReview })')
    expect(pageSource).toContain('const updateReviewForm =')
    expect(body).toContain('const submittedReviewForm = { ...reviewFormRef.current }')
    expect(body).toContain('...submittedReviewForm')
    expect(body).toContain('submittedReviewForm.effective')
    expect(body).toContain('submittedReviewForm.incompatible')
    expect(body).not.toContain('if (reviewForm.effective')
    expect(body).not.toContain('if (reviewForm.incompatible')
    expect(body).toContain('actualAction: submittedReviewForm.result')
    expect(body).toContain("newIdeas: submittedHasNewIdea ? submittedReviewForm.newIdeas : ''")
    expect(body?.match(/reviewApplication\.completeReview\(/g)).toHaveLength(1)
    expect(body).not.toContain('waiting_review')
  })

  it('hides the legacy execution-complete action for doing items while preserving the review entry point', () => {
    expect(apiClientSource).toContain("doing: [{ label: '暂停', status: 'paused', tone: 'secondary' }]")
    expect(apiClientSource).not.toContain("{ label: '执行完成', status: 'waiting_review'")
    expect(pageSource).toContain("{(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <Button className='action-button primary' disabled={busy} onClick={openReviewEditor}>开始复盘</Button>}")
    expect(pageSource).toContain('onClick={openReviewEditor}>开始复盘</Button>')
  })

  it('keeps delete available for historical waiting-review items without changing review entry rules', () => {
    expect(pageSource).toContain("!reviewEditing && <View className='action-stack'>")
    expect(pageSource).toContain("{(selectedItem.status === 'doing' || selectedItem.status === 'waiting_review') && <Button className='action-button primary' disabled={busy} onClick={openReviewEditor}>开始复盘</Button>}")
    expect(pageSource).not.toContain("!reviewEditing && selectedItem.status !== 'waiting_review' && <View className='action-stack'>")
  })
})
