import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const component = readFileSync(new URL('../apps/client/src/pages/index/platform-administration.tsx', import.meta.url), 'utf8')
const state = readFileSync(new URL('../apps/client/src/pages/index/platform-administration-state.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')
const platformStyles = styles.slice(styles.indexOf('.platform-administration {'), styles.indexOf('\n.app-shell {'))

describe('platform administration H5 flow', () => {
  it('renders only the initial six-row management skeleton before factual data', () => {
    expect(component).toContain("listState === 'initial-loading' && !snapshot")
    expect(component).toContain("aria-label='正在读取用户列表'")
    expect(component).toContain('Array.from({ length: 6 }')
    expect(component.indexOf("listState === 'initial-loading' && !snapshot")).toBeLessThan(component.indexOf("snapshot.items.map((user)"))
  })

  it('does not mount management for a member and destroys it on current-context 403', () => {
    expect(page).toContain("{isPlatformAdministrator && !managementAccessDenied && <View")
    expect(page).toContain("{isPlatformAdministrator && !managementAccessDenied && (activeModule === 'administration' || administrationMounted) && <PlatformAdministration")
    expect(page).toContain('setApiClientAdminForbiddenHandler((error) => {')
    expect(page).toContain("setActiveModule('actions')")
    expect(page).toContain('setAdministrationMounted(false)')
    expect(page).toContain('你的管理员权限已变化，无法继续访问用户管理。')
  })

  it('separates draft/applied query and protects reads with Abort, generation, facts and auth context', () => {
    expect(component).toContain('setAppliedQuery(query)')
    expect(component).toContain('void readUsers(1, query)')
    expect(component).toContain('readAbortRef.current?.abort()')
    expect(component).toContain('generation !== readGenerationRef.current')
    expect(component).toContain('authentication !== authenticationContextRef.current')
    expect(component).toContain('shouldApplyPlatformRead({')
    expect(component).toContain('currentFactGeneration: factGenerationRef.current')
    expect(component).toContain('readCoordinatorRef.current.supersedeByWrite')
    expect(component).toContain('reconcileRoleUnknownRead(result, roleUnknownFactsRef.current, factGeneration)')
    expect(component).toContain('void readUsers(page, appliedQuery)')
  })

  it('captures the search value synchronously without retaining the input event or submitting', () => {
    const inputHandler = component.match(/onInput=\{\(event\) => \{([\s\S]*?)\}\}\s*onKeyDown=/)?.[1]

    expect(inputHandler).toBeDefined()
    expect(inputHandler).toContain('const nextValue = event.currentTarget.value')
    expect(inputHandler).toContain('setQueryDraft((current) => acceptPlatformUserQueryDraft(current, nextValue))')
    expect(inputHandler?.slice(inputHandler.indexOf('setQueryDraft'))).not.toContain('event.currentTarget')
    expect(inputHandler).not.toContain('readUsers')
    expect(inputHandler).not.toContain('submitSearch')
    expect(component).toContain("onKeyDown={(event) => { if (event.key === 'Enter' && !reading) submitSearch() }}")
    expect(component).toContain("<Button className='platform-administration-search-button' disabled={reading} onClick={submitSearch}>搜索</Button>")
  })

  it('keeps target-local synchronous locks and distinguishes role/session unknown recovery', () => {
    expect(component).toContain('occupiedTargetsRef.current.has(current.targetId)')
    expect(component).toContain('const unknownState = unknownTargetState(current.action)')
    expect(component).toContain('updateLock(current.targetId, unknownState)')
    expect(component).toContain('const lastConfirmedSummary = snapshotRef.current!.items.find((item) => item.id === current.targetId)!')
    expect(component).toContain('createRoleUnknownFact(lastConfirmedSummary, factGenerationRef.current)')
    expect(component).toContain('for (const { targetId } of reconciliation.resolved)')
    expect(component).toMatch(/roleUnknownFactsRef\.current\.delete\(targetId\)\s+updateLock\(targetId, 'idle'\)\s+updateTargetNotice\(targetId\)/)
    expect(component).toContain('roleUnknownFactsRef.current.clear()')
    expect(state).toContain('return { snapshot: result, resolved, unresolvedTargetIds }')
    expect(state).not.toContain('previous.items')
    expect(component).toContain('再次撤销会话')
    expect(component).toContain('returnToSessionsUnknown')
    expect(component).not.toContain('setInterval')
    expect(component).not.toContain('localStorage')
  })

  it('exposes each unlocked management control as a named button', () => {
    expect(component).toContain("{!locked && <Button {...{ role: 'button' }} className='platform-more-button' aria-label={`管理${user.username}`}")
  })

  it('uses frozen responsive table/card and confirmation dimensions without horizontal scrolling', () => {
    expect(styles).toContain('width: min(100%, 1120px);')
    expect(styles).toContain('min-height: 64px;')
    expect(styles).toContain('@media (max-width: 768px)')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto;')
    expect(styles).toContain('@media (max-width: 768px)')
    expect(styles).not.toMatch(/\.platform-administration[^}]*overflow-x:\s*(auto|scroll)/s)
    expect(component).toContain("role='dialog'")
    expect(component).toContain("event.key !== 'Escape'")
  })

  it('freezes readable management typography, button hosts, table columns and compact pagination', () => {
    expect(platformStyles).toMatch(/\.platform-administration-title \{[^}]*font-size: 24px;[^}]*line-height: 32px;[^}]*font-weight: 700;[^}]*color: #413c35;/s)
    expect(platformStyles).toMatch(/\.platform-administration-description \{[^}]*font-size: 14px;[^}]*font-weight: 400;[^}]*line-height: 22px;/s)
    expect(platformStyles).toMatch(/\.platform-user-created \{[^}]*font-size: 13px;[^}]*font-weight: 400;[^}]*line-height: 20px;/s)
    expect(platformStyles).toMatch(/\.platform-user-name \{[^}]*font-size: 15px;[^}]*font-weight: 700;[^}]*line-height: 22px;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s)
    expect(platformStyles).toMatch(/\.platform-administration button,\s*\.platform-administration taro-button-core \{/)
    expect(platformStyles).toMatch(/\.platform-administration taro-button-core \{\s*width: auto !important;/)
    expect(platformStyles).toMatch(/\.platform-administration button,[\s\S]*?\.platform-administration taro-button-core \{[^}]*display: inline-flex;[^}]*min-width: 72px;[^}]*height: 40px;[^}]*font-size: 13px;[^}]*font-weight: 700;[^}]*line-height: 20px;[^}]*color: #413c35;[^}]*border: 1px solid #cfc4b5;[^}]*border-radius: 8px;/s)
    expect(platformStyles).toContain('.platform-administration taro-button-core taro-text-core {')
    expect(platformStyles).toMatch(/\.platform-administration-header > taro-button-core\.platform-administration-refresh:not\(\[disabled='true'\]\) \{[^}]*color: #413c35 !important;[^}]*-webkit-text-fill-color: #413c35;/s)
    expect(platformStyles).toMatch(/\.platform-administration-header > taro-button-core\.platform-administration-refresh\[disabled='true'\] \{[^}]*color: #6f675e !important;[^}]*-webkit-text-fill-color: #6f675e;/s)
    expect(platformStyles).toMatch(/\.platform-administration button:disabled,\s*\.platform-administration taro-button-core\[disabled='true'\] \{[^}]*color: #6f675e;[^}]*opacity: 1;[^}]*pointer-events: none;/s)
    expect(platformStyles).not.toMatch(/taro-button-core\[disabled\](?:,|\s*\{)/)
    expect(platformStyles).toMatch(/\.platform-administration-search \{[^}]*width: min\(100%, 680px\);[^}]*gap: 8px;/s)
    expect(platformStyles).toMatch(/\.platform-administration-search input,\s*\.platform-administration-search \[aria-label='按用户名搜索'\] \{[^}]*min-width: 320px;[^}]*height: 40px;[^}]*font-size: 14px;[^}]*line-height: 20px;/s)
    expect(platformStyles).toContain('grid-template-columns: minmax(220px, 34fr) minmax(140px, 20fr) minmax(190px, 28fr) minmax(148px, 18fr);')
    expect(platformStyles).toMatch(/\.platform-user-table-heading \{[^}]*height: 40px;[^}]*font-size: 12px;[^}]*line-height: 18px;/s)
    expect(platformStyles).toMatch(/\.platform-user-table-heading > taro-text-core:last-child \{[^}]*justify-self: end;[^}]*text-align: right;/s)
    expect(platformStyles).toMatch(/\.platform-user-row \{[^}]*min-height: 64px;/s)
    expect(platformStyles).toMatch(/\.platform-user-menu button,\s*\.platform-user-menu taro-button-core \{[^}]*width: 100% !important;[^}]*height: 40px;[^}]*min-height: 40px;[^}]*padding: 0 16px;[^}]*align-items: center;[^}]*justify-content: flex-start;[^}]*line-height: 20px;[^}]*text-align: left;/s)
    expect(platformStyles).toMatch(/\.platform-administration-pagination \{[^}]*min-height: 40px;[^}]*margin-top: 12px;/s)
    expect(platformStyles).toMatch(/min-width: 96px;[^}]*font-size: 13px;[^}]*line-height: 20px;[^}]*white-space: nowrap;/s)
    expect(platformStyles).toMatch(/\.platform-administration-pagination taro-button-core \{[^}]*width: 72px !important;[^}]*height: 36px;/s)
  })

  it('uses only the existing pagination facts to mark disabled presentation', () => {
    expect(component).toContain("className={`platform-pagination-button ${page <= 1 || refreshing ? 'platform-pagination-button-disabled' : ''}`} disabled={page <= 1 || refreshing} onClick={() => changePage(page - 1)}")
    expect(component).toContain("className={`platform-pagination-button ${page >= pageCount || refreshing ? 'platform-pagination-button-disabled' : ''}`} disabled={page >= pageCount || refreshing} onClick={() => changePage(page + 1)}")
    expect(component.match(/platform-pagination-button/g)).toHaveLength(4)
    expect(platformStyles).toMatch(/\.platform-administration-pagination \.platform-pagination-button\.platform-pagination-button-disabled \{[^}]*color: #6f675e;[^}]*background: #eeeae4;[^}]*border-color: #ddd4c8;[^}]*opacity: 1;[^}]*cursor: not-allowed;[^}]*pointer-events: none;/s)
    expect(platformStyles).not.toMatch(/\[disabled=''\]/)
    expect(platformStyles).not.toMatch(/taro-button-core\[disabled\](?:,|\s*\{)/)
    expect(platformStyles).not.toMatch(/platform-pagination-button-disabled[^}]*:(?:first|last)-child/)
  })

  it('gives the management header and search Taro buttons direct pointer hit boxes', () => {
    const hitBoxRule = styles.match(/\.platform-administration-header > taro-button-core\.platform-administration-refresh,\s*\.platform-administration-search > taro-button-core \{([^}]*)\}/)?.[1]
    const disabledRule = styles.match(/\.platform-administration-header > taro-button-core\.platform-administration-refresh\[disabled='true'\],\s*\.platform-administration-search > taro-button-core\[disabled='true'\] \{([^}]*)\}/)?.[1]
    const headerRule = styles.match(/\.platform-administration-header \{([^}]*)\}/)?.[1]
    const searchRule = styles.match(/\.platform-administration-search \{([^}]*)\}/)?.[1]

    expect(hitBoxRule).toContain('display: inline-flex;')
    expect(hitBoxRule).toContain('width: auto;')
    expect(hitBoxRule).toContain('align-items: center;')
    expect(hitBoxRule).toContain('justify-content: center;')
    expect(hitBoxRule).toContain('box-sizing: border-box;')
    expect(hitBoxRule).toContain('flex: 0 0 auto;')
    expect(hitBoxRule).toContain('pointer-events: auto;')
    expect(hitBoxRule).not.toContain('position: relative;')
    expect(hitBoxRule).not.toContain('z-index:')
    expect(hitBoxRule).not.toContain('!important')
    expect(disabledRule).toContain('pointer-events: none;')
    expect(styles).not.toMatch(/\.platform-administration (?:button|taro-button-core)\[disabled\](?:,|\s*\{)/)
    expect(headerRule).not.toContain('pointer-events: none;')
    expect(searchRule).not.toContain('pointer-events: none;')
    expect(styles).not.toMatch(/\.platform-administration-(?:header|search)[^{]*\{[^}]*(?:position:\s*absolute|margin:\s*-)/s)
    expect(styles).toContain('.app-main:has(.platform-administration:not(.platform-administration-hidden)) { overflow-y: auto; }')
    expect(styles).not.toContain('.app-main:has(.platform-administration-hidden)')
    expect(platformStyles).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.platform-administration-header > taro-button-core\.platform-administration-refresh,[^{]*\{[^}]*width: 100% !important;[^}]*min-height: 44PX;/s)
    expect(platformStyles).toMatch(/\.platform-administration-search \{[^}]*flex-direction: row;[^}]*flex-wrap: wrap;[^}]*gap: 8PX;/s)
    expect(platformStyles).toMatch(/\.platform-administration-search input,\s*\.platform-administration-search \[aria-label='按用户名搜索'\] \{[^}]*width: 100%;[^}]*min-width: 0;[^}]*height: 44PX;[^}]*flex: 0 0 100%;/s)
    expect(platformStyles).toMatch(/\.platform-administration-search > taro-button-core \{[^}]*width: auto !important;[^}]*min-height: 44PX;[^}]*flex: 1 1 0;/s)
    expect(platformStyles).toMatch(/\.platform-administration-pagination taro-button-core \{[^}]*width: auto !important;[^}]*min-width: 0;[^}]*height: 44PX;[^}]*flex: 1 1 0;/s)
    expect(platformStyles).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.platform-administration-title \{[^}]*font-size: 24PX;[^}]*line-height: 32PX;/s)
    expect(platformStyles).not.toMatch(/(?:transform:\s*scale|font-size:\s*0|color:\s*transparent)/)
    expect(styles).not.toMatch(/(^|\})\s*taro-button-core\s*\{/m)
  })
})
