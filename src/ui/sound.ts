// Rest timer sound. iOS Safari cannot vibrate, so the end of a rest is a short chime.
// The chime is scheduled on the audio clock in advance, so it still plays if the page is briefly throttled.

let ctx: AudioContext | undefined
let scheduled: OscillatorNode[] = []
let scheduledFor: number | undefined

function context(): AudioContext | undefined {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return undefined
  }
}

/** Call from a tap so iOS allows sound later */
export function unlockAudio() {
  const c = context()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  g.gain.value = 0
  o.connect(g).connect(c.destination)
  o.start()
  o.stop(c.currentTime + 0.01)
}

function chimeAt(c: AudioContext, t: number): OscillatorNode[] {
  return [0, 0.22, 0.44].map((offset, i) => {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.value = i === 2 ? 1320 : 880
    g.gain.setValueAtTime(0.0001, t + offset)
    g.gain.exponentialRampToValueAtTime(0.35, t + offset + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18)
    o.connect(g).connect(c.destination)
    o.start(t + offset)
    o.stop(t + offset + 0.2)
    return o
  })
}

export function cancelChime() {
  scheduled.forEach((o) => {
    try {
      o.stop()
    } catch {
      /* already stopped */
    }
  })
  scheduled = []
  scheduledFor = undefined
}

/** Schedule the chime for an absolute time in ms (Date.now() clock) */
export function scheduleChime(endAtMs: number) {
  cancelChime()
  const c = context()
  if (!c) return
  const delay = Math.max(0, (endAtMs - Date.now()) / 1000)
  scheduled = chimeAt(c, c.currentTime + delay)
  scheduledFor = endAtMs
}

export function isChimeScheduled(endAtMs: number) {
  return scheduledFor === endAtMs
}

export function chimeNow() {
  const c = context()
  if (c) chimeAt(c, c.currentTime)
}
