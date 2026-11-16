import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const inlineCreate = readFileSync(new URL('../apps/client/src/pages/index/features/tasks/task-inline-create.tsx', import.meta.url), 'utf8')
const tasksStyles = readFileSync(new URL('../apps/client/src/pages/index/features/tasks/tasks-page.scss', import.meta.url), 'utf8')

// Taro 会把样式里的 `input` 标签选择器改写成 taro-input-core。这个组件渲染的是原生
// <input>，标签选择器匹配不到，浏览器默认的深色边框就会在褐色圆角行里露出来。
describe('task inline create input', () => {
  it('styles the native input through a class instead of a tag selector', () => {
    expect(inlineCreate).toContain("className='task-inline-input'")
    expect(tasksStyles).toContain('.task-inline-fields .task-inline-input {')
    expect(tasksStyles).not.toMatch(/\.task-inline-fields input\s*\{/)
  })

  it('removes the browser default box so only the row paints a border', () => {
    const rule = tasksStyles.match(/\.task-inline-fields \.task-inline-input \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('border: 0')
    expect(rule).toContain('background: transparent')
    expect(rule).toContain('appearance: none')
  })
})
