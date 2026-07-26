import { createApiServer, readApiListenConfig } from './index'

const server = createApiServer()
const { host, port } = readApiListenConfig(process.env)
server.listen(port, host, () => console.log(`Knowledge_Base MySQL API listening at http://${host}:${port}`))
