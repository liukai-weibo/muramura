import { describe, expect, it } from 'vitest'
import { snapshotPreview, snapshotPretty } from '../apps/client/src/pages/index/audit-snapshot-preview'

describe('audit snapshot preview', () => {
  it('previews text-key snapshots', () => {
    expect(snapshotPreview('{"content":"心情不错"}')).toBe('心情不错')
    expect(snapshotPreview('{"title":"想开始一段旅行呢","content":"背景"}')).toBe('想开始一段旅行呢 · 背景')
    expect(snapshotPreview('{"query":"方法"}')).toBe('方法')
    expect(snapshotPreview('{"cardTitle":"健身","aiPrompt":"提示","cardSize":"medium","cardTheme":"green","refreshMode":"daily"}')).toBe('健身 · 提示')
  })

  it('previews date-only snapshots without raw JSON', () => {
    expect(snapshotPreview('{"entryDate":"2026-08-26"}')).toBe('2026-08-26')
    expect(snapshotPreview('{"cacheDate":"2026-08-26","cacheId":"abc"}')).toBe('2026-08-26')
  })

  it('previews meal snapshots by composing meals with Chinese labels', () => {
    const snapshot = JSON.stringify({ entryDate: '2026-08-26', meals: [{ mealType: 'breakfast', content: '包子', feeling: 3 }, { mealType: 'lunch', content: '面', feeling: 4 }] })
    expect(snapshotPreview(snapshot)).toBe('早餐：包子 · 午餐：面')
  })

  it('falls back to scalar key-value summary with Chinese labels', () => {
    expect(snapshotPreview('{"moodLevel":3,"tags":[]}')).toBe('情绪等级：3')
    expect(snapshotPreview('{"type":"item","id":"i1"}')).toBe('类型：事项 · ID：i1')
  })

  it('returns plain text snapshots unchanged, with ellipsis for empty', () => {
    expect(snapshotPreview('00:39\n7676\n\n凌晨有点想睡觉了')).toBe('00:39\n7676\n\n凌晨有点想睡觉了')
    expect(snapshotPreview('')).toBe('—')
    expect(snapshotPreview('null')).toBe('—')
  })

  it('pretty prints object snapshots as readable Chinese key-value lines', () => {
    expect(snapshotPretty('{"entryDate":"2026-08-26"}')).toBe('日期：2026-08-26')
    expect(snapshotPretty('{"a":1,"b":{"c":2}}')).toBe('a：1\nb：c：2')
    expect(snapshotPretty('{"cardTitle":"健身","aiPrompt":"提示","cardSize":"medium","refreshMode":"daily"}')).toBe('卡片标题：健身\nAI提示词：提示\n卡片尺寸：中\n刷新方式：每天')
  })
  it('pretty prints arrays and meals with Chinese labels and values', () => {
    const meal = '{"entryDate":"2026-08-26","meals":[{"mealType":"breakfast","content":"包子","feeling":3}]}'
    expect(snapshotPretty(meal)).toBe('日期：2026-08-26\n餐次：餐次类型：早餐、内容：包子、感受：3')
  })
  it('previews review snapshots with Chinese labels and dedupes actualAction', () => {
    const review = JSON.stringify({ actualAction: '执行', result: '执行', effective: '很有效', newIdeas: '新想法' })
    expect(snapshotPreview(review)).toBe('复盘结果：执行 · 有效 / 舒服：很有效 · 产生新想法：新想法')
    expect(snapshotPretty(review)).toBe('复盘结果：执行\n有效 / 舒服：很有效\n产生新想法：新想法')
    // actualAction 与 result 不同时两者都显示
    const distinct = JSON.stringify({ actualAction: '执行了任务', result: '成功' })
    expect(snapshotPretty(distinct)).toBe('做了什么：执行了任务\n复盘结果：成功')
  })
  it('pretty prints plain text unchanged and handles empties', () => {
    expect(snapshotPretty('plain text')).toBe('plain text')
    expect(snapshotPretty('00:39\n7676\n\n凌晨有点想睡觉了')).toBe('00:39\n7676\n\n凌晨有点想睡觉了')
    expect(snapshotPretty('')).toBe('')
    expect(snapshotPretty('null')).toBe('')
  })
})