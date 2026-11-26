import { INCREMENT, PLATES } from '../config/defaults'
import type { Exercise, Settings } from './types'

export type WeightRule =
  | { kind: 'step'; step: number; min: number }
  | { kind: 'list'; values: number[] }

export const r2 = (x: number) => Math.round(x * 100) / 100

export function weightRuleFor(ex: Exercise, settings: Pick<Settings, 'dumbbellWeights' | 'smithBarWeight'>): WeightRule {
  const eq = ex.equipment
  if (eq.includes('smith')) {
    return { kind: 'step', step: ex.increment ?? INCREMENT.smith, min: settings.smithBarWeight }
  }
  if (eq.includes('machine_upper') || eq.includes('machine_lower')) {
    return { kind: 'step', step: ex.increment ?? INCREMENT.machine, min: 0 }
  }
  if (eq.includes('dumbbell')) {
    if (ex.increment) return { kind: 'step', step: ex.increment, min: 0 }
    const values = [...settings.dumbbellWeights].filter((w) => w > 0).sort((a, b) => a - b)
    return values.length ? { kind: 'list', values } : { kind: 'step', step: INCREMENT.dumbbellStep, min: 0 }
  }
  return { kind: 'step', step: ex.increment ?? INCREMENT.bodyweight, min: 0 }
}

/** True when the load cannot change, e.g. a bodyweight exercise without added weight */
export function isFixedLoad(rule: WeightRule): boolean {
  return rule.kind === 'step' && rule.step <= 0
}

export function roundWeight(w: number, rule: WeightRule, dir: 'down' | 'nearest' | 'up' = 'nearest'): number {
  if (rule.kind === 'list') {
    const v = rule.values
    if (dir === 'down') {
      const below = v.filter((x) => x <= w + 1e-9)
      return below.length ? below[below.length - 1] : v[0]
    }
    if (dir === 'up') {
      const above = v.find((x) => x >= w - 1e-9)
      return above ?? v[v.length - 1]
    }
    return v.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), v[0])
  }
  if (rule.step <= 0) return r2(Math.max(rule.min, w))
  const q = w / rule.step
  const n = dir === 'down' ? Math.floor(q + 1e-9) : dir === 'up' ? Math.ceil(q - 1e-9) : Math.round(q)
  return r2(Math.max(rule.min, n * rule.step))
}

export function stepUp(w: number, rule: WeightRule, steps = 1): number {
  if (rule.kind === 'list') {
    const i = rule.values.findIndex((x) => x > w + 1e-9)
    if (i < 0) return rule.values[rule.values.length - 1]
    return rule.values[Math.min(rule.values.length - 1, i + steps - 1)]
  }
  return r2(roundWeight(w, rule, 'nearest') + rule.step * steps)
}

export function stepDown(w: number, rule: WeightRule): number {
  if (rule.kind === 'list') {
    const below = rule.values.filter((x) => x < w - 1e-9)
    return below.length ? below[below.length - 1] : rule.values[0]
  }
  return r2(Math.max(rule.min, w - rule.step))
}

/** Drop to about `factor` of the weight, rounded to the rule, and always at least one step lighter */
export function dropWeight(w: number, rule: WeightRule, factor: number): number {
  const target = roundWeight(w * factor, rule, 'nearest')
  if (target < w - 1e-9) return target
  return stepDown(w, rule)
}

/** Plates per side for a bar loaded to `total` kg */
export function platesPerSide(total: number, bar: number, plates: number[] = PLATES): { plates: number[]; remainder: number } {
  let side = r2((total - bar) / 2)
  const out: number[] = []
  if (side <= 0) return { plates: out, remainder: 0 }
  for (const p of plates) {
    while (side >= p - 1e-9) {
      out.push(p)
      side = r2(side - p)
    }
  }
  return { plates: out, remainder: side }
}

export function formatKg(w: number): string {
  return Number.isInteger(w) ? String(w) : String(r2(w))
}
