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

### With a live model

The agent layer is provider-agnostic. Drop a key in `.env`:

```bash
AGENT_PROVIDER=gemini     # gemini | groq | openai | anthropic
AGENT_API_KEY=...
AGENT_MODEL=gemini-2.5-flash
```

Without one, the scripted driver serves a complete, deterministic run — which
also makes it a dependable demo fallback if a live API is throttled.

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

No real dealership integrations and no real payments. The bundled marketplace
holds **400 listings** — 10 categories × 10 brands × both rent and buy —
generated deterministically from a fixed seed, so every run and every reviewer
sees identical data.

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
