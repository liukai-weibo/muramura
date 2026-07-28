module.exports = {
  presets: [
    ['taro', { framework: 'react', ts: true, compiler: 'vite' }],
  ],
  plugins: [
    [
      'import',
      {
        libraryName: '@nutui/nutui-react-taro',
        libraryDirectory: 'dist/esm',
        // 样式已在 app.tsx 全量引入；这里只做组件按需解析，避免重复打样式。
        style: false,
        camel2DashComponentName: false,
      },
      'nutui-react-taro',
    ],
  ],
}
