# AI Car Matchmaker

A multistep AI agent that helps you rent or buy a car. It interviews you
conversationally, researches a marketplace on your behalf, and returns ranked
suggestions where **every result explains why it ranked there** — then handles
booking and checkout without leaving the chat.

Built for the Amulate hackathon.

> **Status:** in development.

## What makes it different

Two generative-UI protocols, each used for what it is actually good at:

- **[A2UI](https://a2ui.org)** drives the surfaces that change every turn — the
  journey rail, live agent progress, the car catalogue, the comparison view.
  Declarative JSON from the agent, rendered as native components. No static HTML.
- **[MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)**
  (SEP-1865) drives the transactional widgets — the booking form and the mock
  checkout — as sandboxed iframes rendered inline in the conversation.

## Architecture

```
web (React + Vite)              api (Express + Claude Agent SDK)      mcp-marketplace
├─ chat composer                ├─ agent loop / phase machine         ├─ search_listings
├─ A2UI renderer      ◀── SSE ──┤ SessionState (source of truth)  ─────┤ get_listing
├─ MCP Apps host                └─ iframe tool-call proxy         MCP  ├─ ui:// booking-form
└─ journey rail                                                        └─ ui:// checkout
     :5173                              :8080                              :8081
```

## Running it

### Docker

```bash
docker compose up
```

Then open http://localhost:5173.

### Local development

Requires Node 22+.

```bash
npm install
cp .env.example .env    # add ANTHROPIC_API_KEY
npm run dev
```

## Marketplace data

No real marketplace integrations and no real payments. The bundled mock
marketplace holds 300 listings across 10 categories with 10+ brands each,
covering both rental and purchase. Data is generated deterministically from a
fixed seed, so every run and every reviewer sees the same catalogue.

The checkout flow is **entirely mocked** and labelled as such in the UI. No card
details are processed, stored, or transmitted.

## Documentation

- [`specs/spec.md`](specs/spec.md) — requirements and acceptance criteria
- [`specs/plan.md`](specs/plan.md) — technical plan
- [`specs/tasks.md`](specs/tasks.md) — task breakdown

## Licence

MIT
