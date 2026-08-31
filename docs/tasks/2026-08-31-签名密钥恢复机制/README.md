# 签名密钥恢复机制（2026-08-31 建立）

## 要解决的问题
2026-08-29 生成的旧 updater 签名私钥（公钥 ID FE3D36848EB4D8F2）口令丢失且 rsign 加密不可解密，导致 v0.1.30 一度无法签名。本次更换新密钥对（公钥 ID 49B8A457647EFD7C），并建立「无需记忆口令」的取回机制，防止再次丢失。

## 现状
- 新密钥对安装于 src-tauri/private.key(.pub)，src-tauri/tauri.conf.json 的 plugins.updater.pubkey 已同步为新公钥。
- v0.1.30 已发布签名版（git commit f80c14a），updater.json 指向 v0.1.30。
- 旧密钥备份于 src-tauri/key-backup-20260831-old/（不入库，仅留档）。

## 密钥与口令存储位置（机器级，双备份互备）
- Windows 凭据管理器三条目：
  - MaruMaruTauriSigning        -> 口令（TAURI_SIGNING_PRIVATE_KEY_PASSWORD）
  - MaruMaruTauriSigningKey     -> 私钥内容（TAURI_SIGNING_PRIVATE_KEY）
  - MaruMaruTauriSigningPub     -> 公钥内容
- C:\Users\Administrator\Documents\marumaru-signing-backup\
  - private.key / private.key.pub / password.txt（明文机器副本）

## 取回方式（一条命令，无需记忆口令）
powershell -ExecutionPolicy Bypass -File scripts/marumaru-signing.ps1
- 默认：取回并导出 TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD（当前进程内）
- -ShowOnly  仅打印，不导出
- -Verify    校验取回公钥与 tauri.conf.json plugins.updater.pubkey 一致
- -TestSign  实际签名探针文件，端到端验证口令与私钥可用
- 凭据管理器条目被清空/丢失时，脚本自动回退 Documents 备份目录（已验证）

## 换机器 / 重装系统
- 复制 Documents\marumaru-signing-backup 到新机器，脚本自动使用该目录；或在凭据管理器重建三条目。
- 公钥永远不需要记或找：仓库 src-tauri/tauri.conf.json 内即最新公钥。

## 注意事项
- 上述位置含明文私钥与口令，不得外传、不得提交到任何仓库或网盘公开位置。
- 本 README 与 scripts/marumaru-signing.ps1 均不含明文口令（已代码级校验）。
- 发布新版本时：先跑一次脚本 -TestSign 自检，再构建即可自动带签名。
