import type { ActivityAuditRecorder, AiPreference, AiPreferenceBackupStore, AiPreferenceInput, AiPreferenceKey, AiPreferenceRepository } from '@knowledge-base/contracts'
import { aiPreferenceKeys } from '@knowledge-base/contracts'
import { BusinessError, createId } from '@knowledge-base/domain'
import { safeAuditRecord } from './audit'

const MAX_VALUE_LENGTH = 2000
const isKey = (value: unknown): value is AiPreferenceKey => typeof value === 'string' && (aiPreferenceKeys as readonly string[]).includes(value)

export class AiPreferenceApplicationService {
  constructor(
    private readonly repository: AiPreferenceRepository,
    private readonly auditRecorder?: ActivityAuditRecorder,
  ) {}

  listMine(): Promise<AiPreference[]> { return this.repository.listMine() }

  async createConfirmed(input: AiPreferenceInput): Promise<AiPreference> {
    const normalized = validateInput(input)
    const now = new Date().toISOString()
    const created = await this.repository.create({ id: createId(), key: normalized.key, value: normalized.value, source: 'user_confirmed', createdAt: now, updatedAt: now })
    await safeAuditRecord(this.auditRecorder, { module: 'ai_preference', action: 'create', entityId: created.id, snapshot: JSON.stringify({ key: created.key }) })
    return created
  }

  async updateMine(id: string, input: AiPreferenceInput): Promise<AiPreference> {
    if (!id.trim()) throw new BusinessError('AI_PREFERENCE_NOT_FOUND', 'not-found', '偏好不存在')
    const normalized = validateInput(input)
    const updated = await this.repository.updateMine(id, { ...normalized, updatedAt: new Date().toISOString() })
    if (!updated) throw new BusinessError('AI_PREFERENCE_NOT_FOUND', 'not-found', '偏好不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'ai_preference', action: 'update', entityId: updated.id, snapshot: JSON.stringify({ key: updated.key }) })
    return updated
  }

  async deleteMine(id: string): Promise<void> {
    if (!id.trim() || !(await this.repository.deleteMine(id))) throw new BusinessError('AI_PREFERENCE_NOT_FOUND', 'not-found', '偏好不存在')
    await safeAuditRecord(this.auditRecorder, { module: 'ai_preference', action: 'delete', entityId: id })
  }

  async readForAi(): Promise<AiPreference[]> {
    try { return await this.repository.listMine() } catch { return [] }
  }
}

function validateInput(input: AiPreferenceInput): AiPreferenceInput {
  if (!input || !isKey(input.key) || typeof input.value !== 'string' || !input.value.trim() || [...input.value].length > MAX_VALUE_LENGTH) {
    throw new BusinessError('AI_PREFERENCE_INVALID', 'validation', `偏好类型或内容无效，内容不能超过 ${MAX_VALUE_LENGTH} 个字符`)
  }
  return { key: input.key, value: input.value.trim() }
}

export interface AiPreferenceContextReader { readForAi(): Promise<AiPreference[]> }
export type AiPreferenceStores = AiPreferenceRepository & AiPreferenceBackupStore
