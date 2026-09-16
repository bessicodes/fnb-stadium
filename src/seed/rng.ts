/**
 * A small seeded generator, so the demo data is the same every time.
 *
 * Reproducibility matters more than randomness here: a screenshot, a bug
 * report and a test should all be describing the same stadium.
 */
export function rng(seed: number) {
  let state = seed >>> 0

  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    /** Integer in [min, max]. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** Float in [min, max). */
    float: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    /** True with probability p. */
    chance: (p: number) => next() < p,
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j] as T, out[i] as T]
      }
      return out
    },
  }
}

export type Rng = ReturnType<typeof rng>
