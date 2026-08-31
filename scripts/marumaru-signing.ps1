# ============================================================
# MaruMaru (muramura) Tauri updater 签名材料取回脚本
# 用途：无需记忆口令，一键取回签名私钥 / 公钥 / 口令
# 位置：scripts/marumaru-signing.ps1（仓库内，随仓库保留）
#
# 数据来源（优先级从高到低，任一完整可用即取用）：
#   1) 仓库内公开材料：src-tauri/signing-material/
#      private.key / private.key.pub / password.txt（推荐）
#   2) Windows 凭据管理器三条目：
#      MaruMaruTauriSigning(口令) / MaruMaruTauriSigningKey(私钥) / MaruMaruTauriSigningPub(公钥)
#   3) 机器备份：C:\Users\Administrator\Documents\marumaru-signing-backup
#      private.key / private.key.pub / password.txt
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/marumaru-signing.ps1
#       取回并导出环境变量（当前进程内有效的签名构建环境）
#   ... -ShowOnly   仅打印，不导出
#   ... -Verify     校验取回公钥与 tauri.conf.json plugins.updater.pubkey 一致
#   ... -TestSign   实际签名探针文件，端到端验证口令 + 私钥可用
# ============================================================
param(
  [switch]$ShowOnly,
  [switch]$Verify,
  [switch]$TestSign
)
$ErrorActionPreference = "Stop"

$repo      = Split-Path -Parent $PSScriptRoot
$repoDir   = Join-Path $repo "src-tauri\signing-material"
$backupDir = "C:\Users\Administrator\Documents\marumaru-signing-backup"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MaruCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type;
    public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public uint CredentialBlobSize;
    public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, uint type, uint reserved, out IntPtr credential);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0 || c.CredentialBlob == IntPtr.Zero) return "";
      byte[] b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, (int)c.CredentialBlobSize);
      return System.Text.Encoding.Unicode.GetString(b);
    } finally { CredFree(p); }
  }
}
'@

function Get-RepoFile([string]$name) {
  $p = Join-Path $repoDir $name
  if (Test-Path $p) { return (Get-Content -Raw -Encoding UTF8 $p).Trim() }
  return $null
}
function Get-Cred([string]$target) {
  try { return [MaruCred]::Read($target) } catch { return $null }
}
function Get-BackupFile([string]$name) {
  $p = Join-Path $backupDir $name
  if (Test-Path $p) { return (Get-Content -Raw -Encoding UTF8 $p).Trim() }
  return $null
}

# ---- 三级取回：仓库 -> 凭据管理器 -> 机器备份 ----
$srcLabel = $null
$password = Get-RepoFile "password.txt"
$key      = Get-RepoFile "private.key"
$pub      = Get-RepoFile "private.key.pub"
if ($password -and $key -and $pub) { $srcLabel = "仓库 src-tauri/signing-material" }
if (-not $srcLabel) {
  $password = Get-Cred "MaruMaruTauriSigning"
  $key      = Get-Cred "MaruMaruTauriSigningKey"
  $pub      = Get-Cred "MaruMaruTauriSigningPub"
  if ($password -and $key -and $pub) { $srcLabel = "Windows 凭据管理器" }
}
if (-not $srcLabel) {
  $password = Get-BackupFile "password.txt"
  $key      = Get-BackupFile "private.key"
  $pub      = Get-BackupFile "private.key.pub"
  if ($password -and $key -and $pub) { $srcLabel = "Documents 备份目录" }
}

$missing = @()
if (-not $password) { $missing += "口令(password.txt)" }
if (-not $key)      { $missing += "私钥(private.key)" }
if (-not $pub)      { $missing += "公钥(private.key.pub)" }
if ($missing.Count -gt 0 -or -not $srcLabel) {
  Write-Host ("MISSING: " + ($missing -join ", ") + "（仓库/凭据管理器/备份目录均未取到完整材料）") -ForegroundColor Red
  exit 1
}
Write-Host ("取回成功（来源: " + $srcLabel + "）:")
$info = @(
  @{ n = "口令 password        "; v = $password },
  @{ n = "私钥 private.key      "; v = $key },
  @{ n = "公钥 private.key.pub  "; v = $pub }
)
foreach ($i in $info) {
  $v = $i.v
  $head = $v.Substring(0, [Math]::Min(26, $v.Length)) -replace '[\r\n]', '|'
  Write-Host ("  " + $i.n + "  len=" + $v.Length + "  head=" + $head)
}

if (-not $ShowOnly) {
  $env:TAURI_SIGNING_PRIVATE_KEY         = $key
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH    = Join-Path $repoDir "private.key"
  Write-Host ""
  Write-Host "已导出（当前进程）: TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD / TAURI_SIGNING_PRIVATE_KEY_PATH"
  Write-Host "构建命令示例:"
  Write-Host "  node apps/client/node_modules/@tauri-apps/cli/tauri.js build --config src-tauri/tauri.conf.json"
}

if ($Verify) {
  $confPath = Join-Path $repo "src-tauri\tauri.conf.json"
  $conf = Get-Content -Raw $confPath | ConvertFrom-Json
  $confPub = $conf.plugins.updater.pubkey.Trim()
  $match = ($confPub -eq $pub)
  Write-Host ""
  Write-Host ("公钥与 tauri.conf.json plugins.updater.pubkey 一致: " + $match)
  if (-not $match) {
    Write-Host ("  仓库内公钥: " + $confPub.Substring(0, [Math]::Min(48, $confPub.Length)))
    Write-Host ("  取回公钥  : " + $pub.Substring(0, [Math]::Min(48, $pub.Length)))
  }
}

if ($TestSign) {
  $probe = Join-Path $env:TEMP ("marumaru-probe-" + [guid]::NewGuid().ToString("N") + ".bin")
  [System.IO.File]::WriteAllText($probe, "probe")
  $cli = Join-Path $repo "apps\client\node_modules\@tauri-apps\cli\tauri.js"
  # 用 -f 路径形式时清掉内容形式环境变量，避免 clap 两者冲突
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password
  $out = & node $cli signer sign -f (Join-Path $repoDir "private.key") -p $password $probe 2>&1 | Out-String
  $sig = $probe + ".sig"
  if (Test-Path $sig) {
    $sigLen = (Get-Item $sig).Length
    Remove-Item $probe, $sig -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host ("端到端签名验证: 成功（sig " + $sigLen + "B）——仓库材料的口令与私钥可用")
  } else {
    Write-Host ""
    Write-Host "端到端签名验证: 失败（未生成 .sig）" -ForegroundColor Red
    Write-Host ($out.Substring(0, [Math]::Min(400, $out.Length)))
    exit 2
  }
}
