# AI Car Matchmaker

A multistep AI agent that helps you rent or buy a car. It interviews you
conversationally, turns your answers into a spec, researches a marketplace on
your behalf, and returns ranked suggestions where **every result explains why it
placed where it did** — then handles booking and mock checkout without leaving
the chat.

Built for the Amulate hackathon.

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

### Scripted mode and agent mode

**There is a toggle in the top bar.** Both drivers are loaded at boot and each
session picks one, so switching is a click — mid-conversation is fine, and
everything gathered so far carries across. If a free-tier provider starts
throttling in the middle of a demo, that is the recovery: no restart, no lost
state.

Flipping to **Scripted** also turns on a guided highlight: every control the
deterministic driver handles gets a ring, including the primary button inside
the booking widget's sandboxed iframe. Whoever is presenting can see the path
without having read `scripted-driver.ts`. Typing still works in scripted mode,
but it is pattern-matched rather than understood, so the highlighted controls
are the reliable route.

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

Both drivers implement the same `AgentDriver` interface, call the same MCP
tools, mutate the same session state and emit the same A2UI surfaces — only the
choice of what to say next differs. A missing key **falls back rather than
failing**: an app that boots and works beats one that refuses to start over an
optional key.

Scripted mode is not only a stand-in. It is the demo fallback — one click gives
an instant, complete, repeatable run, and `npm run smoke -w @car/api` pins
itself to it so the test never spends a rate-limited quota.

---

## What it does

1. **Interviews you** — eleven questions, asked one at a time, each rendered
   with the right control inline in the chat (chips, slider, date picker,
   multi-select). Free text is accepted at any point and overrides the controls.
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

---

## Architecture

```
web (React 19 + Vite)          api (Express)                     mcp-marketplace
├─ chat + composer             ├─ agent loop / phase machine     ├─ search_listings
├─ A2UI renderer      ◀─ SSE ──┤ SessionState (source of truth)  ├─ get_listing
├─ MCP Apps host               └─ iframe tool-call proxy    MCP ─┤ check_availability
└─ journey rail                                                  ├─ ui:// booking-form
     :5173                            :8080                      └─ ui:// checkout
                                                                       :8081
```

### The two UI protocols

Each is used for what it is actually good at.

**[A2UI](https://a2ui.org)** drives the surfaces that change every turn — the
journey rail, the interview controls, the ranked catalogue. Declarative JSON
streamed from the agent, rendered as native components. Structured surfaces come
from typed server-side builders; the model authors only where the layout genuinely
depends on the content.

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
a snapshot of **45 real scraped offers** from sixt.com — real models, real day
rates, real photographs — each exposed as both a rental and a purchase, giving
**90 listings across 7 categories and 10 brands**. It is served from a fixed
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

## Repository layout

```
apps/
  web/              React 19 — chat, A2UI renderer, MCP Apps host
  api/              Express — agent loop, session state, SSE, tool proxy
  mcp-marketplace/  MCP server — listing tools and ui:// MCP Apps
packages/
  shared/           domain types, criteria model, MCP Apps wire contract
  catalog/          deterministic marketplace generator and car art
  ranking/          per-mode scoring and criterion-citing rationales
specs/              spec-driven development artefacts
```

## Documentation

- [`specs/spec.md`](specs/spec.md) — requirements and acceptance criteria
- [`specs/plan.md`](specs/plan.md) — technical plan
- [`specs/tasks.md`](specs/tasks.md) — task breakdown
- [`specs/3d-visualisation-plan.md`](specs/3d-visualisation-plan.md) — assessment of
  3D car rendering, and why the 2D art was upgraded instead

## Licence

MIT
