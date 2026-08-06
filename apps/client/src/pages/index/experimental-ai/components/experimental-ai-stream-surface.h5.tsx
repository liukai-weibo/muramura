import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { MarkdownBlock } from './experimental-ai-block-parser'
import type { ExperimentalAiStreamSurfaceHandle, ExperimentalAiStreamSurfaceProps } from './experimental-ai-stream-surface.types'

type WorkerResponse = { generationId: number; closed: MarkdownBlock[]; active?: MarkdownBlock }

function appendInline(parent: HTMLElement, value: string): void {
  const parts = value.split(/(\*\*[\s\S]*?\*\*|`[^`]*`|\*[^*]+\*|~~[^~]+~~)/g).filter(Boolean)
  for (const part of parts) {
    const strong = part.startsWith('**') && part.endsWith('**')
    const code = part.startsWith('`') && part.endsWith('`')
    const emphasis = part.startsWith('*') && part.endsWith('*')
    const deleted = part.startsWith('~~') && part.endsWith('~~')
    if (!strong && !code && !emphasis && !deleted) { parent.append(document.createTextNode(part)); continue }
    const node = document.createElement(code ? 'code' : deleted ? 'del' : emphasis ? 'em' : 'strong')
    node.textContent = part.slice(strong || deleted ? 2 : 1, strong || deleted ? -2 : -1)
    node.className = code ? 'experimental-ai-stream-code' : ''
    parent.append(node)
  }
}

function appendHighlighted(parent: HTMLElement, highlighted: string): void {
  const parsed = new DOMParser().parseFromString(`<code>${highlighted}</code>`, 'text/html').body.firstElementChild
  if (!parsed) return
  const appendNode = (source: Node, target: HTMLElement) => {
    if (source.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(source.textContent ?? '')); return }
    if (!(source instanceof Element)) return
    if (source.tagName.toLowerCase() === 'span' && /^hljs-[\w-]+$/.test(source.className)) {
      const span = document.createElement('span')
      span.className = source.className
      source.childNodes.forEach((child) => appendNode(child, span))
      target.append(span)
      return
    }
    source.childNodes.forEach((child) => appendNode(child, target))
  }
  parsed.childNodes.forEach((child) => appendNode(child, parent))
}

function mountBlock(block: MarkdownBlock): HTMLElement {
  const element = document.createElement(block.kind === 'heading' ? `h${block.level ?? 2}` : block.kind === 'quote' ? 'blockquote' : block.kind === 'code' ? 'pre' : block.kind.endsWith('list') ? block.kind === 'ordered-list' ? 'ol' : 'ul' : 'p')
  element.className = `experimental-ai-stream-block experimental-ai-stream-block-${block.kind}`
  renderBlock(element, block)
  return element
}

function renderBlock(element: HTMLElement, block: MarkdownBlock): void {
  element.replaceChildren()
  if (block.kind === 'code') {
    const code = document.createElement('code')
    if (block.highlighted) appendHighlighted(code, block.highlighted)
    else code.textContent = block.text
    element.append(code)
    return
  }
  if (block.kind.endsWith('list')) {
    for (const line of block.text.split('\n')) {
      const item = document.createElement('li')
      item.className = 'experimental-ai-stream-list-item'
      appendInline(item, line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, ''))
      element.append(item)
    }
    return
  }
  appendInline(element, block.text.replace(/^#{1,3}\s+/, '').replace(/^\s*>\s?/, ''))
}

export const ExperimentalAiStreamSurface = forwardRef<ExperimentalAiStreamSurfaceHandle, Omit<ExperimentalAiStreamSurfaceProps, 'streamRef'>>(({ initialContent = '', generationId, isStreaming, className = '' }, ref) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef('')
  const rawContentRef = useRef(initialContent)
  const generationRef = useRef(generationId)
  const renderedIds = useRef(new Set<number>())
  const activeElement = useRef<HTMLElement | null>(null)

  const clear = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    pendingRef.current = ''
    rootRef.current?.replaceChildren()
    renderedIds.current.clear()
    activeElement.current = null
  }
  const mountSnapshot = (snapshot: WorkerResponse) => {
    if (snapshot.generationId !== generationRef.current || !rootRef.current) return
    for (const block of snapshot.closed) {
      if (renderedIds.current.has(block.id)) continue
      if (activeElement.current) { activeElement.current.remove(); activeElement.current = null }
      rootRef.current.append(mountBlock(block))
      renderedIds.current.add(block.id)
    }
    if (snapshot.active) {
      if (!activeElement.current) { activeElement.current = mountBlock(snapshot.active); rootRef.current.append(activeElement.current) }
      renderBlock(activeElement.current, snapshot.active)
    } else if (activeElement.current) { activeElement.current.remove(); activeElement.current = null }
  }

  useEffect(() => {
    const worker = new Worker(new URL('./experimental-ai-markdown.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => mountSnapshot(event.data)
    worker.onerror = () => {
      workerRef.current = null
      worker.terminate()
      if (rootRef.current) {
        rootRef.current.replaceChildren()
        const fallback = document.createElement('p')
        fallback.className = 'experimental-ai-stream-block experimental-ai-stream-block-paragraph'
        fallback.textContent = rawContentRef.current
        rootRef.current.append(fallback)
      }
    }
    generationRef.current = generationId
    rawContentRef.current = initialContent
    clear()
    if (initialContent) worker.postMessage({ type: 'append', generationId, chunk: initialContent })
    if (!isStreaming) worker.postMessage({ type: 'flush', generationId })
    return () => { worker.onmessage = null; worker.onerror = null; worker.terminate(); workerRef.current = null; clear() }
  }, [generationId])

  useImperativeHandle(ref, () => ({
    append(chunk) {
      rawContentRef.current += chunk
      pendingRef.current += chunk
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const next = pendingRef.current
        pendingRef.current = ''
        workerRef.current?.postMessage({ type: 'append', generationId: generationRef.current, chunk: next })
      })
    },
    flush() {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      const next = pendingRef.current
      pendingRef.current = ''
      if (next) workerRef.current?.postMessage({ type: 'append', generationId: generationRef.current, chunk: next })
      workerRef.current?.postMessage({ type: 'flush', generationId: generationRef.current })
    },
    replace(content) {
      clear()
      rawContentRef.current = content
      workerRef.current?.postMessage({ type: 'reset', generationId: generationRef.current })
      workerRef.current?.postMessage({ type: 'append', generationId: generationRef.current, chunk: content })
      workerRef.current?.postMessage({ type: 'flush', generationId: generationRef.current })
    },
  }), [])

  return <div ref={rootRef} className={`experimental-ai-stream-surface ${className}`} aria-live={isStreaming ? 'polite' : undefined} />
})

ExperimentalAiStreamSurface.displayName = 'ExperimentalAiStreamSurface'
