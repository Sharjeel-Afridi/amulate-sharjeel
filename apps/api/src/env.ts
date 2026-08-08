import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads `.env` before anything reads `process.env`.
 *
 * Compose substitutes `.env` itself, so containers were fine — but `npm run dev`
 * runs the process directly and nothing was populating the environment, so a key
 * sitting in `.env` was silently ignored and the app fell back to scripted mode
 * with a message that looked like the key was missing.
 *
 * Uses Node's built-in env-file loader rather than adding a dependency. Searches
 * upward because the process starts in `apps/api` but the file lives at the repo
 * root, where a single `.env` serves every workspace.
 */
export function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.ENV_FILE,
    resolve(process.cwd(), '.env'),
    resolve(here, '../../../.env'),
    resolve(here, '../.env'),
  ].filter((p): p is string => Boolean(p))

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      process.loadEnvFile(path)
      // Never log the path's contents — only that one was found.
      console.log(`[api] loaded environment from ${path}`)
      return
    } catch (err) {
      console.warn(`[api] could not read ${path}:`, err instanceof Error ? err.message : err)
    }
  }
}
