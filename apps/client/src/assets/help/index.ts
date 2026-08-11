// 通过 new URL 保持帮助文档为独立静态资源，打开帮助入口时可按需加载。
export const gettingStartedHelpUrl = new URL('./getting-started.md', import.meta.url).href
