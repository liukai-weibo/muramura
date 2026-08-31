# MaruMaru updater 签名材料（仓库公开）

本目录为 Tauri updater 签名密钥材料，随仓库公开存储（发布渠道为受仓库写权限保护的 GitHub Release，公开私钥不扩大攻击面）。

## 材料
- private.key      —— rsign 加密私钥（TAURI_SIGNING_PRIVATE_KEY / signer sign -f）
- private.key.pub  —— 公钥（与 src-tauri/tauri.conf.json plugins.updater.pubkey 一致）
- password.txt     —— 私钥口令（TAURI_SIGNING_PRIVATE_KEY_PASSWORD）

## 使用（无需记忆口令）
powershell -ExecutionPolicy Bypass -File scripts/marumaru-signing.ps1
- 默认：从本目录取回并导出 TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
- -Verify   校验公钥与 tauri.conf.json 一致
- -TestSign 探针文件端到端签名自检
- 本机另有回退：Windows 凭据管理器三条目 + Documents\marumaru-signing-backup

## 验证
- 本目录文件与 v0.1.30 签名版使用的密钥对一致（公钥 ID 49B8A457647EFD7C），.sig 由该私钥生成。
