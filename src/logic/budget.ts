// 持ち時間による削減と、削った分の週内への振り替え
import { BUDGET, TIME } from '../config/defaults'
import { primaryMuscles } from './availability'
import type { Exercise, Muscle, PlanItem } from './types'

/** ウォームアップ8分＋各セット（作業40秒＋休憩）＋種目切替2分。準備セットの休憩は60秒 */
export function estimateSeconds(items: PlanItem[]): number {
  if (items.length === 0) return 0
  return (
    TIME.warmupMin * 60 +
    items.reduce(
      (sum, it) =>
        sum +
        TIME.switchMin * 60 +
        it.sets * (TIME.workSec + it.restSec) +
        it.warmupSets * (TIME.workSec + TIME.warmupSetRestSec),
      0,
    )
  )
}

export interface Cut {
  item: PlanItem
  /** 削ったセット数 */
  sets: number
  /** 種目ごと外したか */
  removed: boolean
  /** 減らした準備セットの数 */
  warmups?: number
}

export interface TrimResult {
  items: PlanItem[]
  cuts: Cut[]
  /** 削れるところまで削っても持ち時間を超える */
  over: boolean
}

const isIso = (exMap: Map<string, Exercise>, it: PlanItem) => exMap.get(it.exerciseId)?.type === 'isolation'

/**
 * 持ち時間を超える分を、要件の順に削る：
 *   1. 単関節種目のセット  2. 単関節種目そのもの  3. 多関節種目のセット
 * それでも超えるときは、さらに
 *   4. 2種目目以降の準備セット  5. 後ろの多関節種目（最初の種目は残す）
 * どの段階でも後ろの種目から削るので、最初のメイン種目は最後まで残る。
 */
export function trimToBudget(items: PlanItem[], budgetMin: number, exMap: Map<string, Exercise>): TrimResult {
  const limit = budgetMin * 60
  let list = items.map((it) => ({ ...it }))
  const cuts = new Map<string, Cut>()
  const fits = () => estimateSeconds(list) <= limit
  const cutSet = (it: PlanItem) => {
    it.sets -= 1
    const c = cuts.get(it.exerciseId) ?? { item: { ...it, sets: 0 }, sets: 0, removed: false }
    c.sets += 1
    cuts.set(it.exerciseId, c)
  }
  // 後ろの種目から1セットずつ順番に削る
  const shaveSets = (pick: (it: PlanItem) => boolean) => {
    for (let changed = true; changed && !fits(); ) {
      changed = false
      for (let i = list.length - 1; i >= 0 && !fits(); i--) {
        const it = list[i]
        if (pick(it) && it.sets > BUDGET.minSets) {
          cutSet(it)
          changed = true
        }
      }
    }
  }

  shaveSets((it) => isIso(exMap, it))

  // 単関節種目を外すときは、その部位がほかの種目でいちばん補われているものから。
  // ふくらはぎのように単関節でしか鍛えられない部位は最後まで残る
  const coveredByOthers = (i: number) => {
    const ex = exMap.get(list[i].exerciseId)
    if (!ex) return 0
    const prim = primaryMuscles(ex)
    return list.reduce((sum, other, k) => {
      if (k === i) return sum
      const o = exMap.get(other.exerciseId)
      return sum + prim.reduce((s, m) => s + (o?.muscles[m] ?? 0) * other.sets, 0)
    }, 0)
  }
  while (!fits()) {
    let pick = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (isIso(exMap, list[i]) && (pick < 0 || coveredByOthers(i) > coveredByOthers(pick))) pick = i
    }
    if (pick < 0) break
    const it = list[pick]
    const c = cuts.get(it.exerciseId) ?? { item: { ...it, sets: 0 }, sets: 0, removed: false }
    c.sets += it.sets
    c.removed = true
    cuts.set(it.exerciseId, c)
    list = list.filter((_, k) => k !== pick)
  }

  shaveSets((it) => !isIso(exMap, it))

  // 4. 2種目目以降の準備セット。最初の種目で体は温まっている
  for (let changed = true; changed && !fits(); ) {
    changed = false
    for (let i = list.length - 1; i >= 1 && !fits(); i--) {
      const it = list[i]
      if (it.warmupSets > 0) {
        it.warmupSets -= 1
        const c = cuts.get(it.exerciseId) ?? { item: { ...it, sets: 0 }, sets: 0, removed: false }
        c.warmups = (c.warmups ?? 0) + 1
        cuts.set(it.exerciseId, c)
        changed = true
      }
    }
  }

  // 5. 後ろの多関節種目を外す
  while (!fits() && list.length > 1) {
    const it = list[list.length - 1]
    const c = cuts.get(it.exerciseId) ?? { item: { ...it, sets: 0 }, sets: 0, removed: false }
    c.sets += it.sets
    c.removed = true
    cuts.set(it.exerciseId, c)
    list = list.slice(0, -1)
  }

  return { items: list, cuts: [...cuts.values()], over: !fits() }
}

export interface BudgetDay {
  items: PlanItem[]
  budgetMin: number
  /** この日に扱う部位 */
  muscles: Muscle[]
}

export interface Moved {
  exerciseId: string
  sets: number
  from: number
  to: number
}

/** 削った分を、同じ部位を扱い時間に余裕のある日へ回す */
export function redistribute(days: BudgetDay[], cutsByDay: Cut[][], exMap: Map<string, Exercise>): Moved[] {
  const moved: Moved[] = []
  const original = days.map((d) => new Map(d.items.map((it) => [it.exerciseId, it.sets])))
  const slack = (i: number) => days[i].budgetMin * 60 - estimateSeconds(days[i].items)

  cutsByDay.forEach((cuts, from) => {
    for (const cut of cuts) {
      const ex = exMap.get(cut.item.exerciseId)
      if (!ex) continue
      const prim = primaryMuscles(ex)
      let left = cut.sets
      const targets = days
        .map((_, i) => i)
        .filter((i) => i !== from && prim.every((m) => days[i].muscles.includes(m)))
        .sort((a, b) => slack(b) - slack(a))
      for (const to of targets) {
        if (left <= 0) break
        const day = days[to]
        // 同じ種目、なければ同じ役割の種目（同じ動作の多関節／同じ主働筋の単関節）にセットを足す
        const sameRole = (it: PlanItem) => {
          const other = exMap.get(it.exerciseId)
          if (!other) return false
          if (ex.type === 'compound') return other.type === 'compound' && other.pattern === ex.pattern
          return other.type === 'isolation' && primaryMuscles(other).some((m) => prim.includes(m))
        }
        const receiver = day.items.find((it) => it.exerciseId === ex.id) ?? day.items.find(sameRole)
        if (receiver) {
          const cap = (original[to].get(receiver.exerciseId) ?? receiver.sets) + BUDGET.maxExtraSets
          let add = Math.min(left, cap - receiver.sets)
          while (add > 0) {
            receiver.sets += add
            if (slack(to) >= 0) break
            receiver.sets -= add
            add--
          }
          if (add > 0) {
            left -= add
            moved.push({ exerciseId: receiver.exerciseId, sets: add, from, to })
          }
          continue
        }
        if (left < BUDGET.minSets) continue
        for (let add = left; add >= BUDGET.minSets; add--) {
          const item = { ...cut.item, sets: add }
          day.items.push(item)
          if (slack(to) >= 0) {
            left -= add
            moved.push({ exerciseId: ex.id, sets: add, from, to })
            break
          }
          day.items.pop()
        }
      }
    }
  })
  return moved
}
