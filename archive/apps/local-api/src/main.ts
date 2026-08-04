import { createLocalApi, defaultLocalApiPaths } from './index'

const api = createLocalApi(defaultLocalApiPaths())
await api.start()
console.log(`Knowledge_Base Local API listening at http://127.0.0.1:32145`)
