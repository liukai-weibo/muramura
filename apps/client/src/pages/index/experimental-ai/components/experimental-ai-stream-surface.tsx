import { forwardRef, useImperativeHandle, useState } from 'react'
import { ExperimentalAiMarkdown } from './experimental-ai-markdown'
import type { ExperimentalAiStreamSurfaceHandle, ExperimentalAiStreamSurfaceProps } from './experimental-ai-stream-surface.types'

export const ExperimentalAiStreamSurface = forwardRef<ExperimentalAiStreamSurfaceHandle, ExperimentalAiStreamSurfaceProps>(({ initialContent = '', isStreaming, className = '' }, ref) => {
  const [content, setContent] = useState(initialContent)
  useImperativeHandle(ref, () => ({
    append: (chunk) => setContent((current) => current + chunk),
    flush: () => undefined,
    replace: (next) => setContent(next),
  }), [])
  return <div className={`experimental-ai-stream-surface ${className}`} aria-live={isStreaming ? 'polite' : undefined}><ExperimentalAiMarkdown content={content || (isStreaming ? '正在生成…' : '')} /></div>
})

ExperimentalAiStreamSurface.displayName = 'ExperimentalAiStreamSurface'
