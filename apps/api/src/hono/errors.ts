import type { Context } from 'hono'
import { BusinessError } from '@knowledge-base/domain'
import {
  ExplorationTrackError,
  MySqlSchemaNotReadyError,
} from '@knowledge-base/storage-mysql'
import type { ApiEnv, ApiErrorBody, ApiErrorCode, ApiErrorStatus } from './types'

export class ApiError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function isMySqlUnavailable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('code' in value)) return false
  return [
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ER_ACCESS_DENIED_ERROR',
    'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  ].includes(String(value.code))
}

export function mapFailure(value: unknown): [ApiErrorStatus, ApiErrorCode, string] {
  if (value instanceof ApiError) return [value.status, value.code, value.message]
  if (value instanceof BusinessError) {
    if (value.category === 'validation') return [400, 'VALIDATION_FAILED', value.message]
    if (value.category === 'not-found') return [404, 'NOT_FOUND', value.message]
    if (value.category === 'conflict') return [409, 'CONFLICT', value.message]
    return [500, 'INTERNAL_ERROR', '本地服务当前发生未分类错误']
  }
  if (value instanceof MySqlSchemaNotReadyError) {
    return [503, 'MYSQL_SCHEMA_NOT_READY', '本地 MySQL 候选环境当前不可用']
  }
  if (value instanceof Error) {
    if (value instanceof ExplorationTrackError) {
      if (value.code === 'conflict') return [409, 'CONFLICT', value.message]
      if (value.code === 'not-found' || value.code === 'deleted' || value.code === 'item-not-found') {
        return [404, 'NOT_FOUND', value.message]
      }
      if (value.code === 'unavailable' || value.code === 'invalid-status') {
        return [400, 'VALIDATION_FAILED', value.message]
      }
    }
    if ([
      '事项不存在',
      '方法不存在',
      '选择的方法不存在',
      '复盘不存在',
      '回收站中不存在该事项',
      '回收站中不存在该方法',
    ].includes(value.message)) {
      return [404, 'NOT_FOUND', value.message]
    }
    if (
      value.message.includes('已经')
      || value.message.includes('只有待复盘')
      || value.message.includes('不允许从')
      || value.message.includes('启动动作已存在')
      || value.message.includes('复盘存在方法关联')
    ) {
      return [409, 'CONFLICT', value.message]
    }
    if (
      value.message.startsWith('请填写：')
      || value.message === '标题不能为空'
      || value.message === '请完成方法标题、适用情况和具体步骤'
      || value.message.includes('备份')
      || value.message.includes('无效')
      || value.message.includes('不存在的方法版本')
      || value.message === 'V3 事项引用了不存在的主线'
    ) {
      return [400, 'VALIDATION_FAILED', value.message]
    }
  }
  if (isMySqlUnavailable(value)) {
    return [503, 'MYSQL_UNAVAILABLE', '本地 MySQL 候选环境当前不可用']
  }
  return [500, 'INTERNAL_ERROR', '本地服务当前发生未分类错误']
}

export function errorResponse(
  context: Context<ApiEnv>,
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: context.get('requestId'),
    },
  }
  return context.json(body, status)
}
