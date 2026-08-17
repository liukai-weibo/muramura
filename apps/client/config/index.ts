import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'node:path'

const sharedPackageSources = [
  path.resolve(__dirname, '../../../packages/application/src'),
  path.resolve(__dirname, '../../../packages/contracts/src'),
  path.resolve(__dirname, '../../../packages/domain/src'),
]

const config: UserConfigExport<'vite'> = {
  projectName: 'knowledge-base',
  date: '2026-07-18',
  // 现有页面按 750；NutUI 官方按 375。按文件路径分流，避免整站换基准把旧 UI 撑坏。
  designWidth(input) {
    const file = typeof input === 'object' && input && 'file' in input
      ? String((input as { file?: string }).file ?? '')
      : String(input ?? '')
    if (file.replace(/\\+/g, '/').includes('@nutui')) {
      return 375
    }
    return 750
  },
  deviceRatio: {
    375: 2,
    640: 1.17,
    750: 1,
    828: 0.905,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'vite',
  plugins: ['@tarojs/plugin-html'],
  alias: {
    '@knowledge-base/application': path.resolve(__dirname, '../../../packages/application/src'),
    '@knowledge-base/contracts': path.resolve(__dirname, '../../../packages/contracts/src'),
    '@knowledge-base/domain': path.resolve(__dirname, '../../../packages/domain/src'),
  },
  mini: {
    compile: { include: sharedPackageSources },
  },
  h5: {
    // Keep the production bundle openable from file:// as well as served over HTTP.
    publicPath: './',
    staticDirectory: 'static',
    router: { mode: 'hash' },
    devServer: {
      host: '0.0.0.0',
      port: 10086,
      proxy: {
        '/api/v1': { target: 'http://127.0.0.1:32146', changeOrigin: true, headers: { origin: 'http://127.0.0.1:10086' } },
        '/health': { target: 'http://127.0.0.1:32146', changeOrigin: true, headers: { origin: 'http://127.0.0.1:10086' } },
      },
    },
    compile: { include: sharedPackageSources },
  },
}

export default defineConfig(() => config)
