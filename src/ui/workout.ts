// Glue between stored data and the pure logic, used by several screens.
import { MUSCLES, PATTERN_LABEL } from '../config/defaults'
import { db } from '../db/db'
import { primaryMuscles } from '../logic/availability'
import { makeItem } from '../logic/generator'
import { historyFor, suggestNext, warmupLadder, working, type HistoryEntry, type Suggestion } from '../logic/progression'
import type { Exercise, PlanDay, PlanItem, Session, SessionEntry, SetRecord, Settings } from '../logic/types'
import { formatKg, weightRuleFor, type WeightRule } from '../logic/weights'
import type { AppData } from './hooks'

export interface Prescription {
  ex: Exercise
  rule: WeightRule
  suggestion: Suggestion
  history: HistoryEntry[]
  warmups: SetRecord[]
}

export function prescribe(data: AppData, item: PlanItem | SessionEntry, excludeSessionId?: number): Prescription | undefined {
  const ex = data.exMap.get(item.exerciseId)
  if (!ex) return undefined
  const rule = weightRuleFor(ex, data.settings)
  const history = historyFor(data.sessions, ex.id, excludeSessionId)
  const suggestion = suggestNext({
    history,
    target: { repMin: item.repMin, repMax: item.repMax, sets: 'plannedSets' in item ? item.plannedSets : item.sets, targetRir: item.targetRir },
    rule,
    initial: data.settings.initialRecords[ex.id],
  })
  const warmups = suggestion.weight ? warmupLadder(suggestion.weight, item.warmupSets, rule) : []
  return { ex, rule, suggestion, history, warmups }
}

export function entryFromItem(item: PlanItem, isProbe: boolean): SessionEntry {
  return {
    exerciseId: item.exerciseId,
    role: item.role,
    repMin: item.repMin,
    repMax: item.repMax,
    targetRir: item.targetRir,
    restSec: item.restSec,
    plannedSets: item.sets,
    warmupSets: isProbe ? 0 : item.warmupSets,
    isProbe: isProbe || undefined,
    sets: [],
  }
}

export function entryForExercise(ex: Exercise, settings: Settings, data: AppData): SessionEntry {
  const item = makeItem(ex, settings.mode, settings.modeParams[settings.mode])
  const p = prescribe(data, item)
  return entryFromItem(item, p?.suggestion.kind === 'probe')
}

export async function startSession(data: AppData, day: PlanDay, dayIndex: number, date: string, budget?: number): Promise<number> {
  const entries = day.items.map((it) => entryFromItem(it, prescribe(data, it)?.suggestion.kind === 'probe'))
  const session: Session = {
    date,
    startedAt: Date.now(),
    status: 'active',
    planId: data.plan?.id,
    planDayIndex: dayIndex,
    splitName: day.splitName,
    mode: data.settings.mode,
    timeBudgetMin: budget,
    note: '',
    entries,
  }
  return db.sessions.add(session)
}

export function formatSets(sets: SetRecord[]): string {
  const w = working(sets)
  if (!w.length) return ''
  const sameWeight = w.every((s) => s.weight === w[0].weight)
  if (sameWeight) return `${formatKg(w[0].weight)} kg × ${w.map((s) => s.reps).join(', ')}`
  return w.map((s) => `${formatKg(s.weight)}×${s.reps}`).join(', ')
}

export function formatReps(reps: number[]): string {
  return reps.every((r) => r === reps[0]) ? String(reps[0] ?? '') : reps.join(', ')
}

export function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

export function muscleLabel(ex: Exercise): string {
  return primaryMuscles(ex)
    .map((m) => MUSCLES.find((x) => x.id === m)?.short ?? m)
    .join('・')
}

export function exerciseMeta(ex: Exercise): string {
  return `${muscleLabel(ex)} · ${PATTERN_LABEL[ex.pattern]}`
}

export function restLabel(sec: number): string {
  if (sec < 60) return `${sec}秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}分${s}秒` : `${m}分`
}

export function weightUnit(ex: Exercise): string {
  return ex.equipment.includes('dumbbell') && !ex.equipment.includes('smith') ? 'kg 片手' : 'kg'
}

export function isSmith(ex: Exercise) {
  return ex.equipment.includes('smith')
}
