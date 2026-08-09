import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntroController } from './scene/intro.js'
import './intro.css'

/**
 * The landing gate.
 *
 * A parked car, one instruction, one key. Holding ↑ is the whole interaction —
 * the moment the car actually moves we start the handover and the cockpit
 * crossfades in over the top. Once the transition ends the component unmounts
 * and takes its WebGL context with it, so nothing here costs anything for the
 * rest of the session.
 */

/** Crossfade window. Long enough to read as a pull-away, short enough to skip. */
const HANDOVER_MS = 1200

const SEEN_KEY = 'amulate:intro-seen'

function hasWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Whether to play the intro at all. It is decoration, so every reason to skip
 * it wins: a stated motion preference, no WebGL, or having already seen it in
 * this tab. `?intro=1` forces a replay for demos, `?intro=0` skips it.
 */
export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false

  const param = new URLSearchParams(window.location.search).get('intro')
  if (param === '0') return false
  if (param === '1') return hasWebgl()

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (!hasWebgl()) return false

  try {
    if (window.sessionStorage.getItem(SEEN_KEY) === '1') return false
  } catch {
    // Private mode or blocked storage — replaying is the harmless outcome.
  }
  return true
}

function markIntroSeen() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function Intro({
  onLaunch,
  onDone,
}: {
  /** Fired when the handover starts — the cockpit fades in against this. */
  onLaunch: () => void
  /** Fired when the crossfade is over and the intro should be unmounted. */
  onDone: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<IntroController | null>(null)
  const handoverRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Held in refs so the scene callbacks, which are wired once, always reach the
  // current handlers without re-creating the WebGL context.
  const launchRef = useRef(onLaunch)
  const doneRef = useRef(onDone)
  launchRef.current = onLaunch
  doneRef.current = onDone

  const [ready, setReady] = useState(false)
  const [holding, setHolding] = useState(false)
  const [launching, setLaunching] = useState(false)

  // Touch and pen have no arrow keys, so the wording differs — but the cue is a
  // real press-and-hold control on every device. It used to be inert decoration
  // that named a key, which left anyone on a mouse with nothing to press except
  // "Skip intro": the one control that throws the moment away.
  const [coarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  /**
   * Start the crossfade. Idempotent, because both the car crossing the launch
   * speed and the skip button land here.
   */
  const beginHandover = useCallback(() => {
    if (handoverRef.current) return
    markIntroSeen()
    setLaunching(true)
    launchRef.current()
    handoverRef.current = setTimeout(() => doneRef.current(), HANDOVER_MS)
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    let cancelled = false
    let controller: IntroController | undefined

    /** Nothing to fade from — drop straight through to the app. */
    const bail = (e: unknown) => {
      console.error('[intro]', e)
      if (cancelled) return
      markIntroSeen()
      launchRef.current()
      doneRef.current()
    }

    void (async () => {
      try {
        // Split out so the vendored three build is fetched only when the intro
        // actually plays — most sessions after the first never touch it.
        const mod = await import('./scene/intro.js')
        if (cancelled) return

        controller = mod.createIntro({
          container: stage,
          onReady: () => !cancelled && setReady(true),
          onLaunch: () => !cancelled && beginHandover(),
          onError: bail,
        })
        controllerRef.current = controller
      } catch (e) {
        bail(e)
      }
    })()

    return () => {
      cancelled = true
      if (handoverRef.current) clearTimeout(handoverRef.current)
      handoverRef.current = null
      controllerRef.current = null
      controller?.dispose()
    }
  }, [beginHandover])

  // Throttle input. ArrowUp only — every other key is deliberately inert, and
  // the default scroll on ↑/space would fight the fixed overlay.
  useEffect(() => {
    const set = (on: boolean) => {
      setHolding(on)
      controllerRef.current?.setThrottle(on)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp') return
      e.preventDefault()
      if (e.repeat) return
      set(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp') return
      e.preventDefault()
      set(false)
    }
    // Releasing the key outside the window never fires keyup, which would leave
    // the throttle stuck on.
    const release = () => set(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])

  const setThrottle = (on: boolean) => {
    setHolding(on)
    controllerRef.current?.setThrottle(on)
  }

  // Releasing outside the control, or having the pointer captured away, must
  // not leave the throttle stuck on — the same failure the keyboard path guards
  // against with window blur.
  const holdProps = {
    onPointerDown: () => setThrottle(true),
    onPointerUp: () => setThrottle(false),
    onPointerCancel: () => setThrottle(false),
    onPointerLeave: () => setThrottle(false),
  }

  return (
    <div className={`intro${launching ? ' intro--launching' : ''}${ready ? ' intro--ready' : ''}`}>
      <div className="intro__stage" ref={stageRef} aria-hidden="true" />
      <div className="intro__grade" aria-hidden="true" />

      <div className="intro__ui">
        <div className="intro__brand">
          <span className="brand__mark" aria-hidden="true">C</span>
          <span className="brand__name">Car Matchmaker</span>
        </div>

        <div className="intro__center">
          <p className="intro__eyebrow">Rent or buy · 400 live listings</p>
          <h1 className="intro__title">Find the car. Not the listings.</h1>
          <p className="intro__sub">
            An AI concierge that interviews you, searches the market, and explains every choice
            against what you actually said.
          </p>

          {ready ? (
            <button
              type="button"
              className={`intro__cue${holding ? ' intro__cue--held' : ''}`}
              {...holdProps}
            >
              {coarse ? (
                <>
                  <span className="intro__pad" aria-hidden="true">↑</span>
                  <span className="intro__cue-text">Touch and hold to start</span>
                </>
              ) : (
                <>
                  <kbd className="intro__key">↑</kbd>
                  <span className="intro__cue-text">Hold ↑, or press and hold here</span>
                </>
              )}
            </button>
          ) : (
            <div className="intro__cue intro__cue--loading">
              <span className="intro__spinner" aria-hidden="true" />
              <span className="intro__cue-text">Warming up the engine…</span>
            </div>
          )}
        </div>

        <div className="intro__foot">
          <ul className="intro__proof">
            <li>Interviews you in eleven questions</li>
            <li>Screens every listing against your dealbreakers</li>
            <li>Books and checks out without leaving the chat</li>
          </ul>
          <button type="button" className="intro__skip" onClick={beginHandover}>
            Skip intro
          </button>
        </div>
      </div>
    </div>
  )
}
