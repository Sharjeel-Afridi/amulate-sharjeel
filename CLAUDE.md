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
  api/              Express + Claude Agent SDK — agent loop, session state, SSE
  mcp-marketplace/  MCP server — listing tools + ui:// MCP Apps
packages/
  shared/           shared types, A2UI message builders
  catalog/          mock marketplace data + deterministic generator
specs/              spec-driven development artefacts
```

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
