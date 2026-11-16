import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')

describe('canonical public domain', () => {
  it('redirects only the apex host to a fixed HTTPS www origin and preserves the request URI', () => {
    expect(config).toMatch(/if\s*\(\$host\s*=\s*muramura\.icu\)\s*\{\s*return 308 https:\/\/www\.muramura\.icu\$request_uri;\s*\}/)
  })

  it('runs the redirect before serving the app or proxying login requests', () => {
    const redirect = config.indexOf('return 308 https://www.muramura.icu$request_uri;')
    expect(redirect).toBeGreaterThan(-1)
    expect(redirect).toBeLessThan(config.indexOf('location = /health'))
    expect(redirect).toBeLessThan(config.indexOf('location /api/v1/'))
    expect(redirect).toBeLessThan(config.indexOf('location / {'))
  })
})
