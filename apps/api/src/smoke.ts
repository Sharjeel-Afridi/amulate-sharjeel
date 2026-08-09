/**
 * Drives a full journey against the running API and asserts the pipeline works.
 *
 * Start both servers first:
 *   npm run start -w @car/mcp-marketplace
 *   npm run start -w @car/api
 * then: npm run smoke -w @car/api
 */
import type { ServerEvent } from './events.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

const seen: ServerEvent[] = []
const failures: string[] = []

async function readStream(sessionId: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${API}/api/session/${sessionId}/stream`, { signal })
  if (!res.body) throw new Error('no SSE body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const event = JSON.parse(line.slice(6)) as ServerEvent
      seen.push(event)
      describe(event)
    }
  }
}

function describe(e: ServerEvent): void {
  switch (e.type) {
    case 'message': return console.log(`  agent   ${e.text}`)
    case 'step': return console.log(`  step    ${e.label}${e.detail ? ` — ${e.detail}` : ''}`)
    case 'phase': return console.log(`  phase   → ${e.phase}`)
    case 'a2ui': return console.log(`  a2ui    ${e.messages.length} message(s): ${e.messages.map(kindOf).join(', ')}`)
    case 'mcpApp': return console.log(`  mcpApp  ${e.toolName} (${e.html.length} bytes)`)
    case 'results': return console.log(`  results ${e.shortlist.length} ranked`)
    case 'error': return console.log(`  ERROR   ${e.message}`)
    default: return
  }
}

const kindOf = (m: object) =>
  Object.keys(m).find((k) => k !== 'version') ?? 'unknown'

const send = (id: string, text: string) =>
  fetch(`${API}/api/session/${id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------

const healthRes = await fetch(`${API}/api/health`)
const healthBody = (await healthRes.json()) as { driver: string; mcp: { connected: boolean; tools: string[] } }
console.log(`driver: ${healthBody.driver} · mcp connected: ${healthBody.mcp.connected} · ${healthBody.mcp.tools.length} tools\n`)
if (!healthBody.mcp.connected) failures.push('API cannot reach the MCP marketplace')

const created = (await (await fetch(`${API}/api/session`, { method: 'POST' })).json()) as {
  sessionId: string
}
console.log(`session ${created.sessionId}\n`)

// Pin the driver rather than inheriting whatever the server booted with. The
// scripted path exercises the same tools, state and surfaces, and a smoke test
// that quietly starts spending a rate-limited quota is a test that fails for
// reasons having nothing to do with the code under test.
const pinned = await fetch(`${API}/api/session/${created.sessionId}/mode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'scripted' }),
})
if (!pinned.ok) failures.push('could not pin the session to the scripted driver')

const controller = new AbortController()
const streaming = readStream(created.sessionId, controller.signal).catch(() => {})
await wait(300)

// The full interview, one answer per turn. It deliberately runs to completion
// before anything is searched, so a short script no longer reaches results.
const turns = [
  'rent',
  'weekend trips with two kids',
  'five',
  'suv',
  // Sized to the real fleet: hire runs $1,170–$9,400 a month.
  '3000 a month',
  '12 September',
  '19 September',
  'pram and big luggage',
  'no preference',
  'automatic',
  'nothing to rule out',
  // The spec gate: nothing is searched until this is confirmed.
  'yes, go ahead and search',
]

for (const turn of turns) {
  console.log(`\nuser    ${turn}`)
  await send(created.sessionId, turn)
  await wait(900)
}

await wait(1800)

console.log('\nuser    book the top one')
await send(created.sessionId, 'book the top one')
await wait(1800)

controller.abort()
await streaming

// ------------------------------------------------------------------ asserts

const has = (t: ServerEvent['type']) => seen.some((e) => e.type === t)
const results = seen.find((e): e is Extract<ServerEvent, { type: 'results' }> => e.type === 'results')

console.log('\n--- checks ---')
if (!has('state')) failures.push('no state snapshot received')
if (!has('step')) failures.push('no reasoning steps emitted')
if (!has('a2ui')) failures.push('no A2UI surfaces emitted')
if (!has('results')) failures.push('no ranked results emitted')
if (!has('mcpApp')) failures.push('booking MCP App was never rendered')
if (!results?.shortlist.length) failures.push('shortlist was empty')

// NaN serialises to null over JSON, so an un-asserted score hides a broken
// scorer behind a passing test. Check the values, not just the shape.
for (const r of results?.shortlist ?? []) {
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) {
    failures.push(`${r.listing.brand} ${r.listing.model} has a non-numeric score (${r.score})`)
  }
  if (typeof r.rank !== 'number') failures.push('a result is missing its rank')
  if (!r.factors?.length) failures.push(`${r.listing.brand} has no score factors to explain its rank`)
}

const rationales = results?.shortlist.map((r) => r.rationale) ?? []
if (rationales.some((r) => !r || r.length < 10)) failures.push('a rationale was empty or trivial')
if (rationales.some((r) => /great choice|perfect for you|excellent option/i.test(r))) {
  failures.push('a rationale used generic filler instead of citing a stated criterion')
}

for (const r of results?.shortlist.slice(0, 3) ?? []) {
  console.log(`  #${r.rank} ${r.listing.brand} ${r.listing.model} (${r.score}) — ${r.rationale}`)
}

if (failures.length) {
  console.error('\nFAILED:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nsmoke passed')
