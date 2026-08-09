/**
 * Procedural engine audio for the landing intro. No samples, no assets — the
 * whole sound is synthesized in WebAudio so it costs nothing to ship and can
 * track the car's real speed sample-accurately.
 *
 * Voice architecture:
 *
 *   saw @ f      ─┐
 *   saw @ ~1.5f  ─┼→ lowpass ─┐
 *   square @ f/2 ─┘           ├→ bus (intensity gain) → master (mute/fade) → out
 *   noise loop → bandpass ────┘
 *
 * The two detuned saws are the engine note, the half-frequency square is the
 * exhaust thump underneath it, and the band-passed noise loop is combustion
 * rumble. Intensity 0..1 sweeps fundamental pitch, filter brightness and bus
 * gain together; an LFO wobbles the pitch at idle and fades out as the revs
 * climb, which is what makes the idle read as "lumpy V8" rather than "test
 * tone".
 *
 * Browser autoplay policy means the AudioContext can only be created/resumed
 * inside a user gesture — `start()` is that call and the intro invokes it from
 * the first throttle press.
 */

export type EngineAudio = {
  /** Create/resume the context and play the starter-crank + rev-blip gesture. */
  start: () => void
  /** 0 = idle, 1 = full-throttle scream. Safe to call every animation frame. */
  setIntensity: (v: number) => void
  /** Fade out and permanently close the context. Idempotent. */
  stop: (fadeMs?: number) => void
  setMuted: (m: boolean) => void
  readonly muted: boolean
}

/** Hard ceiling on output level — the intro should purr, not blast. */
const MASTER_GAIN = 0.22

/** Fundamental sweep, idle → redline. Sub-50 Hz idle reads as "big engine". */
const FREQ_IDLE = 42
const FREQ_MAX = 235

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function createEngineAudio(): EngineAudio {
  let ctx: AudioContext | null = null
  let started = false
  let stopped = false
  let mutedState = false
  let intensity = 0

  // Scheduled automation from the start gesture owns the params until this
  // timestamp — mixing per-frame setTargetAtTime into a scheduled ramp makes
  // the blip stutter, so setIntensity only records until the gesture is over.
  let gestureUntil = 0

  let master: GainNode | null = null
  let bus: GainNode | null = null
  let filter: BiquadFilterNode | null = null
  let noiseFilter: BiquadFilterNode | null = null
  let noiseGain: GainNode | null = null
  let lfoDepth: GainNode | null = null
  let oscLow: OscillatorNode | null = null
  let oscHigh: OscillatorNode | null = null
  let oscSub: OscillatorNode | null = null

  /** Every source that needs an explicit stop() at teardown. */
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = []

  function buildGraph(ac: AudioContext) {
    const t = ac.currentTime

    master = ac.createGain()
    // Never automate from a true zero — exponential ramps blow up on 0.
    master.gain.value = 0.0001
    master.connect(ac.destination)

    bus = ac.createGain()
    bus.gain.value = 0.5
    bus.connect(master)

    // ------------------------------------------------------------ engine note
    filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 320
    filter.Q.value = 0.9
    filter.connect(bus)

    oscLow = ac.createOscillator()
    oscLow.type = 'sawtooth'
    oscLow.frequency.value = FREQ_IDLE

    oscHigh = ac.createOscillator()
    oscHigh.type = 'sawtooth'
    oscHigh.frequency.value = FREQ_IDLE * 1.5
    oscHigh.detune.value = 9 // a few cents off keeps the pair from phase-locking

    oscSub = ac.createOscillator()
    oscSub.type = 'square'
    oscSub.frequency.value = FREQ_IDLE / 2

    const mix = (osc: OscillatorNode, level: number) => {
      const g = ac.createGain()
      g.gain.value = level
      osc.connect(g)
      g.connect(filter as BiquadFilterNode)
      osc.start(t)
      sources.push(osc)
    }
    mix(oscLow, 0.42)
    mix(oscHigh, 0.2)
    mix(oscSub, 0.3)

    // ------------------------------------------------------- combustion rumble
    const seconds = 2
    const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ac.createBufferSource()
    noise.buffer = buffer
    noise.loop = true

    noiseFilter = ac.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.value = 110
    noiseFilter.Q.value = 1.1

    noiseGain = ac.createGain()
    noiseGain.gain.value = 0.16

    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(bus)
    noise.start(t)
    sources.push(noise)

    // ------------------------------------------------------------- idle wobble
    // Slow pitch flutter, ~5 Hz. Depth is ramped toward zero as intensity rises
    // (see applyIntensity) — a screaming engine holds its note.
    const lfo = ac.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 5.3
    lfoDepth = ac.createGain()
    lfoDepth.gain.value = 2.4
    lfo.connect(lfoDepth)
    lfoDepth.connect(oscLow.frequency)
    lfoDepth.connect(oscSub.frequency)
    lfo.start(t)
    sources.push(lfo)
  }

  /**
   * Starter motor cranking, catch, one rev blip, settle to idle. All scheduled
   * up front so it survives any main-thread jank on the first held frame.
   */
  function playStartGesture(ac: AudioContext) {
    if (!master || !oscLow || !oscHigh || !oscSub || !filter) return
    const t = ac.currentTime

    // Crank: a low buzz pulsed rrr-rrr-rrr by its own gain envelope.
    const crank = ac.createOscillator()
    crank.type = 'sawtooth'
    crank.frequency.setValueAtTime(52, t)
    crank.frequency.linearRampToValueAtTime(64, t + 0.55)
    const crankGain = ac.createGain()
    crankGain.gain.setValueAtTime(0.0001, t)
    for (let i = 0; i < 4; i++) {
      const p = t + i * 0.14
      crankGain.gain.exponentialRampToValueAtTime(0.5, p + 0.05)
      crankGain.gain.exponentialRampToValueAtTime(0.05, p + 0.13)
    }
    crankGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.62)
    crank.connect(crankGain)
    crankGain.connect(master)
    crank.start(t)
    crank.stop(t + 0.7)

    // Engine catches under the last crank pulse, blips to ~60% revs, settles.
    const catchAt = t + 0.42
    const blipAt = t + 0.62
    const settleAt = t + 1.15
    const blipFreq = FREQ_IDLE + (FREQ_MAX - FREQ_IDLE) * 0.6

    const sweep = (param: AudioParam, ratio: number) => {
      param.setValueAtTime(FREQ_IDLE * ratio, catchAt)
      param.exponentialRampToValueAtTime(blipFreq * ratio, blipAt + 0.16)
      param.exponentialRampToValueAtTime(FREQ_IDLE * ratio, settleAt)
    }
    sweep(oscLow.frequency, 1)
    sweep(oscHigh.frequency, 1.5)
    sweep(oscSub.frequency, 0.5)

    filter.frequency.setValueAtTime(320, catchAt)
    filter.frequency.exponentialRampToValueAtTime(1600, blipAt + 0.16)
    filter.frequency.exponentialRampToValueAtTime(340, settleAt)

    // Master fades in only once the engine has caught.
    const level = mutedState ? 0.0001 : MASTER_GAIN
    master.gain.setValueAtTime(0.0001, t)
    master.gain.setValueAtTime(0.0001, catchAt - 0.05)
    master.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), catchAt + 0.12)

    gestureUntil = settleAt
  }

  /** Smoothly steer every intensity-mapped param toward the stored value. */
  function applyIntensity() {
    if (!ctx || stopped) return
    if (ctx.currentTime < gestureUntil) return

    const v = intensity
    const t = ctx.currentTime
    // ~60 ms time constant: fast enough to feel connected to the throttle,
    // slow enough that per-frame calls never produce zipper noise.
    const TC = 0.06

    // Slight curve so the low end of the sweep is where most of the audible
    // pitch change lives — engines feel like that.
    const freq = FREQ_IDLE + (FREQ_MAX - FREQ_IDLE) * Math.pow(v, 1.2)
    oscLow?.frequency.setTargetAtTime(freq, t, TC)
    oscHigh?.frequency.setTargetAtTime(freq * 1.5, t, TC)
    oscSub?.frequency.setTargetAtTime(freq / 2, t, TC)

    filter?.frequency.setTargetAtTime(320 + 2400 * v, t, TC)
    bus?.gain.setTargetAtTime(0.5 + 0.5 * v, t, TC)

    noiseFilter?.frequency.setTargetAtTime(110 + 720 * v, t, TC)
    noiseGain?.gain.setTargetAtTime(0.16 + 0.2 * v, t, TC)

    // Idle wobble dies off as the revs climb.
    lfoDepth?.gain.setTargetAtTime(2.4 * (1 - v), t, TC)
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      try {
        const Ctor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        ctx = new Ctor()
        // Called from a user gesture, so this resolves — but a rejection must
        // never take the intro down with it.
        void ctx.resume().catch(() => {})
        buildGraph(ctx)
        playStartGesture(ctx)
      } catch {
        // No audio is an acceptable intro; a thrown context is not.
        ctx = null
      }
    },

    setIntensity(v: number) {
      intensity = clamp01(v)
      applyIntensity()
    },

    stop(fadeMs = 600) {
      if (stopped) {
        return
      }
      stopped = true
      const ac = ctx
      if (!ac || !master) return
      try {
        const t = ac.currentTime
        master.gain.cancelScheduledValues(t)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t)
        master.gain.exponentialRampToValueAtTime(0.0001, t + fadeMs / 1000)
      } catch {
        /* already closing — fall through to teardown */
      }
      // The intro unmounts right after handover, so the context must actually
      // close — browsers cap live contexts the same way they cap GL contexts.
      window.setTimeout(() => {
        try {
          for (const s of sources) s.stop()
        } catch {
          /* sources may already be stopped */
        }
        void ac.close().catch(() => {})
      }, fadeMs + 80)
      ctx = null
    },

    setMuted(m: boolean) {
      mutedState = m
      if (!ctx || !master || stopped) return
      const t = ctx.currentTime
      const target = m ? 0.0001 : MASTER_GAIN
      // This deliberately stomps the start-gesture fade-in if the user toggles
      // mid-crank — an explicit toggle always beats a scheduled envelope.
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t)
      master.gain.exponentialRampToValueAtTime(target, t + 0.12)
    },

    get muted() {
      return mutedState
    },
  }
}
