[CmdletBinding()]
param([switch]$StopMySql)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) 'knowledge-base-local-start'
$StatePath = Join-Path $TempRoot 'state.json'
$LogPath = Join-Path $TempRoot 'launcher.log'
function Fail([string]$Message) { [Console]::Error.WriteLine("ERROR: $Message"); exit 1 }
function Write-Log([string]$Message) { if (-not (Test-Path -LiteralPath $TempRoot)) { New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null }; Add-Content -LiteralPath $LogPath -Encoding ASCII -Value "$([DateTime]::UtcNow.ToString('o')) $Message" }
function Get-ListenerPid([int]$Port) { $rows = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); if ($rows.Count -eq 0) { return $null }; if ($rows.Count -ne 1) { throw 'multiple port listeners' }; return [int]$rows[0].OwningProcess }
function Test-OwnedListener([int]$Pid, [string]$Needle) { try { return ([string](Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction Stop).CommandLine).Contains($Needle) } catch { return $false } }
try {
  if (Test-Path -LiteralPath $StatePath) {
    try { $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $state = $null }
    $api = Get-ListenerPid 32146; $h5 = Get-ListenerPid 10086
    $matches = $false
    try { $matches = $null -ne $state -and $null -ne $api -and $null -ne $h5 -and [int]$state.apiListenerPid -eq $api -and [int]$state.h5ListenerPid -eq $h5 -and [string]$state.projectRoot -eq $ProjectRoot -and (Test-OwnedListener $api 'apps/api/src/main.ts') -and (Test-OwnedListener $h5 'apps/client') } catch { $matches = $false }
    if ($matches) { Stop-Process -Id $api -Force; Stop-Process -Id $h5 -Force; Write-Log 'stopped managed daily children' } else { Write-Log 'removed stale state without stopping processes' }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  }
  if ($StopMySql) { Set-Location -LiteralPath $ProjectRoot; & docker compose stop mysql; if ($LASTEXITCODE -ne 0) { throw 'docker compose mysql stop failed' }; Write-Log 'stopped mysql service' }
  [ordered]@{ stopped = $true; mysqlStopped = [bool]$StopMySql } | ConvertTo-Json -Compress
} catch { Write-Log 'stop failed'; Fail $_.Exception.Message }
