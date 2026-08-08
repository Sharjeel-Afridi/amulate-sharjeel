# Tasks

Ordered. `[x]` done · `[~]` in progress · `[ ]` not started.

## Phase 0 — Foundation (h0–1)
- [x] Repo scaffold, workspaces, TS base config
- [x] Spec, plan, task breakdown
- [x] Workspace packages: `shared`, `catalog`, `mcp-marketplace`
- [ ] `.env.example`, `api` and `web` skeletons

## Phase 1 — Marketplace (h1–3)
- [x] Domain types in `packages/shared`
- [x] Deterministic catalog generator — 400 listings / 10 categories / 10 brands, both modes
- [x] SVG car-art generator (category silhouette + brand-hashed hue)
- [x] Catalogue verification gate (`npm run verify -w @car/catalog`)
- [x] MCP server with `search_listings`, `get_listing`, `check_availability`
- [x] MCP Apps: predeclared `ui://` booking form and checkout, `_meta.ui.resourceUri` on tools
- [x] Booking round-trip: `start_booking` → `submit_booking` → `start_checkout` → `confirm_payment`
- [x] End-to-end MCP client smoke test (`npm run smoke -w @car/mcp-marketplace`)

## Phase 2 — Walking skeleton (h3–5)
- [x] Verify `@a2ui/react` + `@mcp-ui/client` APIs before building on them
- [x] SEP-1865 JSON-RPC guest bridge (`packages/shared/src/mcp-app-protocol.ts`)
- [x] React 19 web workspace, Vite, dark showroom skin
- [x] Three-zone cockpit shell rendering, verified in browser
- [ ] MCP Apps host bridge (host half of the JSON-RPC contract)
- [ ] Express API + SSE stream
- [ ] `AgentDriver` interface + scripted driver
- [ ] A2UI renderer wired; one surface renders end to end
- [ ] **Gate: browser → driver → MCP → A2UI → pixels**

## Phase 3 — Interview (h5–8)
- [ ] `SessionState` + phase machine
- [ ] `update_preferences` / `set_phase` tools
- [ ] Journey rail surface, live JSON-Pointer patches
- [ ] Quick-reply chips
- [ ] Rent vs buy branching

## Phase 4 — Research and ranking (h8–12)
- [ ] Ranking function (separate rent and buy scoring)
- [ ] Per-listing rationale generation
- [ ] Custom A2UI catalog (`CarCard`, `MatchScore`, `PriceBadge`, `ReasoningStep`)
- [ ] Stage surface: searching → catalogue
- [ ] Reasoning chips in chat
- [ ] Agent-authored comparison view

## Phase 5 — MCP Apps (h12–15)
- [ ] `ui://` booking form, themed, live price recalculation
- [ ] `submit_booking` round-trip
- [ ] `ui://` mock checkout with prominent mock labelling
- [ ] `confirm_payment` + confirmation state
- [ ] MCP App badge in chat

## Phase 6 — Polish (h15–18)
- [ ] Dark showroom skin
- [ ] Motion: stagger, counters, phase transitions, preference flash
- [ ] Responsive breakpoints
- [ ] Empty / loading / error states

## Phase 7 — Ship (h18–20)
- [ ] Dockerfiles + `docker compose up`
- [ ] README with run instructions
- [ ] Full end-to-end rehearsal

## Phase 8 — Stretch (h20–24)
- [ ] Langfuse + OpenTelemetry tracing
- [ ] Slide deck
- [ ] Video demo
