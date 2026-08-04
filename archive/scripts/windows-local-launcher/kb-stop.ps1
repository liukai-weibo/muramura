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
function Test-OwnedListener([int]$ProcessId, [string]$Needle) { try { return ([string](Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine).Contains($Needle) } catch { return $false } }
function Get-ProcessSnapshot { return @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId) }
function Test-DescendantOf([int]$ChildPid, [int]$RootPid, $Snapshot) {
  $current = $ChildPid
  for ($i = 0; $i -lt 32; $i++) {
    if ($current -eq $RootPid) { return $true }
    $row = $Snapshot | Where-Object { [int]$_.ProcessId -eq $current } | Select-Object -First 1
    if ($null -eq $row -or [int]$row.ParentProcessId -le 0 -or [int]$row.ParentProcessId -eq $current) { return $false }
    $current = [int]$row.ParentProcessId
  }
  return $false
}
function Get-ManagedTree([int]$RootPid, $Snapshot) {
  $ids = [Collections.Generic.List[int]]::new(); $ids.Add($RootPid); $index = 0
  while ($index -lt $ids.Count) {
    $parent = $ids[$index]; $index += 1
    foreach ($row in $Snapshot | Where-Object { [int]$_.ParentProcessId -eq $parent }) { if (-not $ids.Contains([int]$row.ProcessId)) { $ids.Add([int]$row.ProcessId) } }
  }
  return @($ids)
}
function Stop-ManagedTree([int]$RootPid, $Snapshot) {
  $ids = @(Get-ManagedTree $RootPid $Snapshot)
  Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 100
  foreach ($id in $ids | Where-Object { $_ -ne $RootPid } | Sort-Object -Descending) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}
try {
  if (Test-Path -LiteralPath $StatePath) {
    try { $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $state = $null }
    $api = Get-ListenerPid 32146; $h5 = Get-ListenerPid 10086
    $matches = $false
    $snapshot = Get-ProcessSnapshot
    try { $matches = $null -ne $state -and $null -ne $api -and $null -ne $h5 -and [int]$state.apiListenerPid -eq $api -and [int]$state.h5ListenerPid -eq $h5 -and [string]$state.projectRoot -eq $ProjectRoot -and (Test-OwnedListener $api 'apps/api/src/main.ts') -and (Test-OwnedListener $h5 'apps\client') -and (Test-DescendantOf $api ([int]$state.apiRootPid) $snapshot) -and (Test-DescendantOf $h5 ([int]$state.h5RootPid) $snapshot) } catch { $matches = $false }
    if ($matches) {
      Stop-ManagedTree ([int]$state.apiRootPid) $snapshot
      Stop-ManagedTree ([int]$state.h5RootPid) $snapshot
      Write-Log 'stopped managed daily process trees'
    } else { Write-Log 'removed stale state without stopping processes' }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  }
  if ($StopMySql) { Set-Location -LiteralPath $ProjectRoot; & docker compose stop mysql; if ($LASTEXITCODE -ne 0) { throw 'docker compose mysql stop failed' }; Write-Log 'stopped mysql service' }
  [ordered]@{ stopped = $true; mysqlStopped = [bool]$StopMySql } | ConvertTo-Json -Compress
} catch { Write-Log 'stop failed'; Fail $_.Exception.Message }
