import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const componentSource = readFileSync(new URL('../apps/client/src/pages/index/experimental-ai/components/experimental-ai-thinking-indicator.tsx', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')

describe('AI thinking indicator contract', () => {
  it('uses a local phrase per generation without timers or provider fields', () => {
    expect(componentSource).toContain('generationId')
    expect(componentSource).toContain('hasReceivedToken')
    expect(componentSource).not.toContain('setInterval')
    expect(componentSource).not.toContain('setTimeout')
    expect(componentSource.match(/^  '.*',$/gm)?.length).toBe(20)
  })

  it('provides animated dots and reduced-motion fallback', () => {
    expect(styleSource).toContain('experimental-ai-thinking-dot')
    expect(styleSource).toContain('prefers-reduced-motion: reduce')
    expect(styleSource).toContain('@keyframes experimental-ai-thinking-dot')
  })
})
