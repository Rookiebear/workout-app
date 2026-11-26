import { PROGRESSION } from '../config/defaults'
import type { SetRecord } from './types'

/** Epley: 1RM = w × (1 + r / 30) */
export function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

/** Inverse of Epley: the weight that allows `reps` for a given 1RM */
export function weightForReps(oneRm: number, reps: number): number {
  return oneRm / (1 + reps / 30)
}

/** Best estimated 1RM from working sets with at most 10 reps */
export function bestE1rm(sets: SetRecord[]): number | undefined {
  let best: number | undefined
  for (const s of sets) {
    if (s.isWarmup || s.reps <= 0 || s.reps > PROGRESSION.epleyMaxReps || s.weight <= 0) continue
    const v = epley(s.weight, s.reps)
    if (best === undefined || v > best) best = v
  }
  return best
}
