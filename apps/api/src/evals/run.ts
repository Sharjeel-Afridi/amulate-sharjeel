import type { RankedListing } from '@car/shared'
import { loadEnv } from '../env.js'
import type { ServerEvent } from '../events.js'
// Type-only, so it is erased at runtime and does not disturb the import ordering
// the dynamic imports below exist to preserve.
import type { Score } from './judges.js'

loadEnv()

/*
 * Tracing is started before the rest of the module graph, for the same reason
 * `main.ts` does it: the provider must be registered before anything resolves a
 * tracer. Imported dynamically so that ordering actually holds.
 */
const { Kind, flushTracing, semconv, startTracing, withSpan, annotate, setOutput } = await import(
  '../otel/index.js'
)
const { CASES } = await import('./dataset.js')
const { deterministicScores, groundednessScores, readJudgeConfig } = await import('./judges.js')

startTracing()

/**
 * The eval runner.
 *
 * Drives whole journeys against a running API and scores what comes back, then
 * exits non-zero if anything regressed — so it works as a CI gate rather than
 * only as something to read.
 *
 * Start the servers first:
 *   npm run start -w @car/mcp-marketplace
 *   npm run start -w @car/api
 * then:
 *   npm run eval -w @car/api                  # scripted: free, deterministic
 *   EVAL_MODE=agent npm run eval -w @car/api   # exercises the model ranker
 *
 * Scripted is the default because it costs nothing and still exercises the
 * scorer, the screening and the whole surface pipeline. `EVAL_MODE=agent` is what
 * grades the model — and what spends the day's token allowance, so it is opt-in.
 */

const API = process.env.API_URL ?? 'http://localhost:8080'
const MODE = (process.env.EVAL_MODE ?? 'scripted').trim().toLowerCase() === 'agent' ? 'agent' : 'scripted'
/** Any single score below this fails the run. */
const THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? 0.8)
/** Agent turns need far longer than scripted ones; a model is in the loop. */
const TURN_WAIT_MS = Number(process.env.EVAL_TURN_WAIT_MS ?? (MODE === 'agent' ? 4_000 : 900))

interface CaseResult {
  id: string
  intent: string
  shortlist: RankedListing[]
  rankedBy: string
  scores: Score[]
  hardFailure?: string
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Collects SSE events for one session until aborted. */
async function collect(sessionId: string, signal: AbortSignal, sink: ServerEvent[]): Promise<void> {
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
      if (line) sink.push(JSON.parse(line.slice(6)) as ServerEvent)
    }
  }
}

async function runCase(kase: (typeof CASES)[number]): Promise<CaseResult> {
  return withSpan(
    `eval:${kase.id}`,
    {
      kind: Kind.Chain,
      input: { turns: kase.turns, mode: MODE },
      attributes: { 'eval.case': kase.id, 'eval.mode': MODE, [semconv.TAGS]: ['eval', kase.id] },
    },
    async (): Promise<CaseResult> => {
      const created = (await (await fetch(`${API}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string
      }
      const sessionId = created.sessionId

      const pinned = await fetch(`${API}/api/session/${sessionId}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: MODE }),
      })
      if (!pinned.ok) {
        return {
          id: kase.id,
          intent: kase.intent,
          shortlist: [],
          rankedBy: 'none',
          scores: [],
          hardFailure: `could not pin the session to ${MODE}: ${await pinned.text()}`,
        }
      }

      const events: ServerEvent[] = []
      const controller = new AbortController()
      const streaming = collect(sessionId, controller.signal, events).catch(() => {})
      await wait(300)

      for (const turn of kase.turns) {
        await fetch(`${API}/api/session/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: turn }),
        })
        await wait(TURN_WAIT_MS)
      }
      // Research and ranking run after the confirming turn returns.
      await wait(MODE === 'agent' ? 6_000 : 2_000)
      controller.abort()
      await streaming

      const results = events.filter(
        (e): e is Extract<ServerEvent, { type: 'results' }> => e.type === 'results',
      )
      const shortlist = results.at(-1)?.shortlist ?? []
      const errors = events.filter((e): e is Extract<ServerEvent, { type: 'error' }> => e.type === 'error')

      // `rankedBy` is not on the wire, so it is recovered from the step chip the
      // journey emits. Imperfect, but it is the one signal that distinguishes a
      // model ranking from a silent fallback to the scorer.
      const steps = events.filter((e): e is Extract<ServerEvent, { type: 'step' }> => e.type === 'step')
      const rankedBy = steps.some((s) => /Ranked by the agent/i.test(s.label)) ? 'model' : 'scorer'

      if (shortlist.length < kase.expect.minShortlist) {
        return {
          id: kase.id,
          intent: kase.intent,
          shortlist,
          rankedBy,
          scores: [],
          hardFailure:
            `expected at least ${kase.expect.minShortlist} results, got ${shortlist.length}` +
            (errors.length ? ` (errors: ${errors.map((e) => e.message).join('; ')})` : ''),
        }
      }

      const scores = deterministicScores(shortlist)

      const judge = MODE === 'agent' ? readJudgeConfig() : undefined
      if (judge) {
        scores.push(...(await groundednessScores(shortlist, judge)))
      }

      annotate({
        [semconv.CAR_RANKED_BY]: rankedBy,
        [semconv.CAR_SHORTLIST_SIZE]: shortlist.length,
        'eval.mean_score': mean(scores),
      })
      setOutput(
        shortlist.map((r) => ({ id: r.listing.id, score: r.score, rationale: r.rationale })),
      )

      // One span per score, so both backends can chart a criterion over time
      // rather than only a single pass/fail per run.
      for (const score of scores) {
        await withSpan(
          `score:${score.name}`,
          {
            kind: Kind.Evaluator,
            observation: 'event',
            attributes: {
              'eval.case': kase.id,
              'eval.score.name': score.name,
              'eval.score.value': score.value,
              ...(score.comment ? { 'eval.score.comment': score.comment } : {}),
            },
          },
          async () => undefined,
        )
      }

      return { id: kase.id, intent: kase.intent, shortlist, rankedBy, scores }
    },
  )
}

const mean = (scores: Score[]): number =>
  scores.length === 0 ? 0 : scores.reduce((a, s) => a + s.value, 0) / scores.length

// ---------------------------------------------------------------------------

const health = await fetch(`${API}/api/health`).then((r) => r.json() as Promise<Record<string, any>>)
console.log(
  `eval · mode=${MODE} · driver=${health.driver} · tracing=${health.tracing?.backend ?? 'none'} · ` +
    `threshold=${THRESHOLD}`,
)
if (MODE === 'agent' && !health.agentAvailable) {
  console.error('EVAL_MODE=agent but the API reports no agent driver — set AGENT_API_KEY')
  process.exit(1)
}
const judgeCfg = MODE === 'agent' ? readJudgeConfig() : undefined
console.log(judgeCfg ? `judge · ${judgeCfg.provider} / ${judgeCfg.model}\n` : 'judge · skipped\n')

const results: CaseResult[] = []
for (const kase of CASES) {
  process.stdout.write(`  ${kase.id} … `)
  const result = await runCase(kase)
  results.push(result)
  console.log(
    result.hardFailure
      ? 'FAILED'
      : `${result.shortlist.length} results, ranked by ${result.rankedBy}, mean ${mean(result.scores).toFixed(2)}`,
  )
}

console.log('\n--- scores ---')
const failures: string[] = []

for (const result of results) {
  console.log(`\n${result.id} — ${result.intent}`)
  if (result.hardFailure) {
    console.log(`  HARD FAILURE: ${result.hardFailure}`)
    failures.push(`${result.id}: ${result.hardFailure}`)
    continue
  }
  for (const score of result.scores) {
    const flag = score.value < THRESHOLD ? 'FAIL' : score.value < 1 ? 'warn' : '  ok'
    console.log(
      `  [${flag}] ${score.name.padEnd(28)} ${score.value.toFixed(2)}` +
        (score.comment ? `  — ${score.comment}` : ''),
    )
    if (score.value < THRESHOLD) failures.push(`${result.id}/${score.name}=${score.value.toFixed(2)}`)
  }
}

// Load-bearing: this process exits inside the exporter's batch window, so
// without an explicit flush a green run reports having sent telemetry it never
// sent.
await flushTracing()

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\neval passed')
