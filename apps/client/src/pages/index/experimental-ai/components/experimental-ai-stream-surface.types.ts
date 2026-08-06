import type { Ref } from 'react'

export interface ExperimentalAiStreamSurfaceHandle {
  append: (chunk: string) => void
  flush: () => void
  replace: (content: string) => void
}

export interface ExperimentalAiStreamSurfaceProps {
  initialContent?: string
  generationId: number
  isStreaming: boolean
  className?: string
  streamRef?: Ref<ExperimentalAiStreamSurfaceHandle>
}
