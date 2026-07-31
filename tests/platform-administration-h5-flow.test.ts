import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../apps/client/src/pages/index/index.tsx', import.meta.url), 'utf8')
const component = readFileSync(new URL('../apps/client/src/pages/index/platform-administration.tsx', import.meta.url), 'utf8')
const state = readFileSync(new URL('../apps/client/src/pages/index/platform-administration-state.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../apps/client/src/pages/index/index.scss', import.meta.url), 'utf8')

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
    expect(component).toContain("roleUnknownFactsRef.current.delete(targetId)\n        updateLock(targetId, 'idle')\n        updateTargetNotice(targetId)")
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
    expect(styles).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.platform-administration-header > taro-button-core\.platform-administration-refresh,[\s\S]*?\.platform-administration-search > taro-button-core,[\s\S]*?width: 100%;/)
  })
})
