import { createRoute } from '@hono/zod-openapi'
import { requireJson } from '../http'
import { requireServices } from '../auth-middleware'
import { commonErrorResponses, createOpenApiApp, jsonSuccess } from '../openapi'
import { backupDocumentInputSchema, backupDocumentSchema } from '../schemas'

const exportBackupRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Backup'],
  summary: '导出备份',
  description: '导出当前用户作用域内的完整备份 JSON 文档。',
  responses: {
    200: jsonSuccess(backupDocumentSchema, '备份文档'),
    401: commonErrorResponses[401],
    500: commonErrorResponses[500],
  },
})

const restoreBackupRoute = createRoute({
  middleware: [requireJson],
  method: 'post',
  path: '/restore',
  tags: ['Backup'],
  summary: '恢复备份',
  description: '校验并整库恢复备份文档；成功时返回 204。',
  request: {
    body: { required: true, content: { 'application/json': { schema: backupDocumentInputSchema } } },
  },
  responses: {
    204: { description: '恢复成功' },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    415: commonErrorResponses[415],
    500: commonErrorResponses[500],
  },
})

export function createBackupRoutes() {
  return createOpenApiApp()
    .openapi(exportBackupRoute, async (context) => {
      const services = requireServices(context)
      return context.json(await services.backup.createBackup(), 200)
    })

    .openapi(restoreBackupRoute, async (context) => {
      const services = requireServices(context)
      const document = services.backup.parseAndValidate(JSON.stringify(context.req.valid('json')))
      await services.backup.restoreBackup(document)
      return context.body(null, 204)
    })
}
