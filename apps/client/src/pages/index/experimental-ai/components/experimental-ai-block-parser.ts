export type MarkdownBlockKind = 'paragraph' | 'heading' | 'quote' | 'unordered-list' | 'ordered-list' | 'code'

export interface MarkdownBlock {
  id: number
  kind: MarkdownBlockKind
  text: string
  level?: number
  language?: string
  highlighted?: string
}

export interface MarkdownParseSnapshot {
  closed: MarkdownBlock[]
  active?: MarkdownBlock
}

const headingPattern = /^(#{1,3})\s+(.+)$/
const orderedPattern = /^\s*\d+[.)]\s+(.+)$/
const unorderedPattern = /^\s*[-*•]\s+(.+)$/
const quotePattern = /^\s*>\s?(.*)$/
const fencePattern = /^\s*```\s*([\w-]*)\s*$/

function classify(line: string): MarkdownBlockKind | 'fence' | 'blank' | undefined {
  if (!line.trim()) return 'blank'
  if (fencePattern.test(line)) return 'fence'
  if (headingPattern.test(line)) return 'heading'
  if (orderedPattern.test(line)) return 'ordered-list'
  if (unorderedPattern.test(line)) return 'unordered-list'
  if (quotePattern.test(line)) return 'quote'
  return 'paragraph'
}

function sameBlock(kind: MarkdownBlockKind, next: MarkdownBlockKind): boolean {
  if (kind === 'paragraph') return next === 'paragraph'
  return kind === next
}

export class IncrementalMarkdownParser {
  private pendingLine = ''
  private currentLines: string[] = []
  private currentKind?: MarkdownBlockKind
  private currentLanguage?: string
  private inCodeFence = false
  private nextId = 0
  private readonly closedBlocks: MarkdownBlock[] = []

  append(chunk: string, flush = false): MarkdownParseSnapshot {
    this.pendingLine += chunk
    const lines = this.pendingLine.split('\n')
    this.pendingLine = flush ? '' : (lines.pop() ?? '')
    for (const line of lines) this.consumeLine(line)
    if (flush && this.pendingLine) {
      this.consumeLine(this.pendingLine)
      this.pendingLine = ''
    }
    if (flush) this.closeCurrent()
    return this.snapshot()
  }

  reset(): void {
    this.pendingLine = ''
    this.currentLines = []
    this.currentKind = undefined
    this.currentLanguage = undefined
    this.inCodeFence = false
    this.nextId = 0
    this.closedBlocks.length = 0
  }

  private consumeLine(line: string): void {
    if (this.inCodeFence) {
      if (fencePattern.test(line)) {
        this.closeCurrent()
        this.inCodeFence = false
      } else {
        this.currentLines.push(line)
      }
      return
    }

    const kind = classify(line)
    if (kind === 'blank') {
      this.closeCurrent()
      return
    }
    if (kind === 'fence') {
      this.closeCurrent()
      this.inCodeFence = true
      this.currentKind = 'code'
      this.currentLanguage = fencePattern.exec(line)?.[1] || undefined
      this.currentLines = []
      return
    }
    if (!kind) return
    if (this.currentKind && !sameBlock(this.currentKind, kind)) this.closeCurrent()
    if (!this.currentKind) {
      this.currentKind = kind
      this.currentLines = []
    }
    this.currentLines.push(line)
    if (kind === 'heading') this.closeCurrent()
  }

  private closeCurrent(): void {
    if (!this.currentKind || this.currentLines.length === 0) {
      this.currentKind = undefined
      this.currentLanguage = undefined
      this.currentLines = []
      return
    }
    const heading = this.currentKind === 'heading' ? headingPattern.exec(this.currentLines[0] ?? '') : undefined
    this.closedBlocks.push({
      id: this.nextId++,
      kind: this.currentKind,
      text: this.currentLines.join('\n'),
      level: heading?.[1]?.length,
      language: this.currentLanguage,
    })
    this.currentKind = undefined
    this.currentLanguage = undefined
    this.currentLines = []
  }

  private snapshot(): MarkdownParseSnapshot {
    const activeLines = this.pendingLine ? [...this.currentLines, this.pendingLine] : this.currentLines
    if (activeLines.length === 0) return { closed: [...this.closedBlocks] }
    if (!this.currentKind) return { closed: [...this.closedBlocks], active: { id: this.nextId, kind: 'paragraph', text: this.pendingLine } }
    const heading = this.currentKind === 'heading' ? headingPattern.exec(this.currentLines[0] ?? '') : undefined
    return {
      closed: [...this.closedBlocks],
      active: {
        id: this.nextId,
        kind: this.currentKind,
        text: activeLines.join('\n'),
        level: heading?.[1]?.length,
        language: this.currentLanguage,
      },
    }
  }
}
