import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import type { Item } from '@knowledge-base/contracts'
import { createIndexedDbRepository } from '@knowledge-base/storage-indexeddb'
import './index.scss'

export default function IndexPage() {
  const storage = useMemo(() => createIndexedDbRepository(), [])
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [message, setMessage] = useState('正在检查本地数据库…')

  const refresh = async () => {
    const nextItems = await storage.repository.list()
    setItems(nextItems)
    setMessage(`IndexedDB 工作正常，当前有 ${nextItems.length} 条测试想法`)
  }

  useEffect(() => {
    refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'IndexedDB 初始化失败')
    })
    return () => storage.database.close()
  }, [storage])

  const createItem = async () => {
    const value = title.trim()
    if (!value) return
    await storage.repository.create({ title: value })
    setTitle('')
    await refresh()
  }

  const removeItem = async (id: string) => {
    await storage.repository.delete(id)
    await refresh()
  }

  return (
    <View className='page'>
      <View className='hero'>
        <Text className='eyebrow'>SPRINT 0 · 技术验证</Text>
        <Text className='title'>KKK 个人系统</Text>
        <Text className='subtitle'>想法 → 执行 → 复盘 → 方法 → 新想法</Text>
      </View>

      <View className='card'>
        <Text className='card-title'>环境状态</Text>
        <View className='status-row'>
          <View className='status-dot' />
          <Text>{message}</Text>
        </View>
        <Text className='hint'>数据仅保存在当前浏览器，不会上传网络。</Text>
      </View>

      <View className='card'>
        <Text className='card-title'>IndexedDB 读写测试</Text>
        <View className='form-row'>
          <Input
            className='input'
            value={title}
            placeholder='输入一条想法'
            onInput={(event) => setTitle(event.detail.value)}
          />
          <Button className='primary-button' onClick={createItem}>保存</Button>
        </View>

        <View className='list'>
          {items.length === 0 ? (
            <Text className='empty'>还没有测试数据，可以先添加一条想法。</Text>
          ) : items.map((item) => (
            <View className='item' key={item.id}>
              <View>
                <Text className='item-title'>{item.title}</Text>
                <Text className='item-status'>想试试</Text>
              </View>
              <Button className='delete-button' size='mini' onClick={() => removeItem(item.id)}>删除</Button>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}
