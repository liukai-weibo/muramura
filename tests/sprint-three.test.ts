import { afterEach, describe, expect, it } from 'vitest'
import { BackupApplicationService, ItemApplicationService, ReviewApplicationService } from '@knowledge-base/application'
import type { BackupData } from '@knowledge-base/contracts'
import { createIndexedDbRepository, type KnowledgeDatabase } from '@knowledge-base/storage-indexeddb'

const databases: KnowledgeDatabase[] = []

function createServices() {
  const storage = createIndexedDbRepository(`backup-${crypto.randomUUID()}`)
  databases.push(storage.database)
  return {
    storage,
    items: new ItemApplicationService(storage.repository),
    reviews: new ReviewApplicationService(
      storage.reviewRepository,
      storage.methodRepository,
      storage.reviewWorkflowRepository,
    ),
    backup: new BackupApplicationService(storage.backupRepository),
  }
}

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('Sprint 3 JSON 备份与恢复', () => {
  it('导出并完整恢复事项、复盘、方法、证据和来源关系', async () => {
    const source = createServices()
    const item = await source.items.createIdea({ title: '验证完整备份' })
    await source.items.changeStatus(item.id, 'doing')
    await source.items.changeStatus(item.id, 'waiting_review')
    await source.reviews.completeReview({
      itemId: item.id,
      actualAction: '执行了一次备份实验',
      result: '得到完整备份文件',
      effective: '',
      incompatible: '',
      reason: '',
      adjustment: '',
      newIdeas: '继续验证恢复流程',
      method: {
        title: '个人数据备份方法',
        applicable: '重大更新前',
        steps: '导出 JSON → 保存到可靠位置',
      },
    })
    const deleted = await source.items.createIdea({ title: '回收站记录' })
    await source.items.deleteItem(deleted.id)

    const document = await source.backup.createBackup()
    expect(document).toMatchObject({ format: 'knowledge-base-backup', version: 1, appVersion: '0.1.0' })

    const target = createServices()
    await target.items.createIdea({ title: '将被覆盖的数据' })
    const parsed = target.backup.parseAndValidate(JSON.stringify(document))
    await target.backup.restoreBackup(parsed)

    expect(await target.storage.backupRepository.exportData()).toEqual(document.data)
    expect((await target.items.listTrash()).map((entry) => entry.title)).toEqual(['回收站记录'])
  })

  it('拒绝非法 JSON、未知版本和断裂关系', () => {
    const { backup } = createServices()

    expect(() => backup.parseAndValidate('{')).toThrow('不是有效的 JSON')
    expect(() => backup.parseAndValidate(JSON.stringify({ format: 'other', version: 1 }))).toThrow('不是本系统的备份文件')
    expect(() => backup.parseAndValidate(JSON.stringify({ format: 'knowledge-base-backup', version: 2, data: {} }))).toThrow('不支持的备份版本')

    const broken = {
      format: 'knowledge-base-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      data: {
        items: [],
        reviews: [{ id: 'review-1', itemId: 'missing-item' }],
        methods: [],
        methodEvidence: [],
        itemLinks: [],
      },
    }
    expect(() => backup.parseAndValidate(JSON.stringify(broken))).toThrow('复盘引用了不存在的事项')
  })

  it('覆盖写入失败时回滚并保留原数据', async () => {
    const { items, storage } = createServices()
    const original = await items.createIdea({ title: '必须保留的原数据' })
    const duplicate = await storage.backupRepository.exportData()
    const invalidData: BackupData = {
      ...duplicate,
      items: [duplicate.items[0]!, { ...duplicate.items[0]! }],
    }

    await expect(storage.backupRepository.replaceData(invalidData)).rejects.toThrow()
    expect(await storage.database.items.get(original.id)).toMatchObject({ title: '必须保留的原数据' })
    expect(await storage.database.items.count()).toBe(1)
  })
})
