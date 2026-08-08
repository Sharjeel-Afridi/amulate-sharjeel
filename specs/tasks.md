# Tasks

Ordered. `[x]` done · `[~]` in progress · `[ ]` not started.

## Phase 0 — Foundation (h0–1)
- [x] Repo scaffold, workspaces, TS base config
- [x] Spec, plan, task breakdown
- [ ] Workspace package skeletons (`shared`, `catalog`, `mcp-marketplace`, `api`, `web`)
- [ ] `.env.example`, dependency install

## Phase 1 — Marketplace (h1–3)
- [ ] Domain types in `packages/shared`
- [ ] Deterministic catalog generator — 300 listings / 10 categories / 10 brands
- [ ] SVG car-art generator (category silhouette + brand-hashed hue)
- [ ] MCP server with `search_listings`, `get_listing`, `check_availability`
- [ ] Verify server in MCP Inspector

## Phase 2 — Walking skeleton (h3–5)
- [ ] Express API + SSE stream
- [ ] Claude Agent SDK loop connected to the MCP server
- [ ] React shell, three-zone layout
- [ ] A2UI renderer wired; one hardcoded surface renders end to end
- [ ] **Gate: browser → agent → MCP → A2UI → pixels**

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
