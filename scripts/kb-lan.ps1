[CmdletBinding(DefaultParameterSetName = 'enable')]
param(
  [Parameter(ParameterSetName = 'enable')]
  [string]$LanBindIp,
  [Parameter(Mandatory = $true, ParameterSetName = 'disable')]
  [switch]$Disable
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$FirewallRuleName = 'Knowledge_Base LAN H5 (Private only)'
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) 'knowledge-base-lan'
$OverridePath = Join-Path $TempRoot 'compose.override.yml'
$script:ComposeArgs = @()
$script:ReusedMySqlProject = $null

function Fail([string]$Message) {
  [Console]::Error.WriteLine("ERROR: $Message")
  exit 1
}

function Test-PrivateIpv4([System.Net.IPAddress]$Address) {
  $bytes = $Address.GetAddressBytes()
  return (
    $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
  )
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-LanFirewallRule([string]$BindIp) {
  Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
  New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 10086 -LocalAddress $BindIp -Profile Private,Public | Out-Null
}

function Remove-LanFirewallRule {
  Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
}

function Test-ComposeAppRunning {
  Set-Location -LiteralPath $ProjectRoot
  $services = @(& docker compose @script:ComposeArgs ps --services --status running 2>$null)
  return $services -contains 'app'
}

function Find-ExistingMySqlProject {
  $containerIds = @(& docker ps -q --filter 'label=com.docker.compose.service=mysql')
  $matches = @()
  foreach ($containerId in $containerIds) {
    $container = (& docker inspect $containerId | ConvertFrom-Json)[0]
    $labels = $container.Config.Labels
    if ($null -ne $labels -and $labels.'com.docker.compose.project.working_dir' -eq $ProjectRoot) {
      $matches += [string]$labels.'com.docker.compose.project'
    }
  }
  $projects = @($matches | Select-Object -Unique)
  if ($projects.Count -gt 1) { throw 'multiple existing Compose MySQL projects were found for this workspace' }
  if ($projects.Count -eq 1) { return $projects[0] }
  return $null
}

function Write-LanOverride([string]$BindIp) {
  New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
  @"
services:
  app:
    ports:
      - "${BindIp}:10086:8080"
"@ | Set-Content -LiteralPath $OverridePath -Encoding UTF8
}

function Enable-LanH5Binding([string]$BindIp) {
  Write-LanOverride $BindIp
  Set-Location -LiteralPath $ProjectRoot
  & docker compose @script:ComposeArgs -f docker-compose.yml -f $OverridePath config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'LAN Compose configuration is invalid' }
  & docker compose @script:ComposeArgs -f docker-compose.yml -f $OverridePath up -d --no-deps --force-recreate app
  if ($LASTEXITCODE -ne 0) { throw 'failed to recreate the existing app service with the LAN H5 binding' }
}

function Disable-LanH5Binding {
  Set-Location -LiteralPath $ProjectRoot
  & docker compose @script:ComposeArgs config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'loopback Compose configuration is invalid' }
  & docker compose @script:ComposeArgs up -d --no-deps --force-recreate app
  if ($LASTEXITCODE -ne 0) { throw 'failed to recreate the existing app service with loopback-only H5' }
  Remove-Item -LiteralPath $OverridePath -Force -ErrorAction SilentlyContinue
}

function Get-PrivateLocalAddresses {
  $addresses = @()
  foreach ($row in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop) {
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($row.IPAddress, [ref]$address) -or -not (Test-PrivateIpv4 $address)) { continue }
    $profile = Get-NetConnectionProfile -InterfaceIndex $row.InterfaceIndex -ErrorAction SilentlyContinue
    if ($null -ne $profile -and $profile.NetworkCategory -in @('Private', 'Public')) { $addresses += $row }
  }
  return @($addresses)
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env'))) { throw 'missing .env; create local configuration before publishing H5' }
  $script:ReusedMySqlProject = Find-ExistingMySqlProject
  if ($null -ne $script:ReusedMySqlProject) { $script:ComposeArgs = @('-p', $script:ReusedMySqlProject) }

  if ($Disable) {
    if (-not (Test-Administrator)) { throw 'run PowerShell as Administrator to remove the LAN H5 firewall rule' }
    if (-not (Test-ComposeAppRunning)) { throw 'Compose app is not running; cannot restore its H5 binding' }
    Disable-LanH5Binding
    Remove-LanFirewallRule
    [ordered]@{ status = 'loopback-only'; h5 = 'http://127.0.0.1:10086'; api = '127.0.0.1:32146'; mysql = '127.0.0.1:3306' } | ConvertTo-Json -Compress
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($LanBindIp)) {
    $localAddresses = Get-PrivateLocalAddresses
    if ($localAddresses.Count -ne 1) { throw 'found zero or multiple Private LAN IPv4 addresses; pass -LanBindIp explicitly' }
    $LanBindIp = $localAddresses[0].IPAddress
  } else {
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($LanBindIp, [ref]$address) -or $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'LAN_BIND_IP must be an IPv4 address' }
    if ($LanBindIp -eq '0.0.0.0' -or $address.Equals([System.Net.IPAddress]::Loopback) -or -not (Test-PrivateIpv4 $address)) { throw 'LAN_BIND_IP must be a private, non-loopback IPv4 address; 0.0.0.0 is forbidden' }
    $localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -eq $LanBindIp })
    if ($localAddresses.Count -ne 1) { throw 'LAN_BIND_IP must be assigned to exactly one local network adapter' }
  }
  $profile = Get-NetConnectionProfile -InterfaceIndex $localAddresses[0].InterfaceIndex -ErrorAction Stop
  if ($profile.NetworkCategory -notin @('Private', 'Public')) { throw 'LAN_BIND_IP must belong to a Windows Private or Public network' }
  if (-not (Test-Administrator)) { throw 'run PowerShell as Administrator to create the LAN H5 firewall rule' }
  if (-not (Test-ComposeAppRunning) -and $null -eq $script:ReusedMySqlProject) { throw 'Compose app is not running; start and verify the local Compose stack before changing its H5 binding' }

  Set-LanFirewallRule $LanBindIp
  try { Enable-LanH5Binding $LanBindIp } catch { Remove-LanFirewallRule; throw }
  [ordered]@{ status = 'lan-h5-ready'; h5 = "http://${LanBindIp}:10086"; loopbackH5 = 'http://127.0.0.1:10086'; reusedMySqlProject = $script:ReusedMySqlProject; api = 'loopback-only:127.0.0.1:32146'; mysql = 'loopback-only:127.0.0.1:3306' } | ConvertTo-Json -Compress
} catch {
  Fail $_.Exception.Message
}
