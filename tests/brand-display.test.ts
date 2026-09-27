import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const browserEntry = readFileSync(new URL('../apps/client/src/index.html', import.meta.url), 'utf8')
const appConfig = readFileSync(new URL('../apps/client/src/app.config.ts', import.meta.url), 'utf8')
const pageConfig = readFileSync(new URL('../apps/client/src/pages/index/index.config.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const mobilePage = readFileSync(new URL('../apps/client/src/pages/mobile/index.tsx', import.meta.url), 'utf8')
const help = readFileSync(new URL('../apps/client/src/assets/help/getting-started.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const tauriConf = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
const tauriMain = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')

// 品牌展示名统一为英文 `Muramura` + 中文「圈圈」。
// 内部技术标识（knowledge-base、knowledge_base、com.marumaru.knowledgebase、
// 钥匙串服务名、签名凭据名、localStorage 键）不在本用例范围内，且必须保持不变。
describe('Muramura brand display', () => {
  it('uses the display names in the H5 title and navigation', () => {
    expect(browserEntry).toContain('<title>Muramura｜圈圈</title>')
    expect(appConfig).toContain("navigationBarTitleText: 'Muramura｜圈圈'")
    expect(pageConfig).toContain("navigationBarTitleText: 'Muramura｜圈圈'")
    expect(page).toContain("<Text className='navigation-brand-name'>Muramura</Text>")
    expect(page).toContain("<Text>Muramura</Text><Text>圈圈 · 行动与方法</Text>")
    expect(mobilePage).toContain("<Text className='mobile-brand'>Muramura</Text>")
  })

  it('uses the display names in the desktop window, tray and menu', () => {
    expect(tauriConf).toContain('"productName": "Muramura"')
    expect(tauriConf).toContain('"title": "Muramura"')
    expect(tauriMain).toContain('"打开 Muramura"')
    expect(tauriMain).toContain('"退出 Muramura"')
    expect(tauriMain).toContain('.tooltip("Muramura")')
  })

  it('uses the display names in the README and in-app help', () => {
    expect(readme).toContain('# Muramura｜圈圈')
    expect(readme).toContain('Muramura（圈圈）将下面这条个人运行闭环')
    expect(help).toContain('# Muramura 快速开始')
  })

  it('keeps internal technical identifiers unchanged', () => {
    expect(readme).toContain('knowledge_base / knowledge_base_uat')
    // 应用标识与钥匙串服务名属于运行身份，改名会导致已安装客户端被识别为新应用。
    expect(tauriConf).toContain('"identifier": "com.marumaru.knowledgebase"')
    expect(tauriMain).toContain('const DESKTOP_SESSION_SERVICE: &str = "com.marumaru.knowledgebase";')
  })

  it('no longer shows the previous English display name in user-visible text', () => {
    for (const source of [browserEntry, appConfig, pageConfig, mobilePage, help, readme, tauriConf]) {
      expect(source).not.toContain('MaruMaru')
    }
  })
})
