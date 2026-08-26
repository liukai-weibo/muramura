import type {
  ActivityAuditRecorder,
  CompleteReviewInput,
  CompleteReviewResult,
  Item,
  ItemMethodSourceDisplay,
  Method,
  MethodApplicationContext,
  MethodApplicationContextResult,
  MethodApplicationRepository,
  MethodRepository,
  MethodVersion,
  Review,
  ReviewRepository,
  ReviewWorkflowRepository,
} from '@knowledge-base/contracts'
import { assertItemTitleLength, normalizeItemTitle } from '@knowledge-base/domain'
import { trashCutoff } from './trash'
import { safeAuditRecord } from './audit'

/** 复盘未标记哨兵文案（与前端表单默认值一致）；审计只记录用户实际填写内容，哨兵与空值不记。 */
const REVIEW_DEFAULT_EFFECTIVE = '暂未标记有效或舒服之处'
const REVIEW_DEFAULT_INCOMPATIBLE = '暂未标记阻力或不舒服'

function reviewEffectiveIsUserInput(value: string): boolean {
  return Boolean(value.trim()) && value.trim() !== REVIEW_DEFAULT_EFFECTIVE
}

function reviewIncompatibleIsUserInput(value: string): boolean {
  return Boolean(value.trim()) && value.trim() !== REVIEW_DEFAULT_INCOMPATIBLE
}

export class ReviewApplicationService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly methodRepository: MethodRepository,
    private readonly workflowRepository: ReviewWorkflowRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  async completeReview(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    const result = await this.workflowRepository.complete({
      ...input,
      effective: input.effective ?? '',
      incompatible: input.incompatible ?? '',
      reason: input.reason ?? '',
      adjustment: input.adjustment ?? '',
      newIdeas: input.newIdeas ?? '',
    })
    await safeAuditRecord(this.auditRecorder, {
      module: 'review',
      action: 'complete',
      entityId: result.review.id,
      snapshot: JSON.stringify({
        actualAction: result.review.actualAction,
        result: result.review.result,
        ...(reviewEffectiveIsUserInput(result.review.effective) ? { effective: result.review.effective } : {}),
        ...(reviewIncompatibleIsUserInput(result.review.incompatible) ? { incompatible: result.review.incompatible } : {}),
        ...(result.review.newIdeas?.trim() ? { newIdeas: result.review.newIdeas } : {}),
      }),
    })
    return result
  }

  getReview(reviewId: string): Promise<Review | undefined> {
    return this.reviewRepository.getById(reviewId)
  }

  getReviewForItem(itemId: string): Promise<Review | undefined> {
    return this.reviewRepository.getByItemId(itemId)
  }

  listMethods(): Promise<Method[]> {
    return this.methodRepository.list()
  }

  listMethodsFromReview(reviewId: string): Promise<Method[]> {
    return this.methodRepository.listByReviewId(reviewId)
  }

  listMethodVersions(methodId: string): Promise<MethodVersion[]> {
    return this.methodRepository.listVersions(methodId)
  }

  listMethodEvidenceDetails(methodId: string) {
    return this.methodRepository.listEvidenceDetails(methodId)
  }
}

export class MethodApplicationService {
  constructor(private readonly repository: MethodApplicationRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  async createItem(methodId: string, title: string, content?: string): Promise<Item> {
    const normalizedTitle = normalizeItemTitle(title)
    assertItemTitleLength(normalizedTitle)
    const created = await this.repository.createItem({ methodId, title: normalizedTitle, content })
    await safeAuditRecord(this.auditRecorder, { module: 'method', action: 'create', entityId: created.id, snapshot: JSON.stringify({ methodId, title: created.title }) })
    return created
  }

  getContextForItem(itemId: string): Promise<MethodApplicationContext | undefined> {
    return this.repository.getContextByItemId(itemId)
  }

  getContextResultForItem(itemId: string): Promise<MethodApplicationContextResult> {
    return this.repository.getContextResultByItemId(itemId)
  }

  listSourceDisplaysForItems(itemIds: string[]): Promise<ItemMethodSourceDisplay[]> {
    return this.repository.listSourceDisplaysForItems(itemIds)
  }
}

export class MethodLifecycleApplicationService {
  constructor(private readonly repository: MethodRepository, private readonly auditRecorder?: ActivityAuditRecorder) {}

  async moveToTrash(methodId: string): Promise<void> {
    await this.repository.moveToTrash(methodId)
    await safeAuditRecord(this.auditRecorder, { module: 'method', action: 'delete', entityId: methodId })
  }

  async restore(methodId: string): Promise<Method> {
    const restored = await this.repository.restore(methodId)
    await safeAuditRecord(this.auditRecorder, { module: 'method', action: 'restore', entityId: restored.id, snapshot: JSON.stringify({ title: restored.title }) })
    return restored
  }

  async listTrash(): Promise<Method[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    return this.repository.listDeleted()
  }
}
