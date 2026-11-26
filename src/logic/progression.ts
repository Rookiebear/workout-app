// Double progression: push reps to the top of the range, then add weight and start again from the bottom.
import { PROGRESSION, WARMUP_SCHEME } from '../config/defaults'
import { bestE1rm, epley, weightForReps } from './oneRm'
import type { InitialRecord, Session, SetRecord } from './types'
import { dropWeight, isFixedLoad, roundWeight, stepUp, type WeightRule } from './weights'

export interface HistoryEntry {
  date: string
  repMin: number
  repMax: number
  isProbe?: boolean
  sets: SetRecord[]
}

export interface Target {
  repMin: number
  repMax: number
  sets: number
  targetRir: [number, number]
}

export type SuggestionKind =
  | 'probe'
  | 'initial'
  | 'convert'
  | 'increase'
  | 'add_reps'
  | 'retry'
  | 'decrease'
  | 'top_out'

export interface Suggestion {
  kind: SuggestionKind
  /** null while probing for a starting weight */
  weight: number | null
  /** target reps per working set */
  reps: number[]
  /** 3 sessions in a row without progress: suggest a swap or a deload */
  stalled: boolean
  /** weight steps added, 2 when RIR showed a lot left in the tank */
  steps?: number
  e1rm?: number
}

export const working = (sets: SetRecord[]) => sets.filter((s) => !s.isWarmup && s.reps > 0)
const topWeight = (sets: SetRecord[]) => Math.max(...sets.map((s) => s.weight))
const totalReps = (sets: SetRecord[]) => sets.reduce((n, s) => n + s.reps, 0)
const sameRange = (h: HistoryEntry, t: { repMin: number; repMax: number }) => h.repMin === t.repMin && h.repMax === t.repMax

function progressed(newer: HistoryEntry, older: HistoryEntry): boolean {
  const a = working(newer.sets)
  const b = working(older.sets)
  const wa = topWeight(a)
  const wb = topWeight(b)
  if (wa > wb + 1e-9) return true
  if (wa < wb - 1e-9) return false
  return totalReps(a) > totalReps(b)
}

/** Newest-first entries in the same rep range, stopping at a probe or a range change */
function chain(history: HistoryEntry[], target: Target): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const h of history) {
    if (!sameRange(h, target) || h.isProbe) break
    out.push(h)
  }
  return out
}

export function isStalled(history: HistoryEntry[], target: Target): boolean {
  const c = chain(history, target)
  const n = PROGRESSION.stallSessions
  if (c.length < n + 1) return false
  for (let i = 0; i < n; i++) if (progressed(c[i], c[i + 1])) return false
  return true
}

export function suggestNext(args: {
  /** newest first */
  history: HistoryEntry[]
  target: Target
  rule: WeightRule
  initial?: InitialRecord
}): Suggestion {
  const { target, rule, initial } = args
  const fill = (n: number) => Array.from({ length: target.sets }, () => n)
  const history = args.history.filter((h) => working(h.sets).length > 0)
  const fixed = isFixedLoad(rule)

  if (history.length === 0) {
    if (initial && initial.reps > 0) {
      if (fixed) return { kind: 'initial', weight: initial.weight, reps: fill(target.repMin), stalled: false }
      const e1rm = epley(initial.weight, initial.reps)
      const weight = roundWeight(weightForReps(e1rm, target.repMin), rule, 'down')
      return { kind: 'initial', weight, reps: fill(target.repMin), stalled: false, e1rm }
    }
    return { kind: 'probe', weight: fixed ? 0 : null, reps: fill(target.repMin), stalled: false }
  }

  const last = history[0]
  const sets = working(last.sets)
  const top = topWeight(sets)

  // After a probe or a mode change, recompute from the estimated 1RM for the new range.
  if (last.isProbe || !sameRange(last, target)) {
    const e1rm = bestE1rm(sets)
    if (e1rm && !fixed) {
      const weight = roundWeight(weightForReps(e1rm, target.repMin), rule, 'down')
      return { kind: 'convert', weight, reps: fill(target.repMin), stalled: false, e1rm }
    }
    return { kind: 'convert', weight: top, reps: fill(target.repMin), stalled: false }
  }

  const stalled = isStalled(history, target)
  const allTop = sets.every((s) => s.reps >= target.repMax)
  const anyBelow = sets.some((s) => s.reps < target.repMin)

  if (allTop) {
    if (fixed) return { kind: 'top_out', weight: top, reps: fill(target.repMax), stalled }
    const rirs = sets.map((s) => s.rir).filter((r): r is number => r !== undefined)
    const bonus = rirs.length > 0 && Math.min(...rirs) >= target.targetRir[1] + PROGRESSION.rirBonusMargin
    const steps = bonus ? PROGRESSION.rirBonusSteps : 1
    const weight = stepUp(top, rule, steps)
    if (weight <= top + 1e-9) return { kind: 'top_out', weight: top, reps: fill(target.repMax), stalled }
    return { kind: 'increase', weight, reps: fill(target.repMin), stalled, steps }
  }

  if (anyBelow) {
    let misses = 0
    for (const h of chain(history, target)) {
      const ws = working(h.sets)
      if (Math.abs(topWeight(ws) - top) > 1e-9 || !ws.some((s) => s.reps < target.repMin)) break
      misses++
    }
    if (misses >= PROGRESSION.dropAfterMisses && !fixed) {
      return { kind: 'decrease', weight: dropWeight(top, rule, PROGRESSION.dropFactor), reps: fill(target.repMin), stalled }
    }
    return { kind: 'retry', weight: top, reps: fill(target.repMin), stalled }
  }

  const reps = Array.from({ length: target.sets }, (_, i) => {
    const prev = (sets[i] ?? sets[sets.length - 1]).reps
    return Math.min(target.repMax, Math.max(target.repMin, prev + 1))
  })
  return { kind: 'add_reps', weight: top, reps, stalled }
}

export const SUGGESTION_TEXT: Record<SuggestionKind, string> = {
  probe: '探り：軽い重量から少しずつ上げ、あと2〜3回できる重量で止めて記録',
  initial: '入力した記録から換算',
  convert: '推定1RMから今の回数範囲に換算',
  increase: '前回は全セット上限に到達。重量を上げて下限から',
  add_reps: '同じ重量で各セット+1回',
  retry: '下限に届かないセットあり。同じ重量で再挑戦',
  decrease: '2回続けて下限未満。約10%下げる',
  top_out: '回数は上限に到達。加重か難しい種目への変更を検討',
}

export function suggestionText(s: Suggestion): string {
  if (s.kind === 'increase' && (s.steps ?? 1) > 1) return '全セット上限に到達し余力あり。2刻み上げる'
  return SUGGESTION_TEXT[s.kind]
}

export const STALLED_TEXT = '3回続けて伸びなし。種目の差し替えかデロードを検討'

/** Warm-up ladder for a working weight, lightest first */
export function warmupLadder(workWeight: number, count: number, rule: WeightRule): SetRecord[] {
  return WARMUP_SCHEME.slice(0, count).map((w) => ({
    weight: roundWeight(workWeight * w.pct, rule, 'nearest'),
    reps: w.reps,
    isWarmup: true,
  }))
}

/** Newest-first history of one exercise from finished sessions */
export function historyFor(sessions: Session[], exerciseId: string, excludeSessionId?: number): HistoryEntry[] {
  return sessions
    .filter((s) => s.status === 'done' && s.id !== excludeSessionId)
    .sort((a, b) => (a.date === b.date ? b.startedAt - a.startedAt : a.date < b.date ? 1 : -1))
    .flatMap((s) =>
      s.entries
        .filter((e) => e.exerciseId === exerciseId && working(e.sets).length > 0)
        .map((e) => ({ date: s.date, repMin: e.repMin, repMax: e.repMax, isProbe: e.isProbe, sets: e.sets })),
    )
}
