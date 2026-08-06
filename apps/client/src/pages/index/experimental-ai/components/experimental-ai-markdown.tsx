import { Text, View } from '@tarojs/components'

function renderInline(value: string, keyPrefix: string): React.ReactNode[] {
  const parts = value.split(/(\*\*[\s\S]*?\*\*|`[^`]*`|\*[^*]+\*|~~[^~]+~~)/g).filter(Boolean)
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) return <Text key={key} className='experimental-ai-markdown-strong'>{part.slice(2, -2)}</Text>
    if (part.startsWith('`') && part.endsWith('`')) return <Text key={key} className='experimental-ai-markdown-code'>{part.slice(1, -1)}</Text>
    if (part.startsWith('*') && part.endsWith('*')) return <Text key={key} className='experimental-ai-markdown-emphasis'>{part.slice(1, -1)}</Text>
    if (part.startsWith('~~') && part.endsWith('~~')) return <Text key={key} className='experimental-ai-markdown-del'>{part.slice(2, -2)}</Text>
    return <Text key={key}>{part}</Text>
  })
}

type ListKind = 'ordered' | 'unordered'
type ParsedListItem = { kind: ListKind; content: string; depth: number; number?: number }

function isDecorativeListContent(content: string): boolean {
  return /^[：:、，。；;,\.\-—_~～\s]+$/.test(content)
}

function normalizeListContent(content: string): string {
  let normalized = content.trim()
  for (let index = 0; index < 3; index += 1) {
    const next = normalized.replace(/^(?:(?:\*\*|__)\s*)?[：:](?:\s*(?:\*\*|__))?\s*/, '')
    if (next === normalized) break
    normalized = next
  }
  return normalized
}

function parseListLine(line: string): ParsedListItem | undefined {
  const ordered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line)
  if (ordered) return { kind: 'ordered', content: normalizeListContent(ordered[2]!), depth: 0, number: Number(ordered[1]) }
  const unordered = /^\s*((?:[-*•]\s+)+)(.+)$/.exec(line)
  if (!unordered) return undefined
  return { kind: 'unordered', content: normalizeListContent(unordered[2]!), depth: Math.max(0, (unordered[1]!.match(/[-*•]/g)?.length ?? 1) - 1) }
}

export function ExperimentalAiMarkdown({ content, mentor }: { content: string; mentor?: React.ReactNode }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) { index += 1; continue }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      blocks.push(<Text key={`heading-${index}`} className={`experimental-ai-markdown-heading experimental-ai-markdown-heading-${level}`}>{renderInline(heading[2]!, `heading-${index}`)}</Text>)
      index += 1
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      blocks.push(<View key={`quote-${index}`} className='experimental-ai-markdown-quote'><Text>{renderInline(quote[1]!, `quote-${index}`)}</Text></View>)
      index += 1
      continue
    }

    const listMatch = parseListLine(line)
    if (listMatch) {
      const kind = listMatch.kind
      const items: ParsedListItem[] = [listMatch]
      const start = index
      index += 1
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (!current.trim() && lines[index + 1] && parseListLine(lines[index + 1]! )?.kind === kind) {
          index += 1
          continue
        }
        const currentMatch = parseListLine(current)
        if (!currentMatch || currentMatch.kind !== kind) break
        items.push(currentMatch)
        index += 1
      }
      const visibleItems = items.filter((item) => !isDecorativeListContent(item.content.trim()))
      if (visibleItems.length) {
        blocks.push(<View key={`list-${start}`} className={`experimental-ai-markdown-list experimental-ai-markdown-list-${kind}`}>{visibleItems.map((item, itemIndex) => <View key={`${start}-${itemIndex}`} className={`experimental-ai-markdown-list-item${item.depth ? ' is-nested' : ''}`} style={item.depth ? { marginLeft: item.depth * 16 } : undefined}><Text className='experimental-ai-markdown-list-marker'>{kind === 'ordered' ? `${item.number ?? itemIndex + 1}.` : '•'}</Text><Text className='experimental-ai-markdown-list-copy'>{renderInline(item.content, `list-${start}-${itemIndex}`)}</Text></View>)}</View>)
      }
      continue
    }

    const paragraph: string[] = []
    const start = index
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(#{1,3})\s+/.test(lines[index]!) && !/^>\s?/.test(lines[index]!) && !parseListLine(lines[index]!)) {
      paragraph.push(lines[index]!)
      index += 1
    }
    blocks.push(<Text key={`paragraph-${start}`} className='experimental-ai-markdown-paragraph'>{paragraph.map((part, partIndex) => <Text key={`${start}-${partIndex}`}>{renderInline(part, `paragraph-${start}-${partIndex}`)}{partIndex < paragraph.length - 1 ? '\n' : ''}</Text>)}</Text>)
  }

  return <View className='experimental-ai-markdown'><View className='experimental-ai-markdown-content'>{blocks}</View>{mentor && <View className='experimental-ai-markdown-mentor-end'>{mentor}</View>}</View>
}
