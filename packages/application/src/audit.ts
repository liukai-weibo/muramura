import type { ActivityAuditEventDraft, ActivityAuditRecorder, ActivityAuditRepository } from '@knowledge-base/contracts'

/**
 * 面向 Application 服务的窄化录制器：绑定 actor 身份，服务层只声明操作与内容。
 * 录制失败不外抛——审计是追加日志，业务写入成功即既成事实，绝不回滚或阻断。
 */
export class ScopedActivityAuditRecorder implements ActivityAuditRecorder {
  constructor(
    private readonly repository: ActivityAuditRepository,
    private readonly actor: { userId: string; username?: string },
  ) {}

  record(draft: ActivityAuditEventDraft): Promise<void> {
    return this.repository.record({
      actorUserId: this.actor.userId,
      actorUsername: this.actor.username,
      module: draft.module,
      action: draft.action,
      entityId: draft.entityId,
      snapshot: draft.snapshot,
    })
  }
}

/** 录制失败静默降级：仅记日志，不抛异常、不回滚业务。 */
export async function safeAuditRecord(recorder: ActivityAuditRecorder | undefined, draft: ActivityAuditEventDraft): Promise<void> {
  if (!recorder) return
  try {
    await recorder.record(draft)
  } catch (error) {
    console.warn('[activity-audit] record skipped:', error instanceof Error ? error.message : String(error))
  }
}
