/** 用随机 UUID 稳定分配柔和底色，刷新、完成或移池不会重新闪色。 */
export function taskTintIndex(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0
  return (hash >>> 0) % 6
}

export function taskTintClass(id: string): string {
  return `task-tint-${taskTintIndex(id)}`
}
