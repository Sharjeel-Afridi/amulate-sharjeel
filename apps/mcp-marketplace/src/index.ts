import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { catalog } from '@car/catalog'
import cors from 'cors'
import express from 'express'
import { buildServer } from './server.js'

const PORT = Number(process.env.MCP_PORT ?? 8081)

const app = express()

app.use(
  cors({
    origin: true,
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'Mcp-Session-Id', 'mcp-protocol-version', 'Accept'],
  }),
)
app.use(express.json({ limit: '4mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'car-marketplace-mcp', listings: catalog().length })
})

/**
 * Stateless transport: a fresh server per request, no session tracking. The
 * marketplace's only mutable state is the booking store, which lives in the
 * module scope of the process and so outlives any single request.
 */
app.post('/mcp', async (req, res) => {
  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('[mcp] request failed:', err)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
})

const notAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this server is stateless' },
    id: null,
  })
}
app.get('/mcp', notAllowed)
app.delete('/mcp', notAllowed)

app.listen(PORT, () => {
  console.log(`[mcp] car marketplace on http://localhost:${PORT}/mcp (${catalog().length} listings)`)
})
