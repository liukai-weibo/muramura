import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from '../errors'
import { requireJson } from '../http'
import type { HonoServices } from '../services'
import type { ApiEnv } from '../types'

const backupDocumentSchema = z.unknown()

export function createBackupRoutes(services: HonoServices) {
  return new Hono<ApiEnv>()
    .get('/', async (context) => context.json(await services.backup.createBackup(), 200))
    .post(
      '/restore',
      requireJson,
      zValidator('json', backupDocumentSchema, (result) => {
        if (!result.success) {
          throw new ApiError(400, 'VALIDATION_FAILED', '备份不是有效的 JSON')
        }
      }),
      async (context) => {
        const document = services.backup.parseAndValidate(
          JSON.stringify(context.req.valid('json')),
        )
        await services.backup.restoreBackup(document)
        return context.body(null, 204)
      },
    )
}
