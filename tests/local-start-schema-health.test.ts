import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('local daily launcher schema gate', () => {
  it('trusts the API startup gate and reports the validated health schema version', () => {
    const source = readFileSync(new URL('../scripts/kb-start.ps1', import.meta.url), 'utf8')

    expect(source).toContain("$Health.body.database -ne 'knowledge_base'")
    expect(source).toContain('[int]::TryParse([string]$Health.body.schemaVersion, [ref]$schemaVersion)')
    expect(source).toContain('$schemaVersion -gt 0')
    expect(source).toContain('schemaVersion = [int]$dailyHealth.body.schemaVersion')
    expect(source).toContain('Test-DailyReady -Health $dailyHealth')
    expect(source).not.toMatch(/schemaVersion\s+-eq\s+\d+/)
    expect(source).not.toMatch(/schemaVersion\s*=\s+[1-9]\d*\b/)
  })

  it('returns only allowlisted API startup diagnostics from the hidden child', () => {
    const source = readFileSync(new URL('../scripts/kb-start.ps1', import.meta.url), 'utf8')

    expect(source).toContain("$ApiStdoutPath = Join-Path $TempRoot 'api.stdout.log'")
    expect(source).toContain("$ApiStderrPath = Join-Path $TempRoot 'api.stderr.log'")
    expect(source).toContain("$options['RedirectStandardOutput'] = $ApiStdoutPath")
    expect(source).toContain("$options['RedirectStandardError'] = $ApiStderrPath")
    expect(source).toContain('^API_STARTUP_FAILED code=(MYSQL_SCHEMA_NOT_READY|MYSQL_UNAVAILABLE|API_PORT_IN_USE|INTERNAL_ERROR)')
    expect(source).toContain('[Console]::Error.WriteLine($apiStartupFailure)')
    expect(source).toContain('Get-Process -Id $apiLauncherPid -ErrorAction SilentlyContinue')
    expect(source).not.toContain('[Console]::Error.WriteLine((Get-Content')
  })

  it('records launcher processes and stops their validated process trees', () => {
    const start = readFileSync(new URL('../scripts/kb-start.ps1', import.meta.url), 'utf8')
    const stop = readFileSync(new URL('../scripts/kb-stop.ps1', import.meta.url), 'utf8')

    expect(start).toContain("WindowStyle = 'Hidden'; PassThru = $true")
    expect(start).toContain('$process = Start-Process @options')
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
