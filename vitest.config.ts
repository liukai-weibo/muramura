import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@knowledge-base/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@knowledge-base/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@knowledge-base/storage-indexeddb': path.resolve(__dirname, 'packages/storage-indexeddb/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
