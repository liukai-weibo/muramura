const sessionCookieName = 'kb_session'

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

export function buildSessionCookie(secret: Buffer, expiresAt: string): string {
  return `${sessionCookieName}=${secret.toString('base64url')}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}`
}

export function buildExpiredSessionCookie(): string {
  return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}
