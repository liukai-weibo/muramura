import type {
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

export class ReviewApplicationService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly methodRepository: MethodRepository,
    private readonly workflowRepository: ReviewWorkflowRepository,
  ) {}

  completeReview(input: CompleteReviewInput): Promise<CompleteReviewResult> {
    return this.workflowRepository.complete({
      ...input,
      effective: input.effective ?? '',
      incompatible: input.incompatible ?? '',
      reason: input.reason ?? '',
      adjustment: input.adjustment ?? '',
      newIdeas: input.newIdeas ?? '',
    })
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
  constructor(private readonly repository: MethodApplicationRepository) {}

  createItem(methodId: string, title: string, content?: string): Promise<Item> {
    const normalizedTitle = normalizeItemTitle(title)
    assertItemTitleLength(normalizedTitle)
    return this.repository.createItem({ methodId, title: normalizedTitle, content })
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
  constructor(private readonly repository: MethodRepository) {}

  moveToTrash(methodId: string): Promise<void> {
    return this.repository.moveToTrash(methodId)
  }

  restore(methodId: string): Promise<Method> {
    return this.repository.restore(methodId)
  }

  async listTrash(): Promise<Method[]> {
    await this.repository.purgeDeletedBefore(trashCutoff())
    return this.repository.listDeleted()
  }
}
