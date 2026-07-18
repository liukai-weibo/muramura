import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'node:path'

const sharedPackageSources = [
  path.resolve(__dirname, '../../../packages/application/src'),
  path.resolve(__dirname, '../../../packages/contracts/src'),
  path.resolve(__dirname, '../../../packages/domain/src'),
  path.resolve(__dirname, '../../../packages/storage-indexeddb/src'),
]

const config: UserConfigExport = {
  projectName: 'knowledge-base',
  date: '2026-07-18',
  designWidth: 750,
  deviceRatio: {
    375: 2,
    640: 1.17,
    750: 1,
    828: 0.905,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: true },
  alias: {
    '@knowledge-base/application': path.resolve(__dirname, '../../../packages/application/src'),
    '@knowledge-base/contracts': path.resolve(__dirname, '../../../packages/contracts/src'),
    '@knowledge-base/domain': path.resolve(__dirname, '../../../packages/domain/src'),
    '@knowledge-base/storage-indexeddb': path.resolve(__dirname, '../../../packages/storage-indexeddb/src'),
  },
  mini: {
    compile: { include: sharedPackageSources },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: { mode: 'browser' },
    devServer: { port: 10086 },
    compile: { include: sharedPackageSources },
  },
}

export default defineConfig(() => config)
