import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('local daily launcher schema gate', () => {
  it('accepts only the daily knowledge_base Schema 5 health fact', () => {
    const source = readFileSync(new URL('../scripts/kb-start.ps1', import.meta.url), 'utf8')

    expect(source).toContain("$health.body.database -eq 'knowledge_base'")
    expect(source).toContain('[int]$health.body.schemaVersion -eq 5')
    expect(source).toContain("schemaVersion = 5")
    expect(source).not.toContain('schemaVersion -eq 4')
    expect(source).not.toContain('schemaVersion = 4')
  })

  it('records launcher processes and stops their validated process trees', () => {
    const start = readFileSync(new URL('../scripts/kb-start.ps1', import.meta.url), 'utf8')
    const stop = readFileSync(new URL('../scripts/kb-stop.ps1', import.meta.url), 'utf8')

    expect(start).toContain('-WindowStyle Hidden -PassThru')
    expect(start).toContain('apiRootPid = $apiRootPid')
    expect(start).toContain('h5RootPid = $h5RootPid')
    expect(start).toContain('Get-ManagedRootPid $h5Pid $h5LauncherPid')
    expect(stop).toContain('Test-DescendantOf $api ([int]$state.apiRootPid)')
    expect(stop).toContain('Test-DescendantOf $h5 ([int]$state.h5RootPid)')
    expect(stop).toContain("Test-OwnedListener $h5 'apps\\client'")
    expect(stop).toContain("Write-Log 'stopped managed daily process trees'")
    expect(stop).not.toContain('function Test-OwnedListener([int]$Pid')
  })
})
