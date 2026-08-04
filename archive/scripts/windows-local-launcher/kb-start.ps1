[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) 'knowledge-base-local-start'
$StatePath = Join-Path $TempRoot 'state.json'
$LogPath = Join-Path $TempRoot 'launcher.log'
$ApiStdoutPath = Join-Path $TempRoot 'api.stdout.log'
$ApiStderrPath = Join-Path $TempRoot 'api.stderr.log'
$ApiPort = 32146
$H5Port = 10086

function Fail([string]$Message) { [Console]::Error.WriteLine("ERROR: $Message"); exit 1 }
function Ensure-TempRoot { if (-not (Test-Path -LiteralPath $TempRoot)) { New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null } }
function Write-Log([string]$Message) { Ensure-TempRoot; Add-Content -LiteralPath $LogPath -Encoding ASCII -Value "$([DateTime]::UtcNow.ToString('o')) $Message" }
function Get-ListenerPid([int]$Port) { $rows = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); if ($rows.Count -eq 0) { return $null }; if ($rows.Count -ne 1) { throw 'multiple port listeners' }; return [int]$rows[0].OwningProcess }
function Get-ManagedRootPid([int]$ListenerPid, [int]$LauncherPid) {
  $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId)
  $current = $ListenerPid
  for ($i = 0; $i -lt 32; $i++) {
    if ($current -eq $LauncherPid) { return $current }
    $row = $snapshot | Where-Object { [int]$_.ProcessId -eq $current } | Select-Object -First 1
    if ($null -eq $row) { throw 'managed listener process disappeared' }
    $parent = [int]$row.ParentProcessId
    if ($parent -eq $LauncherPid) { return $(if ($snapshot.ProcessId -contains $LauncherPid) { $LauncherPid } else { $current }) }
    if ($parent -le 0 -or -not ($snapshot.ProcessId -contains $parent)) { return $current }
    $current = $parent
  }
  throw 'managed process ancestry is too deep'
}
function Get-State { if (-not (Test-Path -LiteralPath $StatePath)) { return $null }; try { return (Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return [pscustomobject]@{ invalid = $true } } }
function Remove-StaleState {
  $state = Get-State; if ($null -eq $state) { return }
  $api = Get-ListenerPid $ApiPort; $h5 = Get-ListenerPid $H5Port
  $valid = $false
  try { $valid = ([int]$state.apiListenerPid -eq $api -and [int]$state.h5ListenerPid -eq $h5 -and $null -ne $api -and $null -ne $h5) } catch { $valid = $false }
  if (-not $valid) { Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue; Write-Log 'removed stale state' }
}
function Read-Environment {
  $path = Join-Path $ProjectRoot '.env'; if (-not (Test-Path -LiteralPath $path)) { throw 'missing .env; run kb-init.ps1 first' }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) { if ($line -match '^\s*#' -or $line -notmatch '=') { continue }; $pair = $line -split '=', 2; $name = $pair[0].Trim(); $value = $pair[1].Trim(); if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }; $values[$name] = $value }
  if ($values['MYSQL_DATABASE'] -ne 'knowledge_base' -or $values['MYSQL_HOST'] -ne '127.0.0.1' -or $values['API_HOST'] -ne '127.0.0.1' -or $values['API_PORT'] -ne '32146') { throw '.env is not the approved daily loopback configuration' }
  return $values
}
function Start-Child([string]$Kind) {
  $escapedRoot = $ProjectRoot.Replace("'", "''")
  $command = if ($Kind -eq 'api') { "& (Get-Command node.exe -ErrorAction Stop).Source 'apps/api/node_modules/tsx/dist/cli.mjs' 'apps/api/src/main.ts'" } else { "& npm.cmd --prefix apps/client run dev:h5" }
  $child = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedRoot'
foreach (`$line in Get-Content -LiteralPath '.env' -Encoding UTF8) {
  if (`$line -match '^\s*#' -or `$line -notmatch '=') { continue }
  `$pair = `$line -split '=', 2; `$name = `$pair[0].Trim(); `$value = `$pair[1].Trim()
  if (`$value.Length -ge 2 -and ((`$value.StartsWith('"') -and `$value.EndsWith('"')) -or (`$value.StartsWith("'") -and `$value.EndsWith("'")))) { `$value = `$value.Substring(1, `$value.Length - 2) }
  [Environment]::SetEnvironmentVariable(`$name, `$value, 'Process')
}
$command
exit `$LASTEXITCODE
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
  $options = @{ FilePath = 'powershell.exe'; ArgumentList = @('-NoProfile', '-EncodedCommand', $encoded); WindowStyle = 'Hidden'; PassThru = $true }
  if ($Kind -eq 'api') {
    Ensure-TempRoot
    Remove-Item -LiteralPath $ApiStdoutPath, $ApiStderrPath -Force -ErrorAction SilentlyContinue
    $options['RedirectStandardOutput'] = $ApiStdoutPath
    $options['RedirectStandardError'] = $ApiStderrPath
  }
  $process = Start-Process @options
  return [int]$process.Id
}
function Get-ApiStartupFailure {
  foreach ($path in @($ApiStderrPath, $ApiStdoutPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $line = Get-Content -LiteralPath $path -Encoding UTF8 | Where-Object { $_ -match '^API_STARTUP_FAILED code=(MYSQL_SCHEMA_NOT_READY|MYSQL_CONFIG_INVALID|MYSQL_UNAVAILABLE|API_PORT_IN_USE|API_CONFIG_INVALID|INTERNAL_ERROR)( .*)?$' } | Select-Object -Last 1
    if ($null -ne $line) { return [string]$line }
  }
  return $null
}
function Get-Health {
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:32146/health' -TimeoutSec 3; return [pscustomobject]@{ code = [int]$response.StatusCode; body = ($response.Content | ConvertFrom-Json) } } catch { return $null }
}
function Test-DailyReady {
  param($Health)
  if ($null -eq $Health -or $Health.code -ne 200 -or $Health.body.status -ne 'ready' -or $Health.body.database -ne 'knowledge_base') { return $false }
  $schemaVersion = 0
  return [int]::TryParse([string]$Health.body.schemaVersion, [ref]$schemaVersion) -and $schemaVersion -gt 0
}

try {
  Read-Environment | Out-Null
  Remove-StaleState
  if ($null -ne (Get-State)) { throw 'a managed local session is already active' }
  if ($null -ne (Get-ListenerPid $ApiPort)) { throw 'API port 32146 is already in use; refusing to replace UAT or unknown API' }
  if ($null -ne (Get-ListenerPid $H5Port)) { throw 'H5 port 10086 is already in use; refusing to replace unknown process' }
  Set-Location -LiteralPath $ProjectRoot
  & docker compose up -d mysql
  if ($LASTEXITCODE -ne 0) { throw 'docker compose mysql start failed' }
  Write-Log 'starting daily API child'
  $apiLauncherPid = Start-Child 'api'
  $dailyHealth = $null
  for ($i = 0; $i -lt 60; $i++) {
    $dailyHealth = Get-Health
    if (Test-DailyReady -Health $dailyHealth) { break }
    if ($null -eq (Get-Process -Id $apiLauncherPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-DailyReady -Health $dailyHealth)) {
    $apiStartupFailure = Get-ApiStartupFailure
    if ($null -ne $apiStartupFailure) { [Console]::Error.WriteLine($apiStartupFailure) }
    throw 'daily API did not become ready'
  }
  Write-Log 'starting H5 child'
  $h5LauncherPid = Start-Child 'h5'
  $apiPid = $null; $h5Pid = $null
  for ($i = 0; $i -lt 60; $i++) { $apiPid = Get-ListenerPid $ApiPort; $h5Pid = Get-ListenerPid $H5Port; if ($null -ne $apiPid -and $null -ne $h5Pid) { break }; Start-Sleep -Milliseconds 500 }
  $dailyHealth = Get-Health
  if ($null -eq $apiPid -or $null -eq $h5Pid -or -not (Test-DailyReady -Health $dailyHealth)) { throw 'daily services did not become ready' }
  $apiRootPid = Get-ManagedRootPid $apiPid $apiLauncherPid
  $h5RootPid = Get-ManagedRootPid $h5Pid $h5LauncherPid
  Ensure-TempRoot
  [ordered]@{ apiRootPid = $apiRootPid; h5RootPid = $h5RootPid; apiListenerPid = $apiPid; h5ListenerPid = $h5Pid; apiPort = $ApiPort; h5Port = $H5Port; startedAt = [DateTime]::UtcNow.ToString('o'); projectRoot = $ProjectRoot } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatePath -Encoding UTF8
  Write-Log 'daily services ready'
  [ordered]@{ status = 'ready'; database = 'knowledge_base'; schemaVersion = [int]$dailyHealth.body.schemaVersion } | ConvertTo-Json -Compress
} catch { Write-Log 'start failed'; Fail $_.Exception.Message }
