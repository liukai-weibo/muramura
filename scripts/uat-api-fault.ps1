[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('status', 'start-normal', 'stop-normal', 'start-mysql-unavailable', 'restore-normal', 'stop-fault')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$Port = 32146
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'knowledge-base-uat-fault'
$StatePath = Join-Path $TempRoot 'state.json'
$LogPath = Join-Path $TempRoot 'launcher.log'
$HealthUri = "http://127.0.0.1:$Port/health"
$FaultUri = "http://127.0.0.1:$Port/api/v1/exploration-tracks"

function Fail([string]$Message) {
  [Console]::Error.WriteLine("ERROR: $Message")
  exit 1
}

function Ensure-TempRoot {
  if (-not (Test-Path -LiteralPath $TempRoot)) {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
  }
}

function Write-LauncherLog([string]$Message) {
  Ensure-TempRoot
  $timestamp = [DateTime]::UtcNow.ToString('o')
  Add-Content -LiteralPath $LogPath -Encoding ASCII -Value "$timestamp $Message"
}

function Get-ListenerPid {
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $null }
  if ($listeners.Count -ne 1) { throw 'multiple port listeners' }
  return [int]$listeners[0].OwningProcess
}

function Get-State {
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8
    return ($raw | ConvertFrom-Json)
  } catch {
    return [pscustomobject]@{ kind = 'invalid'; pid = -1 }
  }
}

function Remove-StaleState {
  $state = Get-State
  if ($null -eq $state) { return $null }
  $listenerPid = Get-ListenerPid
  $statePid = $null
  try { $statePid = [int]$state.pid } catch { $statePid = -1 }
  if ($null -eq $listenerPid -or $statePid -ne $listenerPid) {
    Remove-Item -LiteralPath $StatePath -Force
    Write-LauncherLog 'removed stale state'
    return $null
  }
  return $state
}

function Save-State([string]$Kind, [int]$ListenerPid) {
  Ensure-TempRoot
  $state = [ordered]@{
    kind = $Kind
    pid = $ListenerPid
    port = $Port
    startedAt = [DateTime]::UtcNow.ToString('o')
  }
  $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Get-HttpResult([string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Method Get -TimeoutSec 3
    return [pscustomobject]@{ statusCode = [int]$response.StatusCode; content = [string]$response.Content }
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
      return [pscustomobject]@{ statusCode = [int]$response.StatusCode; content = [string]$content }
    }
    return $null
  }
}

function Get-Health {
  $result = Get-HttpResult $HealthUri
  if ($null -eq $result) { return $null }
  try {
    return [pscustomobject]@{ statusCode = $result.statusCode; body = ($result.content | ConvertFrom-Json) }
  } catch {
    return [pscustomobject]@{ statusCode = $result.statusCode; body = $null }
  }
}

function Test-UatReady {
  $health = Get-Health
  return $null -ne $health -and $health.statusCode -eq 200 -and $null -ne $health.body -and $health.body.status -eq 'ready' -and $health.body.database -eq 'knowledge_base_uat' -and [int]$health.body.schemaVersion -eq 4
}

function Get-UatEnvironment {
  $envPath = Join-Path $ProjectRoot '.env.uat'
  if (-not (Test-Path -LiteralPath $envPath)) { throw 'missing .env.uat' }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
    $values[$name] = $value
  }
  if ($values['MYSQL_DATABASE'] -ne 'knowledge_base_uat') { throw 'UAT database check failed' }
  if ($values['MYSQL_HOST'] -ne '127.0.0.1') { throw 'UAT MySQL host check failed' }
  if ($values['API_HOST'] -ne '127.0.0.1') { throw 'API host check failed' }
  if ($values['API_PORT'] -ne '32146') { throw 'API port check failed' }
  return $values
}

function Start-ApiChild([string]$Kind) {
  Get-UatEnvironment | Out-Null
  Ensure-TempRoot
  $escapedRoot = $ProjectRoot.Replace("'", "''")
  $faultLine = ''
  if ($Kind -eq 'fault') { $faultLine = '$env:MYSQL_APP_PASSWORD = ''invalid-uat-fault-password''' }
  $child = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedRoot'
foreach (`$line in Get-Content -LiteralPath '.env.uat' -Encoding UTF8) {
  if (`$line -match '^\s*#' -or `$line -notmatch '=') { continue }
  `$parts = `$line -split '=', 2
  `$name = `$parts[0].Trim()
  `$value = `$parts[1].Trim()
  if (`$value.Length -ge 2 -and ((`$value.StartsWith('"') -and `$value.EndsWith('"')) -or (`$value.StartsWith("'") -and `$value.EndsWith("'")))) { `$value = `$value.Substring(1, `$value.Length - 2) }
  [Environment]::SetEnvironmentVariable(`$name, `$value, 'Process')
}
$faultLine
`$node = (Get-Command node.exe -ErrorAction Stop).Source
& `$node 'apps/api/node_modules/tsx/dist/cli.mjs' 'apps/api/src/main.ts'
exit `$LASTEXITCODE
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
  Write-LauncherLog "starting $Kind child"
  return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -PassThru -WindowStyle Hidden
}

function Stop-MatchingState([string]$ExpectedKind) {
  $state = Remove-StaleState
  if ($null -eq $state) { throw 'no managed state' }
  if ($state.kind -ne $ExpectedKind) { throw 'managed state kind mismatch' }
  $listenerPid = Get-ListenerPid
  if ($null -eq $listenerPid -or [int]$state.pid -ne $listenerPid) { throw 'managed PID is not the listener' }
  Stop-Process -Id $listenerPid -Force
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if ($null -eq (Get-ListenerPid)) {
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
      Write-LauncherLog "stopped $ExpectedKind child"
      return
    }
  }
  throw 'managed listener did not stop'
}

function Wait-ForReady([int]$StartedListenerPid) {
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-UatReady) { return $true }
    Start-Sleep -Milliseconds 500
  }
  $listenerPid = Get-ListenerPid
  if ($null -ne $listenerPid -and $listenerPid -eq $StartedListenerPid) { Stop-Process -Id $listenerPid -Force }
  return $false
}

function Start-Normal {
  Remove-StaleState | Out-Null
  if ($null -ne (Get-State)) { throw 'managed state already active' }
  if ($null -ne (Get-ListenerPid)) { throw 'API port is already in use' }
  Start-ApiChild 'normal' | Out-Null
  $listenerPid = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    $listenerPid = Get-ListenerPid
    if ($null -ne $listenerPid) { break }
  }
  if ($null -eq $listenerPid -or -not (Wait-ForReady $listenerPid)) { throw 'normal API did not become UAT ready' }
  Save-State 'normal' $listenerPid
  Write-LauncherLog 'normal API ready'
}

function Start-Fault {
  Remove-StaleState | Out-Null
  if ($null -ne (Get-State)) { throw 'managed state already active' }
  if ($null -ne (Get-ListenerPid)) { throw 'API port is already in use' }
  Start-ApiChild 'fault' | Out-Null
  $listenerPid = $null
  $verified = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $listenerPid = Get-ListenerPid
    if ($null -eq $listenerPid) { continue }
    $result = Get-HttpResult $FaultUri
    if ($null -eq $result -or $result.statusCode -ne 503) { continue }
    try {
      $body = $result.content | ConvertFrom-Json
      if ($body.error.code -eq 'MYSQL_UNAVAILABLE' -and -not [string]::IsNullOrWhiteSpace([string]$body.error.requestId)) { $verified = $true; break }
    } catch { }
  }
  if (-not $verified) {
    if ($null -ne $listenerPid -and $listenerPid -eq (Get-ListenerPid)) { Stop-Process -Id $listenerPid -Force }
    throw 'fault API did not return expected 503'
  }
  Save-State 'fault' $listenerPid
  Write-LauncherLog 'fault API verified'
}

try {
  switch ($Action) {
    'status' {
      $state = Get-State
      $listenerPid = Get-ListenerPid
      $health = Get-Health
      [ordered]@{
        port = $Port
        listenerPid = $listenerPid
        statePresent = ($null -ne $state)
        stateKind = if ($null -eq $state) { $null } else { $state.kind }
        statePid = if ($null -eq $state) { $null } else { $state.pid }
        health = if ($null -eq $health) { $null } else { $health.body }
      } | ConvertTo-Json -Compress -Depth 6
      exit 0
    }
    'start-normal' { Start-Normal }
    'stop-normal' {
      if (-not (Test-UatReady)) { throw 'UAT health check failed' }
      Stop-MatchingState 'normal'
    }
    'start-mysql-unavailable' { Start-Fault }
    'restore-normal' {
      Stop-MatchingState 'fault'
      Start-Normal
    }
    'stop-fault' { Stop-MatchingState 'fault' }
  }
} catch {
  Write-LauncherLog 'action failed'
  Fail $_.Exception.Message
}
