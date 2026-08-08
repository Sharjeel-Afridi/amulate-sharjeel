# Technical plan

## Services

Three processes, orchestrated by `docker compose`.

```
web (React + Vite)              api (Express + Claude Agent SDK)      mcp-marketplace
├─ chat composer                ├─ agent loop / phase machine         ├─ search_listings
├─ A2UI renderer      ◀── SSE ──┤ SessionState (source of truth)  ─────┤ get_listing
├─ MCP Apps host                └─ iframe tool-call proxy         MCP  ├─ ui:// booking-form
└─ journey rail                                                        └─ ui:// checkout
     :5173                              :8080                              :8081
```

- `web` never talks to `mcp-marketplace` directly. Tool calls originating in an
  MCP App iframe are proxied through `api`, which holds the MCP client session.
  That keeps every tool call auditable in one place.
- `mcp-marketplace` is a real, independently addressable MCP server over
  streamable HTTP — inspectable with MCP Inspector during the demo.

## Agent

`@anthropic-ai/claude-agent-sdk`. A phase machine (`interview → research →
recommend → book`) enforced by system prompt plus a `SessionState` the agent
reads and writes through tools. Phase transitions are explicit tool calls, so
they are traceable and can drive the UI.

### Tools

| Tool | Source | Purpose |
|---|---|---|
| `search_listings` | MCP | query mock marketplace by mode/category/budget/dates |
| `get_listing` | MCP | full detail for one listing |
| `check_availability` | MCP | rental date-window availability |
| `start_booking` | MCP | returns booking-form **MCP App** |
| `submit_booking` | MCP | validate + persist booking |
| `start_checkout` | MCP | returns mock-payment **MCP App** |
| `confirm_payment` | MCP | mock settle, return confirmation |
| `update_preferences` | api | patch SessionState, emits A2UI data-model patch |
| `set_phase` | api | advance the phase machine |
| `present_results` | api | push ranked shortlist + rationales to the stage surface |
| `compare_listings` | api | agent-authored A2UI comparison view |

## UI protocol split

**A2UI** — surfaces that change every turn:

| Surface | Content |
|---|---|
| `journey` | phase stepper + captured preferences, patched live |
| `stage` | catalogue grid / comparison / detail |
| progress | inline reasoning chips in the chat stream |

Structured surfaces are emitted by **typed server-side builders** (fast,
deterministic, no token burn). The comparison view is **authored by the agent**
directly from the catalog — proving generative UI without risking the core flow.

A custom catalog `car-matchmaker` extends `BasicCatalog` with `CarCard`,
`MatchScore`, `PriceBadge`, `ReasoningStep`.

**MCP Apps** — server-authored, sandboxed, transactional: booking form and mock
checkout. Predeclared `ui://` resources referenced from tools via
`_meta.ui.resourceUri`, per SEP-1865. Theme tokens are passed into the iframe so
the widgets match the host skin rather than looking bolted on.

## Data

Deterministic seeded generator — 10 categories × 10 brands × 3 variants = 300
listings, each with both rental and purchase representations where sensible.
Car art is generated SVG: ~10 category silhouettes, hue hashed from brand name.
No network dependency, no licensing question.

## Design

Dark showroom: near-black canvas, glass on elevated surfaces only, one
saturated accent. Three-zone cockpit at ≥1280px; journey rail collapses to a
pill strip below that; single column with stage-as-sheet below 900px.

## Sequencing

Walking skeleton (browser → agent → MCP tool → A2UI → rendered) by hour 5.
Everything after that deepens something that already runs.
