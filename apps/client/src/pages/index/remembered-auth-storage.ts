import { clearRememberedLoginPassword as clearDesktopPassword, readRememberedLoginPassword as readDesktopPassword, saveRememberedLoginPassword as saveDesktopPassword } from '../../desktop/desktop-native-bridge'

export interface RememberedAccount {
  username: string
  /** 该账号是否已持久化「记住的密码」；仅用于下拉列表标记。 */
  rememberPassword: boolean
  /** 最近成功登录时间（ISO）。 */
  updatedAt: string
}

export const REMEMBERED_ACCOUNTS_STORAGE_KEY = 'marumaru.auth.remembered-accounts'
export const REMEMBERED_ACCOUNT_LIMIT = 8

function rememberedPasswordKey(username: string): string {
  return `marumaru.auth.remembered-password:${username}`
}

function getStorage(): Storage | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined
    return window.localStorage
  } catch {
    return undefined
  }
}

/** 读取最近账号列表；非法/损坏数据一律降级为空列表，绝不抛错。 */
export function parseStoredAccounts(raw: string | null): RememberedAccount[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as { accounts?: unknown }
    if (!value || !Array.isArray(value.accounts)) return []
    const accounts: RememberedAccount[] = []
    for (const entry of value.accounts) {
      if (!entry || typeof entry !== 'object') continue
      const account = entry as Partial<RememberedAccount>
      if (typeof account.username !== 'string' || !account.username.trim()) continue
      accounts.push({
        username: account.username,
        rememberPassword: account.rememberPassword === true,
        updatedAt: typeof account.updatedAt === 'string' ? account.updatedAt : '',
      })
    }
    return accounts
  } catch {
    return []
  }
}

export function serializeAccounts(accounts: RememberedAccount[]): string {
  return JSON.stringify({ accounts })
}

/** 读本地最近账号列表（同步，失败返回空列表）。 */
export function loadRememberedAccounts(): RememberedAccount[] {
  try {
    const raw = getStorage()?.getItem(REMEMBERED_ACCOUNTS_STORAGE_KEY)
    if (raw == null) return []
    return parseStoredAccounts(raw)
  } catch {
    return []
  }
}

/** 记录一次成功登录/注册：去重置顶、裁剪到上限。纯函数，便于单测。 */
export function recordLogin(accounts: RememberedAccount[], username: string, rememberPassword: boolean, now = new Date().toISOString()): RememberedAccount[] {
  const normalized = username.trim()
  if (!normalized) return accounts
  return [
    { username: normalized, rememberPassword, updatedAt: now },
    ...accounts.filter((account) => account.username !== normalized),
  ].slice(0, REMEMBERED_ACCOUNT_LIMIT)
}

export function findAccount(accounts: RememberedAccount[], username: string): RememberedAccount | undefined {
  const normalized = username.trim()
  if (!normalized) return undefined
  return accounts.find((account) => account.username === normalized)
}

/** 把账号列表写回本地存储；失败静默（仅降级为不记忆）。 */
export function saveRememberedAccounts(accounts: RememberedAccount[]): void {
  try {
    getStorage()?.setItem(REMEMBERED_ACCOUNTS_STORAGE_KEY, serializeAccounts(accounts))
  } catch {
    // 存储不可用时降级为「不记忆账号」，不影响登录。
  }
}

/** 桌面端：把密码写入系统钥匙串；浏览器降级 localStorage。失败静默。 */
export async function saveRememberedPassword(username: string, password: string): Promise<void> {
  const normalized = username.trim()
  if (!normalized || !password) return
  try {
    await saveDesktopPassword(normalized, password)
  } catch {
    try {
      getStorage()?.setItem(rememberedPasswordKey(normalized), password)
    } catch {
      // 两路都失败：仅降级为记住账号。
    }
  }
}

/** 读取记住的密码；无则 undefined。 */
export async function loadRememberedPassword(username: string): Promise<string | undefined> {
  const normalized = username.trim()
  if (!normalized) return undefined
  try {
    const fromVault = await readDesktopPassword(normalized)
    if (fromVault != null) return fromVault
  } catch {
    // fall through to browser storage
  }
  try {
    return getStorage()?.getItem(rememberedPasswordKey(normalized)) ?? undefined
  } catch {
    return undefined
  }
}

/** 清除记住的密码（桌面钥匙串 + 浏览器兜底都清）。 */
export async function clearRememberedPassword(username: string): Promise<void> {
  const normalized = username.trim()
  if (!normalized) return
  try {
    await clearDesktopPassword(normalized)
  } catch {
    // ignore
  }
  try {
    getStorage()?.removeItem(rememberedPasswordKey(normalized))
  } catch {
    // ignore
  }
}
