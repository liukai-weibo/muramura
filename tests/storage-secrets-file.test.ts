import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileSecretStore } from '../packages/storage-secrets/src/index'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('file secret store', () => {
  it('persists values across store instances and clears them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-base-secret-'))
    temporaryDirectories.push(directory)
    const file = path.join(directory, 'nested', 'ai-config.json')
    const first = createFileSecretStore(file)
    const value = Buffer.from('{"serviceName":"local","apiKey":"redacted-in-test"}')

    expect(await first.get()).toBeUndefined()
    await first.set(value)
    expect(await createFileSecretStore(file).get()).toEqual(value)

    await first.clear()
    expect(await first.get()).toBeUndefined()
  })

  it('rejects relative paths', () => {
    expect(() => createFileSecretStore('secrets/ai-config.json')).toThrow()
  })
})
