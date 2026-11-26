import {
  ABS_SPLITS,
  DEFAULT_DAY_BUDGET,
  GENERATOR,
  MUSCLE_PRIORITY,
  SPLITS,
  SPLIT_MUSCLES,
  WARMUP_SETS,
  WEEKDAY_ORDER,
} from '../config/defaults'
import { activePains, painAction } from './adjust'
import { isAvailable, primaryMuscles } from './availability'
import { estimateSeconds, redistribute, trimToBudget, type Moved, type Cut } from './budget'
import { weekStartOf } from './dates'
import type { Exercise, Mode, ModeParams, Muscle, Pain, Plan, PlanDay, PlanItem, Role, Settings, SplitKey } from './types'

export function roleFor(ex: Exercise, mode: Mode): Role {
  if (mode === 'strength') return ex.isMainLift ? 'main' : 'accessory'
  return ex.type === 'compound' ? 'main' : 'accessory'
}

export function makeItem(ex: Exercise, mode: Mode, params: ModeParams, sets?: number): PlanItem {
  const role = roleFor(ex, mode)
  const [repMin, repMax] = role === 'main' ? params.mainRep : params.accRep
  return {
    exerciseId: ex.id,
    role,
    sets: sets ?? (role === 'main' ? params.setsMain : params.setsAcc),
    warmupSets: role === 'main' ? WARMUP_SETS[mode] : 0,
    repMin,
    repMax,
    targetRir: [...params.targetRir] as [number, number],
    restSec: ex.type === 'compound' ? params.restCompoundSec : params.restIsolationSec,
  }
}

export function dayMuscles(key: SplitKey, includeAbs: boolean): Muscle[] {
  const base = SPLIT_MUSCLES[key]
  return includeAbs && ABS_SPLITS.includes(key) ? [...base, 'abs'] : base
}

export function sortWeekdays(weekdays: number[]): number[] {
  return WEEKDAY_ORDER.filter((d) => weekdays.includes(d))
}

export interface GenerateInput {
  exercises: Exercise[]
  settings: Settings
  today: string
  previous?: Plan
  pains?: Pain[]
}

export interface GenerateResult {
  plan: Plan
  /** 持ち時間に合わせて削った分（日ごと） */
  cuts: Cut[][]
  /** 他の日に回した分 */
  moved: Moved[]
  /** 削っても持ち時間を超える日 */
  over: number[]
}

export function generatePlan(input: GenerateInput): Plan {
  return generatePlanDetailed(input).plan
}

export function generatePlanDetailed({ exercises, settings, today, previous, pains = [] }: GenerateInput): GenerateResult {
  const mode = settings.mode
  const params = settings.modeParams[mode]
  const weekdays = sortWeekdays(settings.weekdays).slice(0, 6)
  const split = SPLITS[Math.max(1, weekdays.length)] ?? SPLITS[1]
  // 手順1：器具OFF・除外・痛みで「強い」に当たる種目を外す
  const severe = activePains(pains, today).filter((p) => p.level === 'severe')
  const pool = exercises.filter((e) => isAvailable(e, settings, today) && painAction(e, severe).action !== 'exclude')
  const exMap = new Map(exercises.map((e) => [e.id, e]))
  const order = new Map(exercises.map((e, i) => [e.id, i]))
  const favorites = new Set(settings.favorites)

  // How many days hit each muscle, to split the weekly target evenly.
  const freq = new Map<Muscle, number>()
  split.forEach((d) => dayMuscles(d.key, settings.includeAbs).forEach((m) => freq.set(m, (freq.get(m) ?? 0) + 1)))

  const usedThisWeek = new Set<string>()
  const days: PlanDay[] = []

  split.forEach((slot, dayIndex) => {
    const weekday = weekdays[dayIndex] ?? WEEKDAY_ORDER[dayIndex]
    const muscles = dayMuscles(slot.key, settings.includeAbs)
    const remaining = new Map<Muscle, number>()
    for (const m of muscles) {
      const perDay = Math.ceil(params.weeklySets.target / (freq.get(m) ?? 1))
      remaining.set(m, Math.min(GENERATOR.maxSetsPerMusclePerDay, perDay))
    }
    const prevDay = previous?.days.find((d) => d.splitName === slot.name) ?? previous?.days[dayIndex]
    const prevIds = new Set(prevDay && prevDay.splitKey === slot.key ? prevDay.items.map((i) => i.exerciseId) : [])

    const picked: { ex: Exercise; sets: number }[] = []
    const usedPatterns = new Set<string>()
    const usedIsoPrimary = new Set<Muscle>()

    const coverage = (ex: Exercise, sets: number) =>
      (Object.keys(ex.muscles) as Muscle[]).reduce(
        (sum, m) => sum + Math.min(Math.max(0, remaining.get(m) ?? 0), (ex.muscles[m] ?? 0) * sets),
        0,
      )

    const rank = (ex: Exercise, compound: boolean, sets: number): number[] => [
      compound && mode === 'strength' && ex.isMainLift ? 0 : 1,
      favorites.has(ex.id) ? 0 : 1,
      prevIds.has(ex.id) ? 0 : 1,
      usedThisWeek.has(ex.id) && !(mode === 'strength' && ex.isMainLift) ? 1 : 0,
      -coverage(ex, sets),
      order.get(ex.id) ?? 0,
    ]
    const better = (a: number[], b: number[]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
      return false
    }

    const apply = (ex: Exercise, sets: number) => {
      picked.push({ ex, sets })
      for (const m of Object.keys(ex.muscles) as Muscle[]) {
        if (remaining.has(m)) remaining.set(m, (remaining.get(m) ?? 0) - (ex.muscles[m] ?? 0) * sets)
      }
    }

    const neediest = (gap: number) =>
      [...remaining.entries()]
        .filter(([, v]) => v >= gap)
        .sort((a, b) => b[1] - a[1] || MUSCLE_PRIORITY.indexOf(a[0]) - MUSCLE_PRIORITY.indexOf(b[0]))
        .map(([m]) => m)

    const fill = (compound: boolean) => {
      const gap = compound ? GENERATOR.compoundMinGap : GENERATOR.isolationMinGap
      for (;;) {
        if (picked.length >= GENERATOR.maxExercisesPerDay) return
        let chosen: { ex: Exercise; sets: number; m: Muscle } | undefined
        for (const m of neediest(gap)) {
          let best: { ex: Exercise; sets: number; key: number[] } | undefined
          for (const ex of pool) {
            if ((ex.type === 'compound') !== compound) continue
            if (picked.some((p) => p.ex.id === ex.id)) continue
            if (!primaryMuscles(ex).includes(m)) continue
            if (compound ? usedPatterns.has(ex.pattern) : primaryMuscles(ex).some((p) => usedIsoPrimary.has(p))) continue
            const base = makeItem(ex, mode, params).sets
            const sets = compound
              ? base
              : Math.max(GENERATOR.minSetsPerExercise, Math.min(base, Math.ceil(remaining.get(m) ?? 0)))
            const key = rank(ex, compound, sets)
            if (!best || better(key, best.key)) best = { ex, sets, key }
          }
          if (best) {
            chosen = { ex: best.ex, sets: best.sets, m }
            break
          }
        }
        if (!chosen) return
        apply(chosen.ex, chosen.sets)
        if (compound) usedPatterns.add(chosen.ex.pattern)
        else primaryMuscles(chosen.ex).forEach((p) => usedIsoPrimary.add(p))
      }
    }

    fill(true)
    fill(false)

    const items = sortItems(
      picked.map((p) => makeItem(p.ex, mode, params, p.sets)),
      exMap,
    )

    // Warm-up sets go on a main lift only while its primary muscles are still cold.
    const warmed = new Set<Muscle>()
    for (const item of items) {
      const prim = primaryMuscles(exMap.get(item.exerciseId)!)
      if (item.warmupSets > 0 && prim.every((m) => warmed.has(m))) item.warmupSets = 0
      prim.forEach((m) => warmed.add(m))
    }

    picked.forEach((p) => usedThisWeek.add(p.ex.id))
    days.push({ weekday, splitKey: slot.key, splitName: slot.name, items })
  })

  // 手順6：持ち時間を超える日は削り、削った分は余裕のある日に回す
  const budgets = days.map((d) => settings.dayBudgets[d.weekday] ?? DEFAULT_DAY_BUDGET)
  const trims = days.map((d, i) => trimToBudget(d.items, budgets[i], exMap))
  const bdays = days.map((d, i) => ({
    items: trims[i].items,
    budgetMin: budgets[i],
    muscles: dayMuscles(d.splitKey, settings.includeAbs),
  }))
  const moved = redistribute(bdays, trims.map((t) => t.cuts), exMap)
  days.forEach((d, i) => (d.items = sortItems(bdays[i].items, exMap)))
  const over = days.map((d, i) => (estimateSeconds(d.items) > budgets[i] * 60 ? i : -1)).filter((i) => i >= 0)

  return {
    plan: { createdAt: today, weekStart: weekStartOf(today), mode, days },
    cuts: trims.map((t) => t.cuts),
    moved,
    over,
  }
}

/** メイン → 多関節 → 単関節。同じ並びの中では元の順 */
export function sortItems(items: PlanItem[], exMap: Map<string, Exercise>): PlanItem[] {
  return items
    .map((item, i) => ({ item, i, ex: exMap.get(item.exerciseId) }))
    .sort(
      (a, b) =>
        (a.item.role === 'main' ? 0 : 1) - (b.item.role === 'main' ? 0 : 1) ||
        (a.ex?.isMainLift ? 0 : 1) - (b.ex?.isMainLift ? 0 : 1) ||
        (a.ex?.type === 'compound' ? 0 : 1) - (b.ex?.type === 'compound' ? 0 : 1) ||
        a.i - b.i,
    )
    .map((x) => x.item)
}

/** Effective weekly sets per muscle: Σ coefficient × sets */
export function weeklyTally(plan: Plan, exMap: Map<string, Exercise>): Map<Muscle, number> {
  const out = new Map<Muscle, number>()
  for (const d of plan.days)
    for (const it of d.items) {
      const ex = exMap.get(it.exerciseId)
      if (!ex) continue
      for (const m of Object.keys(ex.muscles) as Muscle[]) out.set(m, (out.get(m) ?? 0) + (ex.muscles[m] ?? 0) * it.sets)
    }
  return out
}

/** Days per week on which a muscle is worked at all */
export function weeklyFrequency(plan: Plan, exMap: Map<string, Exercise>): Map<Muscle, number> {
  const out = new Map<Muscle, number>()
  for (const d of plan.days) {
    const hit = new Set<Muscle>()
    for (const it of d.items) {
      const ex = exMap.get(it.exerciseId)
      if (ex) (Object.keys(ex.muscles) as Muscle[]).forEach((m) => (ex.muscles[m] ?? 0) > 0 && hit.add(m))
    }
    hit.forEach((m) => out.set(m, (out.get(m) ?? 0) + 1))
  }
  return out
}

export interface VolumeWarning {
  muscle: Muscle
  sets: number
  min: number
}

export function volumeWarnings(plan: Plan, exMap: Map<string, Exercise>, settings: Settings): VolumeWarning[] {
  const tally = weeklyTally(plan, exMap)
  const min = settings.modeParams[plan.mode].weeklySets.min
  const muscles = MUSCLE_PRIORITY.filter((m) => m !== 'abs' || settings.includeAbs)
  return muscles
    .map((m) => ({ muscle: m, sets: tally.get(m) ?? 0, min }))
    .filter((w) => w.sets < w.min)
}

/** Minutes: warm-up 8 + each set (work 40 s + rest) + 2 per exercise; warm-up sets rest 60 s */
export function estimateMinutes(items: PlanItem[]): number {
  return Math.round(estimateSeconds(items) / 60)
}

/** Alternatives for a swap: shares a primary muscle, same movement pattern listed first */
export function swapCandidates(ex: Exercise, all: Exercise[], settings: Settings, today: string): Exercise[] {
  const prim = primaryMuscles(ex)
  const favorites = new Set(settings.favorites)
  return all
    .filter((c) => c.id !== ex.id && isAvailable(c, settings, today))
    .filter((c) => primaryMuscles(c).some((m) => prim.includes(m)) || (c.pattern === ex.pattern && c.pattern !== 'isolation'))
    .sort(
      (a, b) =>
        (a.pattern === ex.pattern ? 0 : 1) - (b.pattern === ex.pattern ? 0 : 1) ||
        (favorites.has(a.id) ? 0 : 1) - (favorites.has(b.id) ? 0 : 1),
    )
}
