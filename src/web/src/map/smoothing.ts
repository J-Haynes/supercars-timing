/**
 * Visual smoothing for map dots. When a car's crossing arrives, its estimated position usually steps forward a
 * little (it was a bit quicker or slower than expected). Instead of teleporting, the dot keeps its on-screen place
 * and the difference fades out over `TAU` seconds. Between crossings the dot is exactly where the timing puts it
 * (no lag), and big differences (pit lane, a new session) snap straight there.
 */
export interface Smoothed {
  /** The crossing this smoothing belongs to (the car's lastPointAt). */
  key: number
  /** Offset from the timing position at time `t0`, fading out. */
  offset0: number
  t0: number
  /** Where the dot was drawn last frame (track distance). */
  shown: number
}

/** Seconds for a crossing's step to fade to ~37 %. */
export const TAU = 0.3
/** Steps bigger than this (metres) aren't smoothed. */
const SNAP = 200

/** Signed shortest difference a - b on a loop of length `length`. */
function loopDiff(a: number, b: number, length: number): number {
  let d = (a - b) % length
  if (d > length / 2) d -= length
  if (d < -length / 2) d += length
  return d
}

export function smoothPosition(prev: Smoothed | undefined, key: number, target: number, now: number, length: number): Smoothed {
  if (!prev || length <= 0) return { key, offset0: 0, t0: now, shown: target }
  let { offset0, t0 } = prev
  if (key !== prev.key) {
    // New crossing: start from where the dot is on screen.
    offset0 = loopDiff(prev.shown, target, length)
    t0 = now
    if (Math.abs(offset0) > SNAP) offset0 = 0
  }
  const residual = offset0 * Math.exp(-Math.max(0, now - t0) / TAU)
  const shown = ((target + residual) % length + length) % length
  return { key, offset0, t0, shown }
}
