[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) 'knowledge-base-local-start'
$StatePath = Join-Path $TempRoot 'state.json'
$LogPath = Join-Path $TempRoot 'launcher.log'
$ApiPort = 32146
$H5Port = 10086

function Fail([string]$Message) { [Console]::Error.WriteLine("ERROR: $Message"); exit 1 }
function Ensure-TempRoot { if (-not (Test-Path -LiteralPath $TempRoot)) { New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null } }
function Write-Log([string]$Message) { Ensure-TempRoot; Add-Content -LiteralPath $LogPath -Encoding ASCII -Value "$([DateTime]::UtcNow.ToString('o')) $Message" }
function Get-ListenerPid([int]$Port) { $rows = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); if ($rows.Count -eq 0) { return $null }; if ($rows.Count -ne 1) { throw 'multiple port listeners' }; return [int]$rows[0].OwningProcess }
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
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -WindowStyle Hidden | Out-Null
}
function Get-Health {
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:32146/health' -TimeoutSec 3; return [pscustomobject]@{ code = [int]$response.StatusCode; body = ($response.Content | ConvertFrom-Json) } } catch { return $null }
}
function Test-DailyReady { $health = Get-Health; return $null -ne $health -and $health.code -eq 200 -and $health.body.status -eq 'ready' -and $health.body.database -eq 'knowledge_base' -and [int]$health.body.schemaVersion -eq 4 }

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
  Start-Child 'api'
  for ($i = 0; $i -lt 60; $i++) { if (Test-DailyReady) { break }; Start-Sleep -Milliseconds 500 }
  if (-not (Test-DailyReady)) { throw 'daily API did not become ready' }
  Write-Log 'starting H5 child'
  Start-Child 'h5'
  $apiPid = $null; $h5Pid = $null
  for ($i = 0; $i -lt 60; $i++) { $apiPid = Get-ListenerPid $ApiPort; $h5Pid = Get-ListenerPid $H5Port; if ($null -ne $apiPid -and $null -ne $h5Pid) { break }; Start-Sleep -Milliseconds 500 }
  if ($null -eq $apiPid -or $null -eq $h5Pid -or -not (Test-DailyReady)) { throw 'daily services did not become ready' }
  Ensure-TempRoot
  [ordered]@{ apiListenerPid = $apiPid; h5ListenerPid = $h5Pid; apiPort = $ApiPort; h5Port = $H5Port; startedAt = [DateTime]::UtcNow.ToString('o'); projectRoot = $ProjectRoot } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatePath -Encoding UTF8
  Write-Log 'daily services ready'
  [ordered]@{ status = 'ready'; database = 'knowledge_base'; schemaVersion = 4 } | ConvertTo-Json -Compress
} catch { Write-Log 'start failed'; Fail $_.Exception.Message }
