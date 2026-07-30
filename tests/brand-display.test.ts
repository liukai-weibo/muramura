import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const browserEntry = readFileSync(new URL('../apps/client/src/index.html', import.meta.url), 'utf8')
const appConfig = readFileSync(new URL('../apps/client/src/app.config.ts', import.meta.url), 'utf8')
const pageConfig = readFileSync(new URL('../apps/client/src/pages/index/index.config.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('MaruMaru brand display', () => {
  it('uses the frozen English and Chinese display names in the H5 title and navigation', () => {
    expect(browserEntry).toContain('<title>MaruMaru｜圈圈</title>')
    expect(appConfig).toContain("navigationBarTitleText: 'MaruMaru｜圈圈'")
    expect(pageConfig).toContain("navigationBarTitleText: 'MaruMaru｜圈圈'")
    expect(page).toContain("<View className='navigation-brand'><Text>MaruMaru</Text><Text>圈圈 · 行动与方法</Text></View>")
  })

  it('uses the brand in the README without changing internal technical identifiers', () => {
    expect(readme).toContain('# MaruMaru｜圈圈')
    expect(readme).toContain('MaruMaru（圈圈）将下面这条个人运行闭环')
    expect(readme).toContain('knowledge_base / knowledge_base_uat')
  })
})
