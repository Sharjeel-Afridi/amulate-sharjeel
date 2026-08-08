import { loadEnv } from './env.js'

/**
 * Entry point.
 *
 * This exists purely so `.env` is loaded before anything else evaluates.
 * ES module imports are hoisted and run before any other statement in the file,
 * so calling `loadEnv()` at the top of `index.ts` would still happen *after*
 * every imported module had already captured `process.env` — including module
 * scope constants like `MCP_URL`. A dynamic import after loading is the only
 * ordering that actually holds.
 */
loadEnv()

await import('./index.js')
