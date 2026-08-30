# AI Car Matchmaker

A multistep AI agent that helps you rent or buy a car. It interviews you
conversationally, turns your answers into a spec, researches a marketplace on
your behalf, and returns ranked suggestions where **every result explains why it
placed where it did** — then handles booking and mock checkout without leaving
the chat.

Built for the Amulate hackathon.

<img width="1512" height="873" alt="Screenshot 2026-08-10 at 12 59 40 AM" src="https://github.com/user-attachments/assets/c1be30c1-cc16-4dfa-a531-b471cfbfcae2" />


---

## Running it

### Docker

```bash
docker compose up
```

Open **http://localhost:5173**. Nothing else is required — no API key, no
network access. The bundled scripted driver runs the complete journey.

### Local development

Requires Node 22+.

```bash
npm install
npm run dev
```

That starts all three services: the MCP marketplace on `:8081`, the API on
`:8080`, and the web app on `:5173`.

### The landing intro

The first thing you see is a parked BMW M4 in WebGL, one instruction and one
key. **Hold ↑** — or press and hold the on-screen control — and the car pulls
away; the moment it actually moves the cockpit crossfades in over the top.
**Space** revs it in neutral, there is a live HUD on the telemetry, engine audio
you can mute, and a **Skip intro** button for anyone who would rather not.
Nothing per-frame touches React state — the scene drives the HUD, the launch
ring and the audio through refs and direct DOM writes.

It is decoration, so **every reason to skip it wins**: `prefers-reduced-motion`,
no WebGL, or having already seen it in this tab. `?intro=0` skips it outright and
`?intro=1` forces a replay for a demo. Once the handover ends the component
unmounts and takes its WebGL and audio contexts with it, so it costs nothing for
the rest of the session. The cockpit renders from the first frame regardless —
it opens the session and the SSE stream while the intro is still on screen, so
the agent has already said hello by the time anyone sees it.


### Scripted mode and agent mode

**The toggle is pinned to the footer of the *Your spec* drawer**, open from the
top bar. Both drivers are loaded at boot and each session picks one, so
switching is a click — mid-conversation is fine, and everything gathered so far
carries across. If a free-tier provider starts throttling in the middle of a
demo, that is the recovery: no restart, no lost state.

Flipping to **Scripted** also turns on a guided highlight: every control the
deterministic driver handles gets a ring, including the primary button inside
the booking widget's sandboxed iframe. Whoever is presenting can see the path
without having read `drivers/scripted.ts`. The banner that announces scripted
mode links straight to the switch, so the recovery is never something you have
to go looking for. Typing still works in scripted mode, but it is
pattern-matched rather than understood, so the highlighted controls are the
reliable route.

The environment sets the **default** a new session starts in:

| `.env` | Default driver | Toggle |
|---|---|---|
| *(nothing set)* | **Scripted** — no model, no key, no network | Agent disabled |
| `AGENT_API_KEY=…` | **Agent** — the model chooses questions and tools | Both available |
| `AGENT_API_KEY=…` + `AGENT_MODE=scripted` | **Scripted** | Both available |

`GET /api/health` reports `defaultMode` and `agentAvailable`;
`POST /api/session/:id/mode` takes `{"mode":"scripted"|"agent"}` and 409s if the
agent driver was never configured.

```bash
AGENT_PROVIDER=gemini              # gemini | groq | openai
AGENT_API_KEY=...
AGENT_MODEL=gemini-2.5-flash       # groq: llama-3.3-70b-versatile
```

Provider-agnostic: the harness is the **OpenAI Agents SDK**, which talks to any
OpenAI-compatible endpoint, so Gemini and Groq free tiers work by changing a
base URL. Set `AGENT_BASE_URL` for anything else.

Both drivers implement the same `Driver` interface and run the same
`flow/` pipeline — same MCP tools, same session state, same A2UI surfaces. A
driver answers exactly one question: what to do with a message the user *typed*.
Every tapped control is handled identically for both by `drivers/index.ts`. A missing key **falls back rather than
failing**: an app that boots and works beats one that refuses to start over an
optional key.

Scripted mode is not only a stand-in. It is the demo fallback — one click gives
an instant, complete, repeatable run, and `npm run smoke -w @car/api` pins
itself to it so the test never spends a rate-limited quota.

---

## What it does

1. **Interviews you** — eleven questions laid out as one wide two-column form,
   each with the control the answer deserves (chips, slider, date picker,
   multi-select). The whole spec is visible and editable at once rather than
   arriving a question at a time. Free text is accepted at any point and
   overrides the controls.
2. **Builds a spec** — your answers become checkable criteria, shown back for
   approval. Nothing is searched until you confirm.
3. **Screens and ranks** — hard criteria decide *whether* a car qualifies, soft
   preferences decide *where* it places. Cars ruled out are kept with the reason.
4. **Explains itself** — every card cites a criterion you actually stated and the
   value that earned the position.
5. **Books and pays** — both flows render in the chat as MCP Apps.

### Inclusion, exclusion, preference

Three tiers, not two:

| Kind | Effect |
|---|---|
| **Exclusion** | A dealbreaker. Fails the car outright, however well it scores. |
| **Requirement** | Must be satisfied to qualify. |
| **Preference** | Never disqualifies; drives ranking among cars that qualified. |

Preferring petrol is not the same as excluding diesel — only the dealbreaker
question creates exclusions. When a dealbreaker empties the shortlist the agent
reports which one and by how much, rather than silently returning less.

A requirement is as absolute as a dealbreaker, so only the pass/fail answers get
one: body style, headcount, a mileage ceiling. Your budget is a *preference*
unless you tick "nothing above my budget" — over-budget cars stay on the list,
below everything that fits, because a bit over is often worth seeing. The luggage
figure is a preference too; it is a number the chips carry, not one you gave.

---

## Architecture

```
web (React 19 + Vite)          api (Express)                     mcp-marketplace
├─ chat + composer             ├─ agent loop / phase machine     ├─ search_listings
├─ A2UI renderer      ◀─ SSE ──┤ SessionState (source of truth)  ├─ get_listing
├─ MCP Apps host               └─ iframe tool-call proxy    MCP ─┤ check_availability
└─ journey bar + spec drawer                                     ├─ ui:// booking-form
     :5173                            :8080                      └─ ui:// checkout
                                                                       :8081
```

### How a search flows

Everything the API does to answer a search lives in `apps/api/src/flow/`, one
file per step, in the order they run:

```
preferences ──► criteria.ts ──► search.ts ──► rank.ts ──► present.ts
 (the only        buildCriteria    marketplace   scorer,       surfaces
  spec state)     (pure, derived)  + screen      then model     + copy
                                       │             │
                                       │             └─ model unavailable, throttled,
                                       │                slow or unparseable
                                       │                     └──► scorer's order stands
                                       └─ nothing qualified ──► nearMisses()
```

`flow/index.ts` is the whole pipeline in one readable function. Two rules keep it
followable:

- **Criteria are derived, never stored-and-edited.** `buildCriteria(prefs)` is
  pure and idempotent, called by the search itself. There is no path where a
  preference is recorded but the criterion it implies is not applied.
- **One place branches on the model.** `flow/rank.ts` is the only file that knows
  the model can fail. `agents/ranker.ts` reorders a list or returns `undefined`;
  it never picks a fallback, never sets `rankedBy`, never trims the shortlist.
  The scorer runs on *every* path — it supplies the factor trace the detail view
  expands, and its order is the answer when the model does not have one.

`rankedBy` is recorded on the trace, because the degradation is invisible in the
product: the user still gets eight ranked cars with rationales either way.

### The two UI protocols

Each is used for what it is actually good at.

**[A2UI](https://a2ui.org)** drives the surfaces that change every turn — the
interview form, the editable spec sheet, the ranked catalogue. Declarative JSON
streamed from the agent, rendered as native components. Structured surfaces come
from typed server-side builders; the model authors only where the layout genuinely
depends on the content. The phase stepper is the exception and stays native app
chrome: it is the one thing that must render before any message arrives.

A **custom catalog** (`CarCard`, `MatchScore`, `PriceBadge`, `ReasoningStep`)
merges with the standard component set. A surface resolves exactly one catalog by
id, so custom components ship as one merged catalog rather than as additive
registrations.

**[MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)**
(SEP-1865) drives the transactional widgets — booking form and mock checkout —
as sandboxed iframes rendered inline in the conversation.

Both halves of the bridge are implemented directly against the spec's wire
contract (`ui/initialize` → `ui/notifications/initialized` → `tools/call`, JSON-RPC
2.0 over postMessage, protocol version `2026-01-26`). `@mcp-ui/client`'s
`AppRenderer` additionally requires a separately hosted sandbox-proxy page, so the
host half lives in `apps/web/src/mcp/`. The contract is in
[`packages/shared/src/mcp-app-protocol.ts`](packages/shared/src/mcp-app-protocol.ts).

Guest messages are validated on window identity rather than origin — a `srcdoc`
iframe has an opaque origin that serialises as the string `"null"` and proves
nothing.

### What the model does and does not do

Deliberately narrow. Ranking is arithmetic, rationale phrasing has a
deterministic fallback, and every structured surface is built server-side:

| Model | Code |
|---|---|
| Extract preferences from free text | Catalogue generation |
| Choose the next question | Search, filtering, constraint relaxation |
| Select tools | Scoring and ranking |
| Phrase replies and rationales | A2UI surface construction |
|  | Car art |
|  | Booking totals (recomputed server-side, never trusting the iframe) |

---

## Marketplace data

No real dealership integrations and no real payments. The bundled marketplace is
a snapshot of **145 real scraped offers** from sixt.com — real models, real day
rates, real photographs — each exposed as both a rental and a purchase, giving
**290 listings across 10 categories and 33 brands**. It is served from a fixed
JSON file, so every run and every reviewer sees identical data.

A generated catalogue is not used any more. Loading real inventory is what makes
the rationales worth reading: "a 2023 BMW 3 Series Touring, 520 L boot" is a
claim about a car that exists. The trade-off is breadth — see
`packages/catalog/src/cars.source.json` for the raw scrape.

Checkout is **entirely mocked**. Card fields are `readonly` with the universal
test number baked in, so a real card cannot be entered. Nothing is processed,
stored or transmitted.

---

## Verification

```bash
npm run verify -w @car/catalog     # catalogue meets the brief's floor
npm run verify -w @car/ranking     # scoring, factor sums, rationale quality
npm run smoke  -w @car/mcp-marketplace   # connects as a real MCP client
npm run smoke  -w @car/api          # drives a full journey over SSE
```

The MCP smoke test is the interesting one: it connects as a genuine MCP client,
lists the tools and `ui://` resources, and exercises the whole booking path.

---

## Observability and evals

Off by default. Set `OTEL_BACKEND` and traces go to Langfuse or Arize Phoenix as
**OTLP protobuf** — the default wire format and the only one collectors are
obliged to accept. The JSON exporter every example reaches for works fine against
a hand-written receiver and gets a flat 415 from Phoenix. Leave `OTEL_BACKEND`
unset and nothing is registered at all — no exporter, no flush loop, no behaviour
change. `GET /api/health` reports which.

```bash
# Langfuse — hosted, nothing to run
OTEL_BACKEND=langfuse LANGFUSE_PUBLIC_KEY=pk-lf-… LANGFUSE_SECRET_KEY=sk-lf-… npm run dev

# Phoenix — local container
docker run -p 6006:6006 arizephoenix/phoenix:latest
OTEL_BACKEND=phoenix npm run dev
```

Spans carry **OpenInference** attributes, the only vocabulary both backends read,
so switching is one environment variable and no code.

A traced turn nests the whole multistep loop:

```
turn: message                                   ← one trace per turn, grouped by session.id
└─ chat turn
   └─ Agent workflow                 tok 5426/136
      └─ Car Matchmaker              [AGENT]
         ├─ mcp.list_tools           [TOOL]
         ├─ turn 1 · Car Matchmaker  tok 2651/104
         │  ├─ generation            [LLM  llama-3.3-70b-versatile]
         │  ├─ record_preferences    [TOOL]  ×3
         │  └─ show_spec             [TOOL]
         └─ turn 2 · Car Matchmaker  tok 2775/32
            └─ generation            [LLM]
```

Two things make this more than a library install. The Agents SDK's spans are
translated by a `TracingProcessor` written for the purpose (`otel/agents-bridge.ts`)
— the OpenInference auto-instrumentation every guide points at is Python-only, and
no JS package covers `@openai/agents`. And because most of this journey is
deliberately *not* model-driven, the deterministic path is instrumented by hand,
so a user who taps through the interview produces a trace rather than a blank.

The attribute worth watching is `car.ranked_by`. The ranker falls back to the
deterministic scorer whenever the model is throttled or unparseable, which is
invisible in the product — the user still gets eight explained cars. It is the
difference between "the explanations felt generic today" and a filterable fact.

### Evals

```bash
npm run eval:judge -w @car/api      # 2 calls: is the judge itself trustworthy?
npm run eval       -w @car/api      # scripted — free, deterministic
EVAL_MODE=agent npm run eval -w @car/api    # grades the model ranker
```

The dataset is whole journeys, not prompts, because that is the unit that ships —
a prompt-level score says nothing about whether the interview reached a spec or
whether screening left anything to rank. Most criteria are deterministic and cost
nothing: specific figures cited, no generic filler, a usable score spread, rank
agreeing with score. One is a model judge, for the only thing a regex cannot
check — whether a rationale asserts a fact the listing does not support.

Run `eval:judge` first. It is two calls, and it caught the judge falsely failing
correct rationales over `$1,500` versus `1500`.

> **Token budget.** One agent turn measured ~5,400 prompt tokens, and Groq's free
> tier allows 100,000 a day — so a full 12-turn agent journey is a meaningful
> slice of the allowance and `EVAL_MODE=agent` is deliberately opt-in. The judge
> takes its own `EVAL_JUDGE_*` credentials: partly to spend a different budget,
> partly because `llama-3.3-70b-versatile` is not on Groq's structured-outputs
> list and cannot be asked for a schema-conformant verdict.

---

## Repository layout

```
apps/
  web/              React 19 — chat, A2UI renderer, MCP Apps host
  api/              Express — agent loop, session state, SSE, tool proxy
  mcp-marketplace/  MCP server — listing tools and ui:// MCP Apps
packages/
  shared/           domain types, criteria model, MCP Apps wire contract
  catalog/          scraped marketplace data, query layer and car art
  ranking/          per-mode scoring and criterion-citing rationales
scripts/            one-off asset tooling (3D model preparation)
specs/              spec-driven development artefacts
```

## Documentation

- [`specs/spec.md`](specs/spec.md) — requirements and acceptance criteria
- [`specs/plan.md`](specs/plan.md) — technical plan
- [`specs/tasks.md`](specs/tasks.md) — task breakdown
- [`specs/3d-visualisation-plan.md`](specs/3d-visualisation-plan.md) — assessment of
  3D car rendering, and why the catalogue's 2D art was upgraded instead. The
  landing intro is where that investigation did land.
- [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — redistributed assets and
  vendored code, with their terms
- [`HANDOFF.md`](HANDOFF.md) — running notes on state and open threads

## Licence

MIT — for the code in this repository.

Some redistributed assets are not: the landing intro's car model is CC BY 4.0 and
requires attribution wherever it is shown, and three.js and the Draco decoder are
vendored under their own licences. All of it is recorded in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also notes that *BMW*
and *M4* are trademarks the CC BY licence grants no rights to — a commercial
launch would swap the model out.
