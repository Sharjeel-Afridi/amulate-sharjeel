/** Types for `intro.js` — the scene itself stays plain JS. See its header. */

export type IntroController = {
  /** Forward throttle. Ignored until the car has loaded. */
  setThrottle: (on: boolean) => void
  /** Blip the engine in neutral. Never moves the car, never launches. */
  setRevving: (on: boolean) => void
  /** Stops the render loop and releases the WebGL context. */
  dispose: () => void
}

/** Per-frame telemetry. The same object is mutated and re-passed every frame —
 *  read it synchronously, never retain it. */
export type IntroTick = {
  /** Current speed, m/s. */
  speed: number
  /** Ceiling of `speed`, m/s. */
  maxSpeed: number
  /** Speed at which `onLaunch` fires, m/s — lets the UI show launch progress. */
  launchSpeed: number
  launched: boolean
  /** Neutral revs, 0..1. Independent of `speed` — the car does not move on it. */
  rev: number
}

export function createIntro(opts: {
  container: HTMLElement
  /** Car loaded and drawing — safe to invite input. */
  onReady?: () => void
  /** Fired once, when the car crosses the launch speed. */
  onLaunch?: () => void
  /** Fired once per animation frame while the car exists. */
  onTick?: (tick: IntroTick) => void
  onError?: (e: unknown) => void
}): IntroController
