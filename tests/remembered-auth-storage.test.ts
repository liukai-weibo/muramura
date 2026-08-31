import { describe, expect, it } from 'vitest'
import { parseStoredAccounts, recordLogin, REMEMBERED_ACCOUNT_LIMIT, serializeAccounts, findAccount } from '../apps/client/src/pages/index/remembered-auth-storage'

describe('remembered-auth-storage recordLogin', () => {
  it('顶置最近登录的账号并去重', () => {
    const base = [
      { username: 'a', rememberPassword: true, updatedAt: '2026-08-30T00:00:00.000Z' },
      { username: 'b', rememberPassword: false, updatedAt: '2026-08-30T01:00:00.000Z' },
    ]
    const next = recordLogin(base, 'b', true, '2026-08-31T00:00:00.000Z')
    expect(next.map(a => a.username)).toEqual(['b', 'a'])
    expect(next[0]!.rememberPassword).toBe(true)
    expect(next[0]!.updatedAt).toBe('2026-08-31T00:00:00.000Z')
  })

  it('裁剪到上限 8 个', () => {
    let accounts: { username: string; rememberPassword: boolean; updatedAt: string }[] = []
    for (let i = 0; i < 12; i++) accounts = recordLogin(accounts, 'user' + i, false, '2026-08-01T00:00:00.000Z')
    expect(accounts.length).toBe(REMEMBERED_ACCOUNT_LIMIT)
    expect(accounts[0]!.username).toBe('user11')
  })

  it('空用户名不写入', () => {
    const base = [{ username: 'a', rememberPassword: false, updatedAt: '' }]
    expect(recordLogin(base, '   ', false)).toEqual(base)
  })
})

describe('remembered-auth-storage parse/serialize', () => {
  it('serialize 后 parse 往返一致', () => {
    const accounts = [
      { username: 'a', rememberPassword: true, updatedAt: '2026-08-30T00:00:00.000Z' },
      { username: 'b', rememberPassword: false, updatedAt: '' },
    ]
    expect(parseStoredAccounts(serializeAccounts(accounts))).toEqual(accounts)
  })

  it('非法/损坏输入降级为空列表', () => {
    expect(parseStoredAccounts(null)).toEqual([])
    expect(parseStoredAccounts('')).toEqual([])
    expect(parseStoredAccounts('not-json')).toEqual([])
    expect(parseStoredAccounts('{"accounts": "oops"}')).toEqual([])
    expect(parseStoredAccounts('{"accounts": [{"username": 3}]}')).toEqual([])
    expect(parseStoredAccounts('{"accounts": [{"username": " ok ", "rememberPassword": "yes"}]}')).toEqual([
      { username: ' ok ', rememberPassword: false, updatedAt: '' },
    ])
  })

  it('findAccount 精确匹配且忽略空白用户名', () => {
    const accounts = [
      { username: 'alice', rememberPassword: true, updatedAt: '' },
      { username: 'bob', rememberPassword: false, updatedAt: '' },
    ]
    expect(findAccount(accounts, 'alice')?.rememberPassword).toBe(true)
    expect(findAccount(accounts, '  ')).toBeUndefined()
    expect(findAccount(accounts, 'charlie')).toBeUndefined()
  })
})
