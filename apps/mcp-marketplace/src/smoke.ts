/**
 * Connects to the running marketplace as a real MCP client and exercises the
 * whole booking path. Run the server first, then `npm run smoke -w @car/mcp-marketplace`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ENDPOINT = process.env.MCP_URL ?? 'http://localhost:8081/mcp'

function text(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? `<${c.type}>`).join('\n')
}

function contentTypes(result: unknown): string[] {
  const content = (result as { content?: { type: string; resource?: { uri?: string; mimeType?: string } }[] }).content ?? []
  return content.map((c) => (c.resource ? `${c.type}(${c.resource.uri} ${c.resource.mimeType})` : c.type))
}

const client = new Client({ name: 'smoke', version: '0.1.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT)))

const tools = await client.listTools()
console.log('tools:    ', tools.tools.map((t) => t.name).join(', '))

const resources = await client.listResources()
console.log('resources:', resources.resources.map((r) => `${r.uri} [${r.mimeType}]`).join(', '))

const uiTools = tools.tools.filter((t) => {
  const meta = t._meta as { ui?: { resourceUri?: string } } | undefined
  return meta?.ui?.resourceUri
})
console.log('app tools:', uiTools.map((t) => `${t.name} -> ${(t._meta as { ui: { resourceUri: string } }).ui.resourceUri}`).join(', '))

console.log('\n--- search ---')
const search = await client.callTool({
  name: 'search_listings',
  arguments: { mode: 'rent', category: 'suv', budgetMax: 400, bootLitresMin: 450, limit: 4 },
})
const parsed = JSON.parse(text(search)) as {
  matched: number
  relaxed: string[]
  listings: { id: string; brand: string; model: string; monthlyRate?: number; bootLitres: number }[]
}
console.log(`matched=${parsed.matched} relaxed=[${parsed.relaxed}]`)
for (const l of parsed.listings) {
  console.log(`  ${l.id.padEnd(26)} ${`${l.brand} ${l.model}`.padEnd(24)} EUR ${l.monthlyRate}/mo  boot ${l.bootLitres}L`)
}

const first = parsed.listings[0]
if (!first) throw new Error('search returned nothing — cannot continue')

console.log('\n--- availability ---')
console.log(text(await client.callTool({
  name: 'check_availability',
  arguments: { listingId: first.id, startDate: '2026-09-12', endDate: '2026-09-19' },
})))

console.log('\n--- start_booking (MCP App) ---')
const form = await client.callTool({
  name: 'start_booking',
  arguments: { listingId: first.id, startDate: '2026-09-12', endDate: '2026-09-19' },
})
console.log('content:', contentTypes(form).join(', '))

console.log('\n--- read predeclared ui:// resource ---')
const read = await client.readResource({ uri: 'ui://car-matchmaker/booking-form.html' })
const html = (read.contents[0] as { text?: string }).text ?? ''
console.log(`booking-form.html: ${html.length} bytes, mime=${read.contents[0]?.mimeType}`)
console.log('matches embedded instance:', html.includes(first.brand))

console.log('\n--- submit_booking ---')
const submitted = await client.callTool({
  name: 'submit_booking',
  arguments: {
    listingId: first.id,
    fullName: 'Alex Moreau',
    email: 'alex@example.com',
    startDate: '2026-09-12',
    endDate: '2026-09-19',
    extras: ['insurance', 'child-seat'],
    expectedTotal: 0,
  },
})
console.log(text(submitted))
const bookingId = (JSON.parse(text(submitted)) as { bookingId: string }).bookingId

console.log('\n--- start_checkout (MCP App) ---')
const checkout = await client.callTool({ name: 'start_checkout', arguments: { bookingId } })
console.log('content:', contentTypes(checkout).join(', '))

console.log('\n--- confirm_payment ---')
console.log(text(await client.callTool({ name: 'confirm_payment', arguments: { bookingId } })))

await client.close()
console.log('\nsmoke passed')
