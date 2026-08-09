import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntroController, IntroTick } from './scene/intro.js'
import { createEngineAudio, type EngineAudio } from './engine-audio.js'
import './intro.css'

/**
 * The landing gate.
 *
 * A parked car, one instruction, one key. Holding ↑ is the whole interaction —
 * the moment the car actually moves we start the handover and the cockpit
 * crossfades in over the top. Once the transition ends the component unmounts
 * and takes its WebGL context — and its AudioContext — with it, so nothing here
 * costs anything for the rest of the session.
 *
 * The scene feeds live telemetry through `onTick`; the HUD, the launch-charge
 * ring, the speed-line overlay and the engine audio all follow it via refs and
 * direct DOM writes. Nothing per-frame touches React state.
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
  const rootRef = useRef<HTMLDivElement>(null)
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
  const [revving, setRevving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [muted, setMuted] = useState(false)

  // Everything the per-frame tick handler needs, as refs — the handler is wired
  // once and must never close over stale state.
  const readyRef = useRef(false)
  const holdingRef = useRef(false)
  const revvingRef = useRef(false)
  const mutedRef = useRef(false)
  const engineRef = useRef<EngineAudio | null>(null)
  const speedValRef = useRef<HTMLSpanElement>(null)
  const rpmCoverRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLSpanElement>(null)
  const lastKmhRef = useRef(-1)
  const lastGearRef = useRef('')
  const lastBoostRef = useRef('')
  const lastChargeRef = useRef('')
  const lastRevRef = useRef('')

  // Touch and pen have no arrow keys, so the wording differs — but the cue is a
  // real press-and-hold control on every device. It used to be inert decoration
  // that named a key, which left anyone on a mouse with nothing to press except
  // "Skip intro": the one control that throws the moment away.
  const [coarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  /**
   * Lazily create and start the engine on a throttle press — the AudioContext
   * can only be created/resumed inside a user gesture, so this is the one
   * place it is allowed to come to life. Reads refs only, so it stays stable.
   */
  const startEngine = useCallback(() => {
    // No engine births after the handover starts — a throttle press during the
    // crossfade would otherwise start a crank that outlives the intro's fade.
    if (!readyRef.current || handoverRef.current) return
    if (!engineRef.current) {
      const engine = createEngineAudio()
      // The mute toggle may have been armed before any audio existed.
      engine.setMuted(mutedRef.current)
      engineRef.current = engine
    }
    engineRef.current.start()
  }, [])

  /**
   * Start the crossfade. Idempotent, because both the car crossing the launch
   * speed and the skip button land here.
   */
  const beginHandover = useCallback(() => {
    if (handoverRef.current) return
    markIntroSeen()
    setLaunching(true)
    // The engine sings through the pull-away and dies with the crossfade.
    engineRef.current?.stop(HANDOVER_MS)
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

    /**
     * Live telemetry → audio intensity, HUD readouts and overlay CSS vars.
     * Direct DOM writes, cached against their previous values — this runs
     * every animation frame and must never schedule a React render.
     */
    const handleTick = (tick: IntroTick) => {
      const ratio = tick.speed / tick.maxSpeed
      // Throttle pinned but barely moving = revving hard against the clutch,
      // so the floor while held is well above the actual road speed. A neutral
      // rev competes with both: whichever is loading the engine hardest wins.
      const intensity = Math.max(holdingRef.current ? 0.35 : 0, ratio, tick.rev)
      engineRef.current?.setIntensity(intensity)

      const root = rootRef.current
      if (root) {
        const charge = tick.launched ? '1' : Math.min(tick.speed / tick.launchSpeed, 1).toFixed(3)
        if (charge !== lastChargeRef.current) {
          lastChargeRef.current = charge
          root.style.setProperty('--charge', charge)
        }
        const boost = ratio.toFixed(3)
        if (boost !== lastBoostRef.current) {
          lastBoostRef.current = boost
          root.style.setProperty('--boost', boost)
        }
        // The rev button glows on the real envelope, so it keeps burning for a
        // beat after release exactly as the engine note does.
        const rev = tick.rev.toFixed(3)
        if (rev !== lastRevRef.current) {
          lastRevRef.current = rev
          root.style.setProperty('--rev', rev)
        }
      }

      const kmh = Math.round(tick.speed * 3.6)
      if (kmh !== lastKmhRef.current && speedValRef.current) {
        lastKmhRef.current = kmh
        speedValRef.current.textContent = String(kmh)
      }
      if (rpmCoverRef.current) {
        rpmCoverRef.current.style.transform = `scaleX(${(1 - intensity).toFixed(3)})`
      }
      if (gearRef.current) {
        const gear = tick.speed < 0.5 ? 'N' : String(1 + Math.min(4, Math.floor(ratio * 5)))
        if (gear !== lastGearRef.current) {
          lastGearRef.current = gear
          gearRef.current.textContent = gear
        }
      }
    }

    void (async () => {
      try {
        // Split out so the vendored three build is fetched only when the intro
        // actually plays — most sessions after the first never touch it.
        const mod = await import('./scene/intro.js')
        if (cancelled) return

        controller = mod.createIntro({
          container: stage,
          onReady: () => {
            if (cancelled) return
            readyRef.current = true
            setReady(true)
          },
          onLaunch: () => !cancelled && beginHandover(),
          onTick: handleTick,
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
      // Idempotent — if the handover already started the long fade, this call
      // is a no-op and the context closes on the fade's own schedule.
      engineRef.current?.stop(150)
      engineRef.current = null
    }
  }, [beginHandover])

  // The two hold controls. Both are stable across renders, so the key listeners
  // wire once and the pointer handlers can share them rather than restating the
  // same four lines.
  const applyThrottle = useCallback(
    (on: boolean) => {
      holdingRef.current = on
      setHolding(on)
      controllerRef.current?.setThrottle(on)
      if (on) startEngine()
    },
    [startEngine],
  )

  const applyRev = useCallback(
    (on: boolean) => {
      revvingRef.current = on
      setRevving(on)
      controllerRef.current?.setRevving(on)
      if (on) startEngine()
    },
    [startEngine],
  )

  // Hold input. ArrowUp drives and space revs in neutral; every other key is
  // deliberately inert, and the default scroll on ↑/space would fight the fixed
  // overlay.
  useEffect(() => {
    const isRev = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' '

    const onKeyDown = (e: KeyboardEvent) => {
      const rev = isRev(e)
      if (!rev && e.key !== 'ArrowUp') return
      // Space would scroll, and would also activate whichever button has focus
      // — including "Skip intro", the one control that throws the moment away.
      e.preventDefault()
      if (e.repeat) return
      ;(rev ? applyRev : applyThrottle)(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const rev = isRev(e)
      if (!rev && e.key !== 'ArrowUp') return
      e.preventDefault()
      ;(rev ? applyRev : applyThrottle)(false)
    }
    // Releasing the key outside the window never fires keyup, which would leave
    // a control stuck on.
    const release = () => {
      applyThrottle(false)
      applyRev(false)
    }

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
  }, [applyRev, applyThrottle])

  // Releasing outside the control, or having the pointer captured away, must
  // not leave it stuck on — the same failure the keyboard path guards against
  // with window blur.
  const holdBinding = (apply: (on: boolean) => void) => ({
    onPointerDown: () => apply(true),
    onPointerUp: () => apply(false),
    onPointerCancel: () => apply(false),
    onPointerLeave: () => apply(false),
  })
  const holdProps = holdBinding(applyThrottle)
  const revProps = holdBinding(applyRev)

  const toggleMute = () => {
    const m = !mutedRef.current
    mutedRef.current = m
    setMuted(m)
    // Before the first throttle press there is no engine yet — the toggle just
    // arms the state the engine will be born with.
    engineRef.current?.setMuted(m)
  }

  return (
    <div
      ref={rootRef}
      className={`intro${launching ? ' intro--launching' : ''}${ready ? ' intro--ready' : ''}`}
    >
      <div className="intro__stage" ref={stageRef} aria-hidden="true" />
      <div className="intro__grade" aria-hidden="true" />
      <div className="intro__lines" aria-hidden="true" />

      <div className="intro__hud" aria-hidden="true">
        <div className="hud__row">
          <div className="hud__speed">
            <span className="hud__value" ref={speedValRef}>
              0
            </span>
            <span className="hud__unit">km/h</span>
          </div>
          <div className="hud__gear">
            <span className="hud__gear-label">gear</span>
            <span className="hud__gear-value" ref={gearRef}>
              N
            </span>
          </div>
        </div>
        <div className="hud__rpm">
          <div className="hud__rpm-track">
            <div className="hud__rpm-cover" ref={rpmCoverRef} />
          </div>
          <div className="hud__rpm-scale">
            <span>rpm</span>
            <span>redline</span>
          </div>
        </div>
      </div>

      <div className="intro__ui">
        <div className="intro__top">
          <div className="intro__brand">
            <span className="brand__mark" aria-hidden="true">C</span>
            <span className="brand__name">Car Matchmaker</span>
          </div>
          <button
            type="button"
            className={`intro__mute${muted ? ' intro__mute--muted' : ''}`}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute engine audio' : 'Mute engine audio'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 6v4h2.6L9 13.2V2.8L5.1 6H2.5z" fill="currentColor" stroke="none" />
              {muted ? (
                <path d="M11.2 6.2l3.6 3.6M14.8 6.2l-3.6 3.6" />
              ) : (
                <path d="M11.2 5.7a3.3 3.3 0 0 1 0 4.6M13.1 3.9a6 6 0 0 1 0 8.2" />
              )}
            </svg>
            <span>{muted ? 'Muted' : 'Sound'}</span>
          </button>
        </div>

        <div className="intro__center">
          <p className="intro__eyebrow">
            <span className="intro__live-dot" aria-hidden="true" />
            290 live listings · rent or buy
          </p>
          <h1 className="intro__title">
            <span className="intro__title-line">Stop browsing.</span>
            <span className="intro__title-line intro__title-line--accent">Start driving.</span>
          </h1>
          <p className="intro__sub">
            An AI concierge that interviews you, hunts the whole market, and defends every pick
            against what you actually said.
          </p>

          {ready ? (
            <div className="intro__controls">
              <button
                type="button"
                className={`intro__cue${holding ? ' intro__cue--held' : ''}`}
                {...holdProps}
              >
                <span className="intro__cue-ring" aria-hidden="true">
                  {coarse ? (
                    <span className="intro__pad">↑</span>
                  ) : (
                    <kbd className="intro__key">↑</kbd>
                  )}
                </span>
                <span className="intro__cue-copy">
                  <span className="intro__cue-title">
                    {coarse ? 'Hold to ignite' : 'Hold ↑ to ignite'}
                  </span>
                  <span className="intro__cue-hint">
                    {coarse ? 'keep it pinned — launch at 25 km/h' : 'or press and hold right here'}
                  </span>
                </span>
              </button>

              {/* Secondary on purpose: revving is the toy, igniting is the door. */}
              <button
                type="button"
                className={`intro__rev${revving ? ' intro__rev--held' : ''}`}
                aria-pressed={revving}
                aria-label="Hold to rev the engine in neutral"
                {...revProps}
              >
                {coarse ? (
                  <span className="intro__pad intro__pad--wide" aria-hidden="true">
                    rev
                  </span>
                ) : (
                  <kbd className="intro__key intro__key--wide" aria-hidden="true">
                    space
                  </kbd>
                )}
                <span className="intro__rev-copy">
                  {coarse ? 'Hold to rev' : 'Rev in neutral'}
                </span>
              </button>
            </div>
          ) : (
            <div className="intro__cue intro__cue--loading">
              <span className="intro__spinner" aria-hidden="true" />
              <span className="intro__cue-title">Rolling it out of the garage…</span>
            </div>
          )}
        </div>

        <div className="intro__foot">
          <div className="intro__foot-copy">
            <ul className="intro__proof">
              <li>Interviews you in eleven questions</li>
              <li>Screens every listing against your dealbreakers</li>
              <li>Books and checks out without leaving the chat</li>
            </ul>
            {/* CC BY 4.0 obliges us to name the work, its author and the licence
                wherever the model is shown — not just in a repo file. */}
            <p className="intro__credit">
              “BMW M4 Competition M Package” by SRT Perfomance, via{' '}
              <a
                href="https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b"
                target="_blank"
                rel="noreferrer noopener"
              >
                Sketchfab
              </a>
              , licensed{' '}
              <a
                href="http://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer noopener"
              >
                CC BY 4.0
              </a>
              .
            </p>
          </div>
          <button type="button" className="intro__skip" onClick={beginHandover}>
            Skip intro
          </button>
        </div>
      </div>
    </div>
  )
}
