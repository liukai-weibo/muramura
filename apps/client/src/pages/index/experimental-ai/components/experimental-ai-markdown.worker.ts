import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import html from 'highlight.js/lib/languages/xml'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import { IncrementalMarkdownParser, type MarkdownBlock } from './experimental-ai-block-parser'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', html)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)

type WorkerRequest = { type: 'append' | 'flush' | 'reset'; generationId: number; chunk?: string }
type WorkerResponse = { generationId: number; closed: MarkdownBlock[]; active?: MarkdownBlock }

const parser = new IncrementalMarkdownParser()

function highlight(block: MarkdownBlock): MarkdownBlock {
  if (block.kind !== 'code' || !block.language) return block
  const language = block.language.toLowerCase() === 'ts' ? 'typescript' : block.language.toLowerCase() === 'js' ? 'javascript' : block.language.toLowerCase()
  if (!hljs.getLanguage(language)) return block
  try { return { ...block, highlighted: hljs.highlight(block.text, { language }).value } } catch { return block }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'reset') parser.reset()
  const snapshot = request.type === 'flush'
    ? parser.append('', true)
    : request.type === 'append'
      ? parser.append(request.chunk ?? '')
      : { closed: [] }
  const response: WorkerResponse = {
    generationId: request.generationId,
    closed: snapshot.closed.map(highlight),
    active: snapshot.active ? highlight(snapshot.active) : undefined,
  }
  self.postMessage(response)
}
