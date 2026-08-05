import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export class SecretStoreUnavailableError extends Error {
  constructor() { super('OS secret store unavailable'); this.name = 'SecretStoreUnavailableError' }
}

export interface SecretStore {
  get(): Promise<Buffer | undefined>
  set(value: Uint8Array): Promise<void>
  clear(): Promise<void>
}

/** Read-only container adapter for Docker Secret mounts. Updates require rebuild/restart. */
export function createMountedSecretStore(directory = '/run/secrets'): SecretStore {
  const file = (name: string) => `${directory}/${name}`
  return {
    async get() {
      try {
        const [serviceName, modelName, baseUrl, apiKey] = await Promise.all(['ai_service_name', 'ai_model_name', 'ai_base_url', 'ai_api_key'].map((name) => fs.readFile(file(name), 'utf8')))
        return Buffer.from(JSON.stringify({ serviceName: serviceName!.trim(), modelName: modelName!.trim(), baseUrl: baseUrl!.trim(), apiKey: apiKey!.trim() }))
      } catch { throw new SecretStoreUnavailableError() }
    },
    async set() { throw new SecretStoreUnavailableError() },
    async clear() { throw new SecretStoreUnavailableError() },
  }
}

export function createProtectedSecretStore(namespace: string): SecretStore {
  if (!/^kb_ai_[0-9a-f-]{8,}$/i.test(namespace)) throw new SecretStoreUnavailableError()
  return createKeytarSecretStore(namespace)
}

/** Writable file-backed store for a private Docker named volume. */
export function createFileSecretStore(filePath = '/var/lib/knowledge-base/secrets/ai-config.json'): SecretStore {
  if (!path.isAbsolute(filePath)) throw new SecretStoreUnavailableError()
  const directory = path.dirname(filePath)
  return {
    async get() {
      try { return await fs.readFile(filePath) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw new SecretStoreUnavailableError()
      }
    },
    async set(value) {
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 })
        await fs.writeFile(temporaryPath, value, { mode: 0o600 })
        await fs.chmod(temporaryPath, 0o600)
        await fs.rename(temporaryPath, filePath)
        await fs.chmod(filePath, 0o600)
      } catch {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        throw new SecretStoreUnavailableError()
      }
    },
    async clear() {
      try { await fs.rm(filePath, { force: true }) }
      catch { throw new SecretStoreUnavailableError() }
    },
  }
}

type Keytar = { getPassword(service: string, account: string): Promise<string | null>; setPassword(service: string, account: string, password: string): Promise<void>; deletePassword(service: string, account: string): Promise<boolean> }

/** Windows Credential Manager adapter. No file/env fallback is permitted. */
export function createWindowsCredentialManagerStore(namespace: string): SecretStore {
  if (process.platform !== 'win32' || !/^kb_ai_[0-9a-f-]{8,}$/i.test(namespace)) throw new SecretStoreUnavailableError()
  return createKeytarSecretStore(namespace)
}

/** Writable OS-managed secret store for local development on Windows and Linux. */
export function createKeytarSecretStore(namespace: string): SecretStore {
  if (!/^kb_ai_[0-9a-f-]{8,}$/i.test(namespace)) throw new SecretStoreUnavailableError()
  let keytar: Keytar
  try { keytar = createRequire(import.meta.url)('keytar') as Keytar } catch { throw new SecretStoreUnavailableError() }
  const service = 'knowledge-base.experimental-ai'
  const account = namespace
  return {
    async get() {
      try { const value = await keytar.getPassword(service, account); return value == null ? undefined : Buffer.from(value, 'base64') } catch { throw new SecretStoreUnavailableError() }
    },
    async set(value) {
      try { await keytar.setPassword(service, account, Buffer.from(value).toString('base64')) } catch { throw new SecretStoreUnavailableError() }
    },
    async clear() {
      try { await keytar.deletePassword(service, account) } catch { throw new SecretStoreUnavailableError() }
    },
  }
}
