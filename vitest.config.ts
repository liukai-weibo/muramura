import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@knowledge-base/application': path.resolve(__dirname, 'packages/application/src/index.ts'),
      '@knowledge-base/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@knowledge-base/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@knowledge-base/storage-indexeddb': path.resolve(__dirname, 'packages/storage-indexeddb/src/index.ts'),
      '@knowledge-base/storage-sqlite': path.resolve(__dirname, 'packages/storage-sqlite/src/index.ts'),
      '@knowledge-base/storage-mysql': path.resolve(__dirname, 'packages/storage-mysql/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
