import type { Animated, Easing, Keyframe } from '@shared/project/schema'

/** Two keyframes closer than this (seconds) are the same keyframe. */
export const KEY_EPSILON = 1 / 240

function ease(e: Easing, u: number): number {
  switch (e) {
    case 'linear':
      return u
    case 'easeIn':
      return u * u * u
    case 'easeOut':
      return 1 - (1 - u) ** 3
    case 'easeInOut':
      return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
    case 'hold':
      return 0
  }
}

export function evalAnimated(a: Animated, t: number): number {
  const keys = a.keys
  if (keys.length === 0) return a.value
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++
  const k0 = keys[i]
  const k1 = keys[i + 1]
  const u = (t - k0.t) / (k1.t - k0.t)
  return k0.v + (k1.v - k0.v) * ease(k0.e, u)
}

export function keyIndexAt(a: Animated, t: number): number {
  return a.keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPSILON)
}

export function setKeyframe(a: Animated, t: number, v: number, e: Easing = 'easeInOut'): Animated {
  const idx = keyIndexAt(a, t)
  const keys = [...a.keys]
  if (idx >= 0) keys[idx] = { ...keys[idx], v }
  else keys.push({ t, v, e })
  keys.sort((x, y) => x.t - y.t)
  return { value: a.value, keys }
}

export function removeKeyframe(a: Animated, t: number): Animated {
  const keys = a.keys.filter((k) => Math.abs(k.t - t) >= KEY_EPSILON)
  // When the last keyframe goes away, keep the value it had.
  return { value: keys.length ? a.value : evalAnimated(a, t), keys }
}

/**
 * Editing a value at time t: static properties change their value; animated properties get a
 * keyframe at t (the "auto-key" behaviour editors like CapCut use).
 */
export function setAnimatedValue(a: Animated, t: number, v: number): Animated {
  return a.keys.length ? setKeyframe(a, t, v) : { value: v, keys: [] }
}

/** Splits at local time t: both halves keep the animation, with a boundary key at the cut. */
export function splitAnimated(a: Animated, t: number): [Animated, Animated] {
  if (!a.keys.length) return [a, a]
  const v = evalAnimated(a, t)
  const boundaryEase = a.keys.findLast((k) => k.t <= t)?.e ?? 'easeInOut'
  const left: Keyframe[] = a.keys.filter((k) => k.t < t - KEY_EPSILON)
  left.push({ t, v, e: boundaryEase })
  const right: Keyframe[] = [{ t: 0, v, e: boundaryEase }]
  for (const k of a.keys) if (k.t > t + KEY_EPSILON) right.push({ ...k, t: k.t - t })
  return [
    { value: a.value, keys: left },
    { value: a.value, keys: right }
  ]
}

/** Shift keys by `delta` seconds (negative when trimming the clip start forward). */
export function shiftAnimated(a: Animated, delta: number): Animated {
  if (!a.keys.length) return a
  return { value: a.value, keys: a.keys.map((k) => ({ ...k, t: Math.max(0, k.t + delta) })) }
}

/** Scale key times (used when a clip's duration changes because of a speed change). */
export function scaleAnimated(a: Animated, factor: number): Animated {
  if (!a.keys.length) return a
  return { value: a.value, keys: a.keys.map((k) => ({ ...k, t: k.t * factor })) }
}
