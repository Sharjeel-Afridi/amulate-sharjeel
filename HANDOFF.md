# Session handoff — AI Car Matchmaker

Paste this into a new session to continue work.

**Repo:** `/Users/sharjeelafridi/Desktop/sharjeel/amulate-sharjeel`
**Elapsed:** ~12h of a 24h hackathon · 23 commits · ~8,000 lines

---

## Ground rules (non-negotiable)

These are also in `CLAUDE.md` at the repo root.

1. **Commit with `git afridi`**, never bare `git commit`. The machine's global git
   user is a *different* account (`Sharjeel-Triomics`). The alias injects
   `Sharjeel-Afridi` / `afridisharjeel8@gmail.com` and the correct SSH key.
   Local repo config mirrors it as a safety net, but use the alias.
2. **Never add a `Co-Authored-By: Claude` trailer** or any AI attribution.
3. **Commit messages: one line, imperative, lowercase, no trailing period.**
   Good: `add mock marketplace catalog`. Bad: multi-paragraph conventional commits.
4. Nothing has been pushed to `origin` yet — ask before pushing.

---

## What this is

Amulate hackathon. A multistep AI agent that helps someone rent or buy a car:
interviews them, turns answers into a spec, researches a mock marketplace, and
returns ranked results where **every card cites a criterion the user actually
stated**. Booking and mock checkout happen in-chat as MCP Apps.

The brief mandates three things that must coexist: a **multistep agent harness**,
**MCP Apps** (form-fill + payment, rendered in chat), and **A2UI** (catalogue +
live agent progress, "not static HTML"). Plus Docker, public repo, README, slide
deck, video, and spec-driven development.

---

## Architecture

```
web (React 19 + Vite)        api (Express)                    mcp-marketplace
├─ journey bar               ├─ agent loop / phase machine    ├─ search_listings
├─ chat + composer   ◀─SSE──┤ SessionState (source of truth) ├─ get_listing
├─ MCP Apps host             └─ iframe tool-call proxy   MCP ─┤ check_availability
└─ stage (A2UI)                                               ├─ ui:// booking-form
   :5173                          :8080                       └─ ui:// checkout
                                                                    :8081
```

**Layout:** a journey bar (brand · phase stepper · live spec chips) over two
columns — conversation and stage. The stage tabs between the ranked matches and
the spec sheet. There is no left rail: it cost ~270px to show four dots, and the
conversation needs that width for the booking widget.

**Workspaces:** `packages/{shared,catalog,ranking}`, `apps/{web,api,mcp-marketplace}`.
TypeScript everywhere, ESM, Node 22+, `tsx` runs servers directly (no build step).

**Protocol split:** A2UI drives per-turn surfaces (journey rail, interview
controls, catalogue). MCP Apps drive transactional widgets (booking, checkout).

**What the model does vs what code does** — deliberately narrow:
- Model: extract preferences, choose next question, pick tools, phrase replies
- Code: catalogue generation, search, screening, **scoring and ranking**, all
  structured A2UI surfaces, car art, booking totals

That split is why a free-tier model is sufficient.

---

## State: done and verified

| | |
|---|---|
| 45 real scraped Sixt offers → 90 listings, 7 categories, 10 brands, rent+buy | ⚠️ below the brief's mock-marketplace floor — see below |
| Search with progressive constraint relaxation | ✅ |
| Generated SVG car art (bezier, gradients, alloys, curated palette) | ✅ |
| MCP server, 7 tools, streamable HTTP | ✅ |
| MCP Apps: predeclared `ui://`, `text/html;profile=mcp-app`, `_meta.ui.resourceUri` | ✅ |
| SEP-1865 JSON-RPC bridge, **both halves hand-written** | ✅ |
| Ranking engine, separate rent/buy scoring, criterion-citing rationales | ✅ |
| Criteria model: exclusion / requirement / preference | ✅ |
| 11-question interview with spec-confirmation gate | ✅ |
| Journey bar + two-column cockpit, dark showroom skin, game car-select cards | ✅ |
| A2UI custom catalog (CarCard, MatchScore, PriceBadge, ReasoningStep, SpecRow) | ✅ |
| Booking as one four-step MCP App: period → extras → driver → payment → receipt | ✅ |
| Results split into a leading three, a compact tail, and a per-car detail view | ✅ |
| Docker: 3 services, `docker compose up`, verified end to end | ✅ |
| README, `.env.example`, specs | ✅ |
| Agent mode switch (scripted ↔ real model) | ✅ |
| LLM driver on OpenAI Agents SDK, provider-agnostic | ✅ works, see caveat |

## Not done

- **Slide deck** — hard requirement, not started
- **Video demo** — hard requirement, not started
- **Ruled-out cars UI** — data is captured in `state.ruledOut` with per-criterion
  verdicts and evidence; the panel to display them isn't built
- Langfuse/OTel observability (bonus, likely cut)

The per-car scoring breakdown is now built: selecting a card opens a detail view
with the full specification and every `ScoreFactor` signed and explained.

---

## Hard-won gotchas — do not rediscover these

**A2UI (`@a2ui/react` 0.10.2 + `@a2ui/web_core`)**
- Requires **React 19** (`^19.2.7`), not 18.
- Import from versioned subpaths: `@a2ui/react/v0_9`, `@a2ui/web_core/v0_9`.
  The bare root is v0.8 legacy.
- A surface resolves **exactly one catalog** by exact id match. Custom components
  are NOT additive — they ship as one merged catalog under a new id
  (`CAR_CATALOG_ID` = `https://car-matchmaker.local/catalogs/v1.json`).
- **`createSurface` throws if the surface already exists.** Create once on stream
  connect; everything after is `updateComponents` / `updateDataModel`.
- **The root component id must literally be `"root"`.**
- Templated children use `{componentId, path}`; bindings inside are **relative
  with no `./` prefix** (`{path: 'title'}`, not `{path: './title'}`).
- Basic-catalog schemas are `.strict()` — one extra property throws.
- **Value changes (ChoicePicker/Slider/TextField) do NOT emit actions.** They
  write straight to the data model. The host subscribes to the data model as a
  second channel. Only `Button` fires actions.
- **The library ships broken CSS modules** — its own styling never arrives.
  Controls are styled from raw elements scoped under `.a2ui-host` in
  `apps/web/src/a2ui/a2ui.css`.

**MCP Apps**
- `@mcp-ui/client` v7 exports **`AppRenderer`**, not `UIResourceRenderer`, and it
  is a different contract (JSON-RPC over AppBridge). It also **requires a
  separately hosted sandbox-proxy page** that nobody ships — which is why both
  halves of the bridge are hand-written here.
- `@mcp-ui/server` 6.1.0 pins `ext-apps@^0.3.1` while `@mcp-ui/client` 7.1.1 uses
  `1.7.5`. Two copies are installed. Works, but be aware.
- **The guest opens the handshake**, not the host: guest → `ui/initialize` →
  host replies → guest → `ui/notifications/initialized`.
- A `srcdoc` iframe has an **opaque origin that serialises as the string
  `"null"`** — validate `event.source === iframe.contentWindow`, never origin.
- `body { background: transparent }` in a srcdoc iframe falls back to **white**.
  Must set an explicit background.
- Contract lives in `packages/shared/src/mcp-app-protocol.ts`. Protocol version
  `2026-01-26`.
- **Report size from `document.body`, never `document.documentElement`.** The
  root box is sized against the iframe viewport, which the host has just set
  from the previous report — so the measurement can only ever grow. Harmless on
  a single-page widget, very visible on one with steps.
- **A sandboxed `srcdoc` iframe cannot be driven by a test harness or devtools**
  — the opaque origin is the point, but it means no clicks can be dispatched
  into it. `npm run preview -w @car/mcp-marketplace` renders each widget to
  `apps/web/public/__widget-*.html` (git-ignored) with `callTool` stubbed, so
  the flow can be walked at `http://localhost:5173/__widget-rent.html`.

**Agent / providers**
- **`.env` needs an explicit loader.** ESM hoists imports, so `loadEnv()` at the
  top of `index.ts` still runs *after* imported modules capture `process.env`.
  Hence `apps/api/src/main.ts` — load, then `await import('./index.js')`.
- **`z.object({})` is an invalid tool schema** — emits `required` with no
  `properties`; Groq rejects it. Use the `NO_ARGS` stand-in.
- **Strict tool validation requires every property present.** A wide object
  schema gets rejected wholesale when a smaller model omits one field. Tools that
  take many optional values should take **one fact per call** instead
  (see `record_preferences`).
- Tool results must be **directive, not descriptive** — "Now STOP calling tools
  and reply with X" rather than "you may now ask". Descriptive results cause
  `Max turns exceeded` loops.
- **Gemini free tier: `gemini-2.5-flash` = 5 req/min**, which one agent turn
  exceeds. Use `gemini-2.5-flash-lite`. Groq is better (30/min) but still
  throttles under automated bursts.
- `setTracingDisabled(true)` — otherwise every turn logs a missing-OpenAI-key
  warning irrelevant to your provider.

**Other**
- Bash working directory drifts between calls — always `cd` to the repo root.
- Stale node processes hold ports and answer with old config. `pkill -9 -f "@car/api"`
  plus `lsof -ti:8080 | xargs kill -9` before restarting, or you will debug a
  process that no longer matches your code.
- Docker Desktop is installed but the CLI is not on PATH:
  `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`.
  Start it with `open -a Docker` and wait for the daemon.
- `NaN` serialises to `null` in JSON — a smoke test that only checks shape will
  pass with broken scores. Assert values.
- There is a `.claude/launch.json` in the **parent** directory
  (`Desktop/sharjeel`) for a different project; `preview_start` picks it up.
  Start vite manually instead.

---

## Running it

```bash
# Docker (verified working)
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker compose up          # then open http://localhost:5173

# Local dev
npm install
npm run dev                # all three services
```

## Verification

```bash
npm run verify -w @car/catalog          # shape, price sanity, search behaviour (NOT the brief's floor)
npm run verify -w @car/ranking          # scoring, factor sums, rationale quality
npm run smoke  -w @car/mcp-marketplace  # connects as a real MCP client
npm run smoke  -w @car/api              # full journey over SSE
```

All four pass. Six tsconfigs typecheck clean.

## Agent switch

`.env` at repo root (already has a working Groq key):

| Setting | Effect |
|---|---|
| nothing set | scripted driver |
| `AGENT_API_KEY=…` | model-backed agent |
| `+ AGENT_MODE=scripted` | forced scripted |

Currently `AGENT_PROVIDER=groq`, `AGENT_MODEL=llama-3.3-70b-versatile`.
`/api/health` reports which driver is live.

**Verified working**: from one sentence the agent extracted mode, category,
useCase, budgetMax and seatsMin via five tool calls, then asked the next
unanswered question. Free-tier throttling is the only limitation — fine at human
typing speed, fails under automated bursts.

---

## Key decisions and why

- **Mock marketplace, not real APIs** — explicitly allowed, demos reliably.
- **Both bridge halves hand-written** — `AppRenderer` needs a sandbox proxy page
  that doesn't exist. Server side is fully spec-correct either way.
- **Ranking is code, not model** — deterministic, testable, and keeps cost at
  ~$0.30/journey.
- **Scripted driver is permanent**, not a stopgap. It is the demo fallback if a
  provider throttles mid-presentation.
- **2D car art, not 3D** — cards render at ~124px tall; no 3D detail is
  perceptible. Full assessment in `specs/3d-visualisation-plan.md`. The SVGs were
  bad for fixable 2D reasons (straight segments, flat fill, hash-modulo colour),
  now fixed.
- **Real car photos deferred** — model-specific imagery is entirely commercial
  (imagin.studio et al. need commercial agreements). Generic stock would make all
  SUVs identical, a regression. User may supply photos; a pipeline was scoped
  (resize to 800×450 WebP, ~50KB each, SVG fallback for missing) but not built.

---

## Recommended next steps

1. **Slide deck** and **video** — the only two hard requirements not started.
   Record the video in `AGENT_MODE=scripted`; a demo must not depend on a
   free-tier quota holding for three minutes.
2. Ruled-out cars panel + per-card criteria evidence (data already exists).
3. Click the checkout half through in a browser.
4. Push to `origin` (ask first).

## Open questions for the user

- Accent colour: currently acid lime (`--accent` in `apps/web/src/styles.css`,
  one line to change).
- Whether to switch the market to INR/India (~45 min) — they write in ₹ but the
  catalogue is € and German cities.
