const sessionCookieName = 'kb_session'
export const sessionTokenHeader = 'x-kb-session-token'

export function isTauriOrigin(origin: string | undefined): boolean {
  return origin === 'tauri://localhost' || origin === 'http://tauri.localhost'
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

export function buildSessionCookie(secret: Buffer, expiresAt: string, crossSite = false): string {
  return `${sessionCookieName}=${secret.toString('base64url')}; HttpOnly; ${crossSite ? 'SameSite=None; Secure' : 'SameSite=Lax'}; Path=/; Expires=${new Date(expiresAt).toUTCString()}`
}

export function buildExpiredSessionCookie(crossSite = false): string {
  return `${sessionCookieName}=; HttpOnly; ${crossSite ? 'SameSite=None; Secure' : 'SameSite=Lax'}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}
