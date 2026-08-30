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

/*
 * Tracing comes up next, and for the same hoisting reason: the OTel provider has
 * to be registered globally before any module resolves a tracer, or every span
 * built at module scope goes to the no-op implementation instead.
 */
const { startTracing } = await import('./otel/index.js')
startTracing()

await import('./server.js')
