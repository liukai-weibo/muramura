import { describe, expect, it } from 'vitest'
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  isSecureRequest,
  isTauriOrigin,
  parseSessionSecretFromAuthorization,
  parseSessionSecretFromCookie,
} from '../apps/api/src/hono/session'

// 会话 Cookie 的 Secure 标志按请求实际协议决定：
// 生产经 Caddy 的 HTTPS 入口必须带 Secure，本机明文开发不能带。
// 这些用例锁定该行为，防止回退成"永远不带"或"永远带"。

describe('isSecureRequest', () => {
  it('信任 X-Forwarded-Proto: https（生产经反向代理）', () => {
    expect(isSecureRequest({ forwardedProto: 'https', url: 'http://127.0.0.1:10086/api/v1/auth/login' })).toBe(true)
  })

  it('X-Forwarded-Proto: http 判定为非安全（不因 URL 是 https 而误判）', () => {
    expect(isSecureRequest({ forwardedProto: 'http', url: 'https://example.test/api/v1/auth/login' })).toBe(false)
  })

  it('无代理头时按请求 URL 协议判断（本机开发为明文）', () => {
    expect(isSecureRequest({ url: 'http://127.0.0.1:10086/api/v1/auth/login' })).toBe(false)
    expect(isSecureRequest({ url: 'https://www.muramura.icu/api/v1/auth/login' })).toBe(true)
  })

  it('缺少 URL 与代理头时按不安全处理', () => {
    expect(isSecureRequest({})).toBe(false)
  })

  it('多段 X-Forwarded-Proto 取第一段并忽略大小写与空白', () => {
    expect(isSecureRequest({ forwardedProto: 'HTTPS, http' })).toBe(true)
    expect(isSecureRequest({ forwardedProto: '  https  ' })).toBe(true)
    expect(isSecureRequest({ forwardedProto: 'http, https' })).toBe(false)
  })
})

describe('buildSessionCookie', () => {
  const secret = Buffer.alloc(32, 7)
  const expiresAt = '2026-10-04T01:00:14.179Z'

  it('HTTPS 生产请求带 Secure，同源浏览器用 SameSite=Lax', () => {
    const cookie = buildSessionCookie(secret, expiresAt, false, true)
    expect(cookie).toContain('; HttpOnly; Secure; SameSite=Lax;')
    expect(cookie).toContain('Path=/')
  })

  it('本机明文请求不带 Secure，避免浏览器丢弃 Cookie 无法调试', () => {
    const cookie = buildSessionCookie(secret, expiresAt, false, false)
    expect(cookie).toContain('; HttpOnly; SameSite=Lax;')
    expect(cookie).not.toContain('Secure')
  })

  it('桌面端跨源请求为 SameSite=None 且带 Secure', () => {
    const cookie = buildSessionCookie(secret, expiresAt, true, true)
    expect(cookie).toContain('; HttpOnly; Secure; SameSite=None;')
  })

  it('HTTPS 直连的桌面端请求同样带 Secure', () => {
    expect(buildSessionCookie(secret, expiresAt, true, true)).toContain('Secure')
  })

  it('保留 32 字节 base64url 会话值与原样过期时间', () => {
    const cookie = buildSessionCookie(secret, expiresAt, false, true)
    expect(cookie).toContain(`kb_session=${secret.toString('base64url')}`)
    expect(cookie).toContain(`Expires=${new Date(expiresAt).toUTCString()}`)
    expect(cookie.startsWith('kb_session=')).toBe(true)
    expect(cookie).not.toContain(';Secure')
  })
})

describe('buildExpiredSessionCookie', () => {
  it('清除用 Cookie 的标志与新下发保持一致（HTTPS）', () => {
    const cookie = buildExpiredSessionCookie(false, true)
    expect(cookie).toContain('; HttpOnly; Secure; SameSite=Lax;')
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })

  it('清除用 Cookie 的标志与新下发保持一致（本机明文）', () => {
    const cookie = buildExpiredSessionCookie(false, false)
    expect(cookie).toContain('; HttpOnly; SameSite=Lax;')
    expect(cookie).not.toContain('Secure')
  })

  it('清空会话值', () => {
    expect(buildExpiredSessionCookie(false, true).startsWith('kb_session=;')).toBe(true)
  })
})

describe('会话值解析与 Secure 改动无关的回归', () => {
  it('仍能解析 base64url 的 32 字节 Cookie 值', () => {
    const secret = Buffer.alloc(32, 3)
    const parsed = parseSessionSecretFromCookie(`other=1; kb_session=${secret.toString('base64url')}; x=2`)
    expect(parsed?.equals(secret)).toBe(true)
  })

  it('长度不足 32 字节的 Cookie 值被拒绝', () => {
    expect(parseSessionSecretFromCookie('kb_session=AAAA')).toBeUndefined()
  })

  it('仍能解析 Bearer 令牌（桌面端通道不受本次改动影响）', () => {
    const secret = Buffer.alloc(32, 5)
    expect(parseSessionSecretFromAuthorization(`Bearer ${secret.toString('base64url')}`)?.equals(secret)).toBe(true)
  })

  it('Tauri 来源识别不变', () => {
    expect(isTauriOrigin('tauri://localhost')).toBe(true)
    expect(isTauriOrigin('http://tauri.localhost')).toBe(true)
    expect(isTauriOrigin('https://www.muramura.icu')).toBe(false)
  })
})
