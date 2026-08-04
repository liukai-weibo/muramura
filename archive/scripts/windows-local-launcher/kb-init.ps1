[CmdletBinding()]
param([string]$BackupPath)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvPath = Join-Path $ProjectRoot '.env'
$ExamplePath = Join-Path $ProjectRoot '.env.example'
function Fail([string]$Message) { [Console]::Error.WriteLine("ERROR: $Message"); exit 1 }
function Read-Environment {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding UTF8) { if ($line -match '^\s*#' -or $line -notmatch '=') { continue }; $pair = $line -split '=', 2; $name = $pair[0].Trim(); $value = $pair[1].Trim(); if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }; $values[$name] = $value }
  if ($values['MYSQL_DATABASE'] -ne 'knowledge_base' -or $values['MYSQL_HOST'] -ne '127.0.0.1' -or $values['API_HOST'] -ne '127.0.0.1' -or $values['API_PORT'] -ne '32146') { throw '.env is not the approved daily loopback configuration' }; return $values
}
function Invoke-EnvNode([string]$Code) {
  $escapedRoot = $ProjectRoot.Replace("'", "''"); $encodedCode = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Code))
  $child = @"
Set-Location -LiteralPath '$escapedRoot'
foreach (`$line in Get-Content -LiteralPath '.env' -Encoding UTF8) { if (`$line -match '^\s*#' -or `$line -notmatch '=') { continue }; `$p = `$line -split '=',2; [Environment]::SetEnvironmentVariable(`$p[0].Trim(), `$p[1].Trim(), 'Process') }
& node.exe -e "eval(Buffer.from('$encodedCode','base64').toString('utf8'))"
exit `$LASTEXITCODE
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child)); & powershell.exe -NoProfile -EncodedCommand $encoded
  if ($LASTEXITCODE -ne 0) { throw 'database inspection failed' }
}
function Get-DatabaseState {
  $code = @'
const mysql=require('mysql2/promise');(async()=>{const c=await mysql.createConnection({host:process.env.MYSQL_HOST,port:+process.env.MYSQL_PORT,user:process.env.MYSQL_MIGRATOR_USER,password:process.env.MYSQL_MIGRATOR_PASSWORD,database:process.env.MYSQL_DATABASE});const [r]=await c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='schema_migrations'");const [t]=await c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('items','reviews','methods','method_evidence','method_versions','method_applications','item_status_events','item_links','method_tombstones','exploration_tracks')");console.log(JSON.stringify({migrationTable:r[0].n,businessTables:t[0].n}));await c.end()})().catch(e=>{console.error(e.code||'database error');process.exit(1)})
'@
  return (Invoke-EnvNode $code | Select-Object -Last 1 | ConvertFrom-Json)
}
try {
  Set-Location -LiteralPath $ProjectRoot
  if (-not (Test-Path -LiteralPath $EnvPath)) { if (-not (Test-Path -LiteralPath $ExamplePath)) { throw 'missing .env.example' }; Copy-Item -LiteralPath $ExamplePath -Destination $EnvPath -ErrorAction Stop; Write-Output 'created .env from .env.example; update local passwords before continuing'; exit 0 }
  Read-Environment | Out-Null
  & docker compose up -d mysql; if ($LASTEXITCODE -ne 0) { throw 'docker compose mysql start failed' }
  $db = Get-DatabaseState
  if ([int]$db.migrationTable -eq 0 -and [int]$db.businessTables -eq 0) {
    $root = $ProjectRoot.Replace("'", "''")
    $migrationChild = @"
Set-Location -LiteralPath '$root'
foreach (`$line in Get-Content -LiteralPath '.env' -Encoding UTF8) { if (`$line -match '^\s*#' -or `$line -notmatch '=') { continue }; `$p=`$line -split '=',2; [Environment]::SetEnvironmentVariable(`$p[0].Trim(),`$p[1].Trim(),'Process') }
& corepack pnpm --filter '@knowledge-base/api' migrate
exit `$LASTEXITCODE
"@
    $migrationEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($migrationChild))
    & powershell.exe -NoProfile -EncodedCommand $migrationEncoded
    if ($LASTEXITCODE -ne 0) { throw 'initial migration failed' }
  } elseif ([int]$db.migrationTable -eq 0) { throw 'database is not empty; refusing migration' }
  & (Join-Path $PSScriptRoot 'kb-start.ps1'); if ($LASTEXITCODE -ne 0) { throw 'daily start failed' }
  if ($PSBoundParameters.ContainsKey('BackupPath')) {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'backup path does not exist' }
    $backup = Get-Content -LiteralPath $BackupPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($backup.format -ne 'knowledge-base-backup' -or [int]$backup.version -ne 3) { throw 'backup is not Backup V3' }
    $daily = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:32146/api/v1/backup' -TimeoutSec 10 | Select-Object -ExpandProperty Content | ConvertFrom-Json
    $sets = 'items','reviews','methods','methodEvidence','methodVersions','methodApplications','itemStatusEvents','itemLinks','methodTombstones','explorationTracks'
    foreach ($set in $sets) { if (@($daily.data.$set).Count -ne 0) { throw 'daily business collections are not empty; refusing backup restore' } }
    $json = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $BackupPath), [Text.Encoding]::UTF8)
    try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:32146/api/v1/backup/restore' -Method Post -ContentType 'application/json' -Body $json -TimeoutSec 30 } catch { throw 'backup restore failed' }
    if ([int]$response.StatusCode -ne 204) { throw 'backup restore failed' }
  }
  Write-Output 'daily initialization ready'
} catch { Fail $_.Exception.Message }
