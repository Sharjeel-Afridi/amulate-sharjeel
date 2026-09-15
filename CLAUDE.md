# Claude Code — project context

## Git rules (non-negotiable)

1. **Always commit and push with the `afridi` alias.** This repo is only accessible
   to that identity, and the machine's global git user is a *different* account
   (`Sharjeel-Triomics`). Never use bare `git commit` / `git push`.

   ```bash
   git afridi commit -m "short message"
   git afridi push
   ```

   The alias injects `user.name=Sharjeel-Afridi`,
   `user.email=afridisharjeel8@gmail.com`, and the correct SSH key
   (`~/.ssh/id_afridi`). Local repo config mirrors the name/email/ssh as a
   safety net, but the alias remains the required path.

2. **Never add a `Co-Authored-By: Claude` trailer.** No AI attribution of any
   kind in commit messages — no trailer, no "generated with", nothing.

3. **Commit messages are short and descriptive.** One line, imperative mood,
   lowercase, no trailing period. No multi-paragraph bodies.

   - Good: `add mock catalog generator`, `wire A2UI stage surface`
   - Bad: `feat(catalog): implement the mock marketplace generator with 300
     listings across 10 categories…`

4. **Commit as you go.** Small, working increments — not one giant drop.

## What this is

An AI car matchmaker for the Amulate hackathon: a multistep agent that
interviews the user, researches a mock marketplace, and returns ranked and
explained rent/buy suggestions — with booking and mock checkout completed
in-chat.

Deadline is tight. Favour working software over completeness; ship the
walking skeleton first, then deepen.

## Stack & layout

TypeScript everywhere, ESM, Node 22, npm workspaces.

```
apps/
  web/              React + Vite — chat, A2UI renderer, MCP Apps host
  api/              Express + Agents SDK — the flow, session state, SSE
  mcp-marketplace/  MCP server — listing tools + ui:// MCP Apps
packages/
  shared/           shared types, criteria evaluation
  catalog/          mock marketplace data + deterministic generator
  ranking/          the deterministic scorer and its rationales
  question-engine/  the adaptive interview's auction, confidence and stopping
specs/              spec-driven development artefacts
```

Inside `apps/api/src`:

```
server.ts       routes only
session.ts      the session store and the TurnContext a driver gets
questions.ts    the question bank (wording, controls, auction metadata) and
                the spec sheet it renders as
episodes.ts     the question→answer→outcome log, with propensities
flow/           the journey, one file per step of the pipeline
  interview.ts    the adaptive loop: decide → present → record, per turn
  criteria.ts     preferences → criteria (pure, derived at point of use)
  search.ts       marketplace fetch + screening
  rank.ts         scorer, then model — the ONLY model/fallback branch
  present.ts      surfaces and copy
  spec.ts         editing a spec row
  booking.ts      MCP App booking and checkout
drivers/        index.ts holds the shared control handling; scripted.ts and
                agent.ts differ only in what they do with typed text
agents/         the model-facing parts: provider, ranker, conversational tools
```

### Rules that keep the flow followable

- **Criteria are derived, never stored-and-edited.** `buildCriteria(prefs)` is
  pure; the search calls it. Never add a second place that mutates
  `state.criteria`.
- **Only `flow/rank.ts` knows the model can fail.** A model-backed ranker
  reorders or returns `undefined`. It must not choose a fallback, set
  `rankedBy`, or trim the shortlist.
- **A driver only handles typed text.** Anything a rendered control fires goes in
  `drivers/index.ts`, once, for both drivers.
- **The auction picks the next question; a model never does.** The adaptive
  loop is deterministic given its RNG, and every turn logs the propensity the
  winner was chosen with — that is what makes the episode log learnable-from.
- **Counts and money are ours, never the model's.** It supplies judgement; the
  arithmetic in the copy comes from `flow/present.ts`.

## The two UI protocols

Keep the split clean — it is the core design idea, not an implementation detail:

- **A2UI** (`@a2ui/react`, `@a2ui/web_core`) — agent-driven surfaces that change
  every turn: journey rail, reasoning/progress, car catalogue, comparison.
- **MCP Apps** (`@mcp-ui/server`, `@mcp-ui/client`) — server-authored, sandboxed,
  transactional widgets rendered inline in chat: booking form, mock checkout.

Never render a car catalogue as hand-written HTML — it must go through A2UI.
Never render the booking or payment flow outside an MCP App iframe.

## Conventions

- **Do** keep all agent/tool logic in `apps/api` and `apps/mcp-marketplace`;
  presentation lives in `apps/web`.
- **Do** put shared types in `packages/shared` — both sides import from it.
- **Do** use `process.env` for config; `.env` locally, never committed.
- **Don't** commit `.env`, API keys, or absolute machine paths.
- **Don't** introduce real payment processing. Checkout is mocked, and the mock
  must be visibly labelled as such in the UI.
