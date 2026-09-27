const sessionCookieName = 'kb_session'
export const sessionTokenHeader = 'x-kb-session-token'

export function isTauriOrigin(origin: string | undefined): boolean {
  return origin === 'tauri://localhost' || origin === 'http://tauri.localhost'
}

/**
 * 判断本次请求是否经由 HTTPS 抵达，用于决定会话 Cookie 是否带 `Secure`。
 *
 * 生产环境请求先到 Caddy 再由其反代到本进程，socket 本身是明文，
 * 因此以 `X-Forwarded-Proto` 为准；直连（本机开发、集成测试）没有该头，
 * 此时按请求 URL 的协议判断。两者都判定为非 HTTPS 时不加 `Secure`。
 *
 * 本机开发是明文 HTTP，加 `Secure` 会导致浏览器直接丢弃 Cookie、无法调试，
 * 因此不能无条件添加；而生产全站强制 HTTPS，缺少 `Secure` 会让 Cookie
 * 在明文连接上仍然可用，属于应收紧的缺口。
 */
export function isSecureRequest(headers: { forwardedProto?: string; url?: string }): boolean {
  const forwarded = headers.forwardedProto?.split(',')[0]?.trim().toLowerCase()
  if (forwarded) return forwarded === 'https'
  return headers.url?.startsWith('https://') ?? false
}

export function parseSessionSecretFromCookie(cookieHeader: string | undefined): Buffer | undefined {
  const raw = cookieHeader
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionCookieName}=`))
    ?.slice(`${sessionCookieName}=`.length)
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined
  try {
    const value = Buffer.from(raw, 'base64url')
    return value.length === 32 ? value : undefined
  } catch {
    return undefined
  }
}

export function parseSessionSecretFromAuthorization(authorization: string | undefined): Buffer | undefined {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)
  const raw = match?.[1]
  if (!raw) return undefined
  try {
    const value = Buffer.from(raw, 'base64url')
    return value.length === 32 ? value : undefined
  } catch {
    return undefined
  }
}

export function parseSessionSecretFromHeaders(headers: { cookie?: string; authorization?: string }): Buffer | undefined {
  return parseSessionSecretFromAuthorization(headers.authorization) ?? parseSessionSecretFromCookie(headers.cookie)
}

/**
 * 组装会话 Cookie。
 *
 * - `Secure`：仅在请求确实经 HTTPS 抵达时添加（见 `isSecureRequest`），
 *   本机明文开发不加，否则 Cookie 无法保存、无法调试。
 * - `SameSite`：跨源（桌面端 Tauri）必须为 `None` 且此时 `Secure` 也是
 *   浏览器强制要求；同源浏览器请求使用 `Lax`。
 */
export function buildSessionCookie(secret: Buffer, expiresAt: string, crossSite = false, secure = false): string {
  return `${sessionCookieName}=${secret.toString('base64url')}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=${crossSite ? 'None' : 'Lax'}; Path=/; Expires=${new Date(expiresAt).toUTCString()}`
}

export function buildExpiredSessionCookie(crossSite = false, secure = false): string {
  return `${sessionCookieName}=; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=${crossSite ? 'None' : 'Lax'}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}
