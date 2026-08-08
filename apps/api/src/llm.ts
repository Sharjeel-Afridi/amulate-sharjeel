/**
 * Shared guards for anything that calls a model.
 *
 * Both the conversational agent and the ranking agent need the same two
 * protections, and a free tier makes them mandatory rather than defensive: a
 * single turn can make several model calls, and a provider that throttles
 * presents as a hang rather than an error because the SDK retries internally.
 */

export const isRateLimit = (err: unknown): boolean =>
  /\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(err instanceof Error ? err.message : String(err))

/**
 * Retries a throttled call with exponential backoff. Anything that is not a rate
 * limit is rethrown immediately — retrying a bad request just delays the error.
 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRateLimit(err) || i === attempts - 1) throw err
      const backoff = 2000 * 2 ** i
      console.warn(`[llm] rate limited, retrying in ${backoff}ms (${i + 1}/${attempts - 1})`)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastError
}

/** Rejects if `fn` has not settled in time. Clears the timer either way. */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
