// 保存データと純粋なロジックをつなぐ。複数の画面から使う
import { MUSCLES, PATTERN_LABEL } from '../config/defaults'
import { db } from '../db/db'
import { primaryMuscles } from '../logic/availability'
import { adjustsFor, finalizeItem, prescribeItem, type DayContext, type Prescription, type PreparedItem } from '../logic/day'
import { makeItem } from '../logic/generator'
import { working } from '../logic/progression'
import type { Adjust, Exercise, PlanItem, Session, SessionEntry, SetRecord } from '../logic/types'
import { formatKg } from '../logic/weights'
import type { AppData } from './hooks'

export type { Prescription }

export function dayContext(data: AppData, today: string, excludeSessionId?: number): DayContext {
  return {
    exercises: data.exercises,
    exMap: data.exMap,
    settings: data.settings,
    pains: data.pains,
    sessions: data.sessions,
    today,
    excludeSessionId,
  }
}

type Prescribable = (PlanItem & { adjust?: Adjust[] }) | SessionEntry

/** 重量・回数の提案。調整済みのセット数・RIRと、重量への調整をそのまま使う */
export function prescribe(data: AppData, item: Prescribable, excludeSessionId?: number): Prescription | undefined {
  const ex = data.exMap.get(item.exerciseId)
  if (!ex) return undefined
  const sets = 'plannedSets' in item ? item.plannedSets : item.sets
  return prescribeItem(ex, { ...item, sets }, item.adjust ?? [], {
    sessions: data.sessions,
    settings: data.settings,
    excludeSessionId,
  })
}

export function entryFromItem(item: PreparedItem, isProbe: boolean): SessionEntry {
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
    adjust: item.adjust.length ? item.adjust : undefined,
    sets: [],
  }
}

/** セッション中に足す・差し替える種目。今日の調整（復帰・痛み・デロード）も掛ける */
export function entryForExercise(ex: Exercise, data: AppData, today: string, painAdjust?: Adjust): SessionEntry {
  const s = data.settings
  const item = finalizeItem(makeItem(ex, s.mode, s.modeParams[s.mode]), adjustsFor(ex, dayContext(data, today), painAdjust))
  const p = prescribe(data, item)
  return entryFromItem(item, p?.suggestion.kind === 'probe')
}

export async function startSession(
  data: AppData,
  day: { splitName: string; items: PreparedItem[] },
  dayIndex: number,
  date: string,
  budget?: number,
): Promise<number> {
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

/** 調整の短い表示。例：「デロード・重量90%」 */
export function adjustLabel(adjust: Adjust[] | undefined): string {
  if (!adjust?.length) return ''
  return adjust
    .map((a) => {
      const parts = [a.label]
      if (a.probe) parts.push('探りから')
      else if (a.weightFactor && a.weightFactor < 1) parts.push(`重量${Math.round(a.weightFactor * 100)}%`)
      if (a.rirPlus) parts.push(`RIR+${a.rirPlus}`)
      return parts.join('・')
    })
    .join(' / ')
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
