/**
 * 审计中心快照展示辅助：列表可读摘要与弹窗完整展示。
 * 独立于组件，便于单元测试（无 Taro/React 依赖）。
 */

import { AUDIT_SNAPSHOT_KEY_LABELS, AUDIT_SNAPSHOT_VALUE_LABELS } from '@knowledge-base/contracts'

const SNAPSHOT_TEXT_KEYS = ['title', 'cardTitle', 'name', 'query', 'content', 'aiPrompt', 'description'] as const

/** 快照字段名 → 中文标签（来自 contracts 单一来源，展示层仅翻译不改业务数据）。 */
const SNAPSHOT_KEY_LABELS = AUDIT_SNAPSHOT_KEY_LABELS

function labelKey(key: string): string {
  return SNAPSHOT_KEY_LABELS[key] ?? key
}

function labelValue(value: string): string {
  return AUDIT_SNAPSHOT_VALUE_LABELS[value] ?? value
}

/** 列表快照栏可读摘要：文本键 → 日期 → 餐次 → 标量键串联，避免裸显示压缩 JSON。 */
export function snapshotPreview(snapshot: string): string {
  if (!snapshot) return '—'
  try {
    const parsed = JSON.parse(snapshot) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return snapshotSummary(parsed as Record<string, unknown>)
    if (parsed === null) return '—'
    if (typeof parsed === 'string') return parsed || '—'
    return JSON.stringify(parsed)
  } catch { /* fall through */ }
  return snapshot
}

function snapshotSummary(record: Record<string, unknown>): string {
  const texts: string[] = []
  for (const key of SNAPSHOT_TEXT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) texts.push(value.trim())
    if (texts.length >= 2) break
  }
  if (texts.length) return texts.join(' · ')
  if (Array.isArray(record.meals) && record.meals.length) {
    const parts = record.meals.map((meal) => {
      if (meal && typeof meal === 'object') {
        const content = typeof (meal as Record<string, unknown>).content === 'string' ? (meal as Record<string, unknown>).content : undefined
        const typeValue: unknown = (meal as Record<string, unknown>).mealType
        const type = typeof typeValue === 'string' ? typeValue : undefined
        return content ? (type ? labelValue(type) + '：' + content : content) : JSON.stringify(meal)
      }
      return String(meal)
    })
    if (parts.length) return parts.join(' · ')
  }
  const dateValue = typeof record.entryDate === 'string' ? record.entryDate : typeof record.cacheDate === 'string' ? record.cacheDate : undefined
  if (dateValue) return dateValue
  const entries = reviewEntries(record)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    .map(([key, value]) => labelKey(key) + '：' + (typeof value === 'string' ? labelValue(value) : String(value)))
  if (entries.length) return entries.join(' · ')
  return JSON.stringify(record)
}

/** 弹窗内展示完整快照：对象转为逐行“键：可读值”，数组/嵌套平铺为可读串，纯文本原样保留；不再裸展示原始 JSON。 */
export function snapshotPretty(snapshot: string): string {
  if (!snapshot) return ''
  try {
    const parsed = JSON.parse(snapshot) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const lines = reviewEntries(parsed as Record<string, unknown>).map(([key, value]) => labelKey(key) + '：' + formatValue(value))
      return lines.join('\n')
    }
    if (Array.isArray(parsed)) return formatValue(parsed)
    if (parsed === null) return ''
    return String(parsed)
  } catch { /* fall through */ }
  return snapshot
}

/** review 快照里“做了什么”与“复盘结果”相同时只保留复盘结果，避免重复展示。 */
function reviewEntries(record: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(record)
  const actual = entries.find(([key]) => key === 'actualAction')
  const result = entries.find(([key]) => key === 'result')
  if (actual && result && actual[1] !== undefined && actual[1] !== null && String(actual[1]) === String(result[1])) {
    return entries.filter(([key]) => key !== 'actualAction')
  }
  return entries
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return labelValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return Object.entries(item as Record<string, unknown>).map(([key, sub]) => labelKey(key) + '：' + formatValue(sub)).join('、')
      }
      return formatValue(item)
    })
    return parts.join('；')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, sub]) => labelKey(key) + '：' + formatValue(sub)).join('、')
  }
  return String(value)
}