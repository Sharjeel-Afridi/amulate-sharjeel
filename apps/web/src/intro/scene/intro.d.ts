/** Types for `intro.js` — the scene itself stays plain JS. See its header. */

export type IntroController = {
  /** Forward throttle. Ignored until the car has loaded. */
  setThrottle: (on: boolean) => void
  /** Stops the render loop and releases the WebGL context. */
  dispose: () => void
}

export function createIntro(opts: {
  container: HTMLElement
  /** Car loaded and drawing — safe to invite input. */
  onReady?: () => void
  /** Fired once, when the car crosses the launch speed. */
  onLaunch?: () => void
  onError?: (e: unknown) => void
}): IntroController
