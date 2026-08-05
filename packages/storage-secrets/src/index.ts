import { createRequire } from 'node:module'
import fs from 'node:fs/promises'

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
  if (process.platform !== 'win32') return createMountedSecretStore()
  return createWindowsCredentialManagerStore(namespace)
}

type Keytar = { getPassword(service: string, account: string): Promise<string | null>; setPassword(service: string, account: string, password: string): Promise<void>; deletePassword(service: string, account: string): Promise<boolean> }

/** Windows Credential Manager adapter. No file/env fallback is permitted. */
export function createWindowsCredentialManagerStore(namespace: string): SecretStore {
  if (process.platform !== 'win32' || !/^kb_ai_[0-9a-f-]{8,}$/i.test(namespace)) throw new SecretStoreUnavailableError()
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
