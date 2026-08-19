import { z } from '@hono/zod-openapi'
import {
  itemStatuses,
  type BackupDocument,
  type CompleteReviewResult,
  type DashboardReport,
  type DeletedExplorationTrackListEntry,
  type ExplorationTrack,
  type ExplorationTrackHistory,
  type ExplorationTrackListEntry,
  type Item,
  type ItemExplorationTrackContext,
  type ItemMethodSourceDisplay,
  type ItemStatusEvent,
  type Method,
  type MethodApplicationContextResult,
  type MethodEvidenceDetail,
  type MethodVersion,
  type Review,
  type SearchResult,
  type TrashEntry,
} from '@knowledge-base/contracts'

const itemStatusSchema = z.enum(itemStatuses)

// Items and exploration tracks

export const itemSchema: z.ZodType<Item> = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  status: itemStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
  startAction: z.string().optional(),
  explorationTrackId: z.string().optional(),
}).openapi('Item')

export const itemStatusEventSchema: z.ZodType<ItemStatusEvent> = z.object({
  id: z.string(),
  itemId: z.string(),
  fromStatus: itemStatusSchema.optional(),
  toStatus: itemStatusSchema,
  createdAt: z.string(),
}).openapi('ItemStatusEvent')

const explorationTrackObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
})

export const explorationTrackSchema: z.ZodType<ExplorationTrack> = explorationTrackObjectSchema
  .openapi('ExplorationTrack')

export const explorationTrackListEntrySchema: z.ZodType<ExplorationTrackListEntry> = z.object({
  track: explorationTrackSchema,
  latestAssociatedItem: z.object({
    id: z.string(),
    title: z.string(),
    status: itemStatusSchema,
    createdAt: z.string(),
  }).optional(),
}).openapi('ExplorationTrackListEntry')

export const deletedExplorationTrackListEntrySchema: z.ZodType<DeletedExplorationTrackListEntry> = z.object({
  track: z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string(),
  }),
}).openapi('DeletedExplorationTrackListEntry')

const explorationTrackItemSchema = z.object({
  item: z.object({
    id: z.string(),
    title: z.string(),
    status: itemStatusSchema,
    createdAt: z.string(),
    startAction: z.string().optional(),
  }),
  locator: z.object({
    itemId: z.string(),
    status: itemStatusSchema,
  }),
  reviewSummary: z.object({
    actualAction: z.string(),
    result: z.string(),
  }).optional(),
  reviewSummaryStatus: z.enum(['available', 'not-reviewed', 'unavailable']),
})

export const explorationTrackHistorySchema: z.ZodType<ExplorationTrackHistory> = z.object({
  track: explorationTrackSchema,
  lifecycle: z.enum(['active', 'deleted']),
  currentAssociatedItems: z.array(z.object({
    status: z.enum(['doing']),
    items: z.array(explorationTrackItemSchema),
    hasMore: z.boolean(),
    moreLocator: z.object({
      status: z.enum(['doing']),
      explorationTrackId: z.string(),
    }).optional(),
  })),
  history: z.array(explorationTrackItemSchema),
  abandonedHistory: z.array(explorationTrackItemSchema),
}).openapi('ExplorationTrackHistory')

const availableExplorationTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const deletedExplorationTrackSchema = availableExplorationTrackSchema.extend({
  deletedAt: z.string(),
})

export const itemExplorationTrackContextSchema: z.ZodType<ItemExplorationTrackContext> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no-association'), itemId: z.string() }),
  z.object({ status: z.literal('available'), itemId: z.string(), track: availableExplorationTrackSchema }),
  z.object({ status: z.literal('track-deleted'), itemId: z.string(), track: deletedExplorationTrackSchema }),
  z.object({ status: z.literal('unavailable'), itemId: z.string(), trackId: z.string() }),
]).openapi('ItemExplorationTrackContext')

// Reviews, methods and method applications

export const reviewSchema: z.ZodType<Review> = z.object({
  id: z.string(),
  itemId: z.string(),
  actualAction: z.string(),
  result: z.string(),
  effective: z.string(),
  incompatible: z.string(),
  reason: z.string(),
  adjustment: z.string(),
  newIdeas: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('Review')

export const methodSchema: z.ZodType<Method> = z.object({
  id: z.string(),
  title: z.string(),
  applicable: z.string(),
  unsuitable: z.string(),
  steps: z.string(),
  validationCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
}).openapi('Method')

export const methodVersionSchema: z.ZodType<MethodVersion> = z.object({
  id: z.string(),
  methodId: z.string(),
  version: z.number().int(),
  title: z.string(),
  applicable: z.string(),
  unsuitable: z.string(),
  steps: z.string(),
  sourceReviewId: z.string().optional(),
  createdAt: z.string(),
}).openapi('MethodVersion')

export const methodEvidenceDetailSchema: z.ZodType<MethodEvidenceDetail> = z.object({
  evidenceId: z.string(),
  methodId: z.string(),
  reviewId: z.string(),
  itemId: z.string(),
  itemTitle: z.string(),
  reviewCreatedAt: z.string(),
  reviewSummary: z.string(),
  relation: z.enum(['formation', 'validation', 'revision', 'unknown']),
  methodVersion: z.number().int().optional(),
}).openapi('MethodEvidenceDetail')

const methodApplicationSchema = z.object({
  id: z.string(),
  methodId: z.string(),
  methodVersion: z.number().int(),
  itemId: z.string(),
  createdAt: z.string(),
})

const methodTombstoneSchema = z.object({
  methodId: z.string(),
  title: z.string(),
  permanentlyDeletedAt: z.string(),
  versions: z.array(z.object({ version: z.number().int() })),
})

export const methodApplicationContextSchema: z.ZodType<MethodApplicationContextResult> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no-association') }),
  z.object({
    status: z.literal('available'),
    application: methodApplicationSchema,
    method: methodSchema,
    version: methodVersionSchema,
  }),
  z.object({
    status: z.literal('method-in-trash'),
    application: methodApplicationSchema,
    method: methodSchema,
    version: methodVersionSchema,
  }),
  z.object({
    status: z.literal('method-purged'),
    application: methodApplicationSchema,
    tombstone: methodTombstoneSchema,
  }),
  z.object({
    status: z.literal('unavailable'),
    application: methodApplicationSchema,
    reason: z.enum(['method-missing', 'version-missing', 'method-and-version-missing']),
  }),
]).openapi('MethodApplicationContext')

export const itemMethodSourceDisplaySchema: z.ZodType<ItemMethodSourceDisplay> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('no-association'), itemId: z.string() }),
  z.object({ status: z.literal('available'), itemId: z.string(), title: z.string() }),
  z.object({ status: z.literal('method-in-trash'), itemId: z.string(), title: z.string() }),
  z.object({ status: z.literal('method-purged'), itemId: z.string(), title: z.string() }),
  z.object({ status: z.literal('unavailable'), itemId: z.string(), title: z.string().optional() }),
]).openapi('ItemMethodSourceDisplay')

export const completeReviewResultSchema: z.ZodType<CompleteReviewResult> = z.object({
  item: itemSchema,
  review: reviewSchema,
  method: methodSchema.optional(),
  createdIdea: itemSchema.optional(),
}).openapi('CompleteReviewResult')

// Read models and trash

export const searchResultSchema: z.ZodType<SearchResult> = z.object({
  id: z.string(),
  type: z.enum(['item', 'review', 'method', 'daily-note', 'exploration-track']),
  title: z.string(),
  excerpt: z.string(),
  itemId: z.string().optional(),
  itemStatus: itemStatusSchema.optional(),
  methodId: z.string().optional(),
  methodVersion: z.number().int().optional(),
  entryDate: z.string().optional(),
  explorationTrackId: z.string().optional(),
  deletedAt: z.string().optional(),
}).openapi('SearchResult')

const dashboardDrilldownRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  itemId: z.string().optional(),
  methodId: z.string().optional(),
})

const dashboardMethodInsightSchema = z.object({
  methodId: z.string(),
  title: z.string(),
  count: z.number().int(),
  detail: z.string(),
})

export const dashboardReportSchema: z.ZodType<DashboardReport> = z.object({
  window: z.enum(['7d', '30d', 'all']),
  metrics: z.object({
    newItems: z.number().int(),
    startedExecutions: z.number().int(),
    completedReviews: z.number().int(),
    newMethods: z.number().int(),
    methodValidations: z.number().int(),
    methodRevisions: z.number().int(),
    methodApplications: z.number().int(),
  }),
  metricRecords: z.object({
    newItems: z.array(dashboardDrilldownRecordSchema),
    startedExecutions: z.array(dashboardDrilldownRecordSchema),
    completedReviews: z.array(dashboardDrilldownRecordSchema),
    newMethods: z.array(dashboardDrilldownRecordSchema),
    methodValidations: z.array(dashboardDrilldownRecordSchema),
    methodRevisions: z.array(dashboardDrilldownRecordSchema),
    methodApplications: z.array(dashboardDrilldownRecordSchema),
  }),
  backlog: z.object({
    ideaToTry: z.number().int(),
    doing: z.number().int(),
    waitingReview: z.number().int(),
    paused: z.number().int(),
    ideaLater: z.number().int(),
  }),
  mostValidated: dashboardMethodInsightSchema.optional(),
  mostApplied: dashboardMethodInsightSchema.optional(),
  recentlyRevised: dashboardMethodInsightSchema.optional(),
  unreviewedMethodActions: z.number().int(),
  facts: z.array(z.string()),
}).openapi('DashboardReport')

export const trashEntrySchema: z.ZodType<TrashEntry> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), id: z.string(), title: z.string(), deletedAt: z.string() }),
  z.object({ type: z.literal('method'), id: z.string(), title: z.string(), deletedAt: z.string() }),
  z.object({ type: z.literal('exploration-track'), id: z.string(), title: z.string(), deletedAt: z.string() }),
]).openapi('TrashEntry')

// Backup persistence document

const methodEvidenceSchema = z.object({
  id: z.string(),
  methodId: z.string(),
  reviewId: z.string(),
  createdAt: z.string(),
  relation: z.enum(['formation', 'validation', 'revision', 'unknown']).optional(),
  methodVersion: z.number().int().optional(),
})

const itemLinkSchema = z.object({
  id: z.string(),
  sourceReviewId: z.string(),
  targetItemId: z.string(),
  type: z.literal('derived_from_review'),
  createdAt: z.string(),
})

const backupDataFields = {
  items: z.array(itemSchema),
  reviews: z.array(reviewSchema),
  methods: z.array(methodSchema),
  methodEvidence: z.array(methodEvidenceSchema),
  methodVersions: z.array(methodVersionSchema),
  methodApplications: z.array(methodApplicationSchema),
  itemStatusEvents: z.array(itemStatusEventSchema),
  itemLinks: z.array(itemLinkSchema),
}

const backupDataV1Schema = z.object({
  ...backupDataFields,
  methodTombstones: z.array(methodTombstoneSchema).optional(),
})

const backupDataSchema = z.object({
  ...backupDataFields,
  methodTombstones: z.array(methodTombstoneSchema),
})

const backupDataV3Schema = backupDataSchema.extend({
  explorationTracks: z.array(explorationTrackObjectSchema.extend({ normalizedName: z.string() })),
})

export const backupDocumentSchema: z.ZodType<BackupDocument> = z.discriminatedUnion('version', [
  z.object({
    format: z.literal('knowledge-base-backup'),
    version: z.literal(1),
    exportedAt: z.string(),
    appVersion: z.string(),
    data: backupDataV1Schema,
  }),
  z.object({
    format: z.literal('knowledge-base-backup'),
    version: z.literal(2),
    exportedAt: z.string(),
    appVersion: z.string(),
    data: backupDataSchema,
  }),
  z.object({
    format: z.literal('knowledge-base-backup'),
    version: z.literal(3),
    exportedAt: z.string(),
    appVersion: z.string(),
    data: backupDataV3Schema,
  }),
]).openapi('BackupDocument')

/**
 * 恢复入口必须继续由 Application 完整校验旧版本兼容与跨集合引用。
 * 此 schema 只提供 RPC 输入类型，不在 Zod 中提前拒绝旧备份。
 */
export const backupDocumentInputSchema = z
  .custom<BackupDocument>(() => true)
  .openapi('BackupDocumentInput', { type: 'object' })
