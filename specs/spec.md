# Spec — AI Car Matchmaker

**Status:** draft · **Owner:** Sharjeel Afridi · **Target:** Amulate hackathon (24h)

## Problem

People shopping for a car — to rent or to buy — don't know what to search for.
They know their situation ("weekend trips, two kids, about €400 a month"), not
their spec. Marketplaces demand the spec up front and then return an unranked
wall of listings with no explanation of fit.

## Solution

A multistep agent that runs the whole journey in one conversation: it
**interviews** the user to turn a situation into a spec, **researches** a
marketplace on their behalf, returns **ranked suggestions each carrying the
agent's reasoning**, and completes **booking and payment inline** without
leaving the chat.

## User scenarios

### S1 — Rental, vague starting point
A user says they need a car for weekend family trips at around €400/month.
The agent asks only what it still needs (boot space, dates), searches, and
returns 8 ranked SUVs. Each card explains *why* it ranked there. The user books
the top pick and pays — all in the chat.

### S2 — Purchase, precise starting point
A user states category, budget and target date up front. The agent skips
questions it already has answers to, moves straight to research, and returns
purchase listings with mileage, year and dealer.

### S3 — Mid-course correction
Halfway through results the user raises their budget. The agent updates state,
re-ranks, and the catalogue updates in place — without restarting the interview.

## Functional requirements

### FR1 — Interview
- Conversational preference elicitation inside the app UI.
- Captures: `mode` (rent|buy), `useCase`, `category`, `budget`, `targetDate`,
  plus mode-specific fields (rental window; purchase mileage/year tolerance).
- Asks only for missing fields; never re-asks what the user already stated.
- Offers quick-reply chips so the interview is fast, not an interrogation.

### FR2 — Research
- Searches a mock marketplace of **≥300 listings**, **10 categories**,
  **≥10 brands per category**, covering both rental and purchase.
- Filters against captured preferences; surfaces near-misses when strict
  filtering returns too few results.

### FR3 — Ranked recommendations
- Returns an ordered shortlist with a numeric match score per listing.
- **Every listing carries a one-line, listing-specific rationale** from the
  agent. Generic filler ("great choice") does not satisfy this.
- The user can request a side-by-side comparison of any subset.

### FR4 — Booking and payment (MCP Apps — mandatory)
- Booking form renders as an MCP App inside the chat.
- Mock checkout renders as an MCP App inside the chat.
- Both are sandboxed iframes communicating over the MCP Apps postMessage bridge.
- **No real payment processing.** The mock must be visibly labelled in the UI.

### FR5 — Generative UI (A2UI — mandatory)
- Car catalogue, comparison view, journey/interview state and live agent
  progress all render via A2UI messages, not hand-written HTML.
- Preference updates propagate through `updateDataModel` JSON-Pointer patches
  so the journey rail updates live as the agent learns.

### FR6 — State
- Session state persists across interview → research → recommend → book.
- State is the single source of truth shared by the agent and the UI.

## Acceptance criteria

| # | Criterion |
|---|---|
| A1 | From a cold start, a vague rental request reaches a ranked catalogue in ≤4 turns |
| A2 | Every card in the catalogue shows a rationale referencing that specific listing |
| A3 | Booking form and checkout both render as sandboxed MCP App iframes in-chat |
| A4 | Catalogue and journey rail are driven by A2UI messages (verifiable on the wire) |
| A5 | Changing budget mid-session re-ranks without restarting the interview |
| A6 | Purchase and rental return structurally different fields and rankings |
| A7 | `docker compose up` yields a working app with no host dependencies beyond Docker |
| A8 | Catalogue contains ≥300 listings, 10 categories, ≥10 brands per category |

## Out of scope

- Real marketplace or dealership integrations (mock only; adapter left pluggable)
- Real payments, real PII collection, accounts, or auth
- BMW Group APIs (none provided)
- Mobile-native clients (responsive web only)

## Risks

| Risk | Mitigation |
|---|---|
| A2UI is young (v0.9/v1.0-rc); renderer API may shift | Pin exact versions; keep our own catalog definition thin |
| `@mcp-ui/client` v7 API differs from v5 experience | Verify renderer export name on install before building on it |
| 24h budget vs four subsystems | Walking skeleton end-to-end by hour 5; deepen after |
| Agent-authored UI is slow/unreliable | Typed server-side A2UI builders for structured surfaces; agent authors only the comparison view |
