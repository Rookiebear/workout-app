import { describe, expect, it } from 'vitest'
import exercisesJson from '../../data/exercises.json'
import { defaultSettings } from '../config/defaults'
import { estimateSeconds, redistribute, trimToBudget } from './budget'
import { generatePlanDetailed, makeItem } from './generator'
import type { Exercise, PlanItem, Settings } from './types'

const exercises = exercisesJson as Exercise[]
const exMap = new Map(exercises.map((e) => [e.id, e]))
const params = defaultSettings().modeParams.hypertrophy
const item = (id: string, sets?: number): PlanItem => makeItem(exMap.get(id)!, 'hypertrophy', params, sets)
const minutes = (items: PlanItem[]) => estimateSeconds(items) / 60

// 上半身の日：多関節3種目＋単関節3種目（約73分）
const upper = () => [
  item('smith_bench_press'),
  item('machine_lat_pulldown'),
  item('smith_shoulder_press'),
  item('db_lateral_raise'),
  item('db_curl'),
  item('db_skull_crusher'),
]

describe('持ち時間による削減の順番', () => {
  it('持ち時間内なら削らない', () => {
    const r = trimToBudget(upper(), 120, exMap)
    expect(r.cuts).toEqual([])
    expect(r.over).toBe(false)
  })

  it('まず単関節種目のセットを、後ろの種目から削る', () => {
    const before = upper()
    const r = trimToBudget(before, Math.floor(minutes(before)) - 2, exMap)
    expect(r.items.map((i) => i.exerciseId)).toEqual(before.map((i) => i.exerciseId))
    const compound = r.items.filter((i) => exMap.get(i.exerciseId)!.type === 'compound')
    expect(compound.every((i) => i.sets === 3)).toBe(true)
    expect(r.cuts.every((c) => exMap.get(c.item.exerciseId)!.type === 'isolation' && !c.removed)).toBe(true)
    expect(r.items.find((i) => i.exerciseId === 'db_skull_crusher')!.sets).toBe(2)
  })

  it('次に単関節種目そのものを外す。ほかの種目で補われている部位から', () => {
    const r = trimToBudget(upper(), 52, exMap)
    const removed = r.cuts.filter((c) => c.removed).map((c) => c.item.exerciseId)
    expect(removed.length).toBeGreaterThan(0)
    // 三頭はプレス2種目で補われるので、二頭（ラットプルダウンだけ）より先に外れる
    expect(removed[0]).toBe('db_skull_crusher')
    expect(r.items.filter((i) => exMap.get(i.exerciseId)!.type === 'compound')).toHaveLength(3)
  })

  it('最後に多関節種目のセットを削り、メイン種目は最後まで残す', () => {
    const r = trimToBudget(upper(), 45, exMap)
    expect(r.items.every((i) => exMap.get(i.exerciseId)!.type === 'compound')).toBe(true)
    expect(r.items[0].exerciseId).toBe('smith_bench_press')
    expect(r.items.some((i) => i.sets < 3)).toBe(true)
    expect(minutes(r.items)).toBeLessThanOrEqual(45)
  })

  it('それでも超えるときは2種目目以降の準備セットを減らし、次に後ろの多関節種目を外す', () => {
    const r = trimToBudget(upper(), 34, exMap)
    expect(r.items[0]).toMatchObject({ exerciseId: 'smith_bench_press', warmupSets: 2 })
    expect(r.items.slice(1).every((i) => i.warmupSets < 2)).toBe(true)
    expect(r.cuts.find((c) => c.item.exerciseId === 'smith_shoulder_press')?.removed).toBe(true)
    expect(minutes(r.items)).toBeLessThanOrEqual(34)
    expect(r.over).toBe(false)
  })

  it('最初の種目だけになっても超える日は知らせる', () => {
    const r = trimToBudget(upper(), 15, exMap)
    expect(r.over).toBe(true)
    expect(r.items.every((i) => i.sets >= 2)).toBe(true)
  })
})

describe('削った分を週内の他の日に回す', () => {
  it('同じ部位を扱い時間に余裕のある日に回す', () => {
    const a = upper()
    const trimmed = trimToBudget(a, 52, exMap)
    const days = [
      { items: trimmed.items, budgetMin: 52, muscles: ['chest', 'lats', 'front_delt', 'side_delt', 'triceps', 'biceps'] as never },
      { items: [item('db_bench_press'), item('machine_seated_row')], budgetMin: 90, muscles: ['chest', 'upper_back', 'triceps', 'biceps'] as never },
    ]
    const moved = redistribute(days, [trimmed.cuts, []], exMap)
    expect(moved.some((m) => m.exerciseId === 'db_skull_crusher' && m.to === 1)).toBe(true)
    expect(days[1].items.map((i) => i.exerciseId)).toContain('db_skull_crusher')
    expect(minutes(days[1].items)).toBeLessThanOrEqual(90)
  })

  it('その部位を扱わない日には回さない', () => {
    const trimmed = trimToBudget(upper(), 52, exMap)
    const days = [
      { items: trimmed.items, budgetMin: 52, muscles: ['chest', 'triceps'] as never },
      { items: [item('smith_squat')], budgetMin: 120, muscles: ['quads', 'hamstrings', 'glutes', 'calves'] as never },
    ]
    expect(redistribute(days, [trimmed.cuts, []], exMap)).toEqual([])
  })
})

describe('メニュー生成に持ち時間を反映する', () => {
  const base = (patch: Partial<Settings>): Settings => ({ ...defaultSettings(), onboarded: true, weekdays: [1, 2, 4, 5], ...patch })

  it('曜日ごとの持ち時間に収める', () => {
    const s = base({ dayBudgets: { 1: 60, 2: 45, 4: 60, 5: 45 } })
    const r = generatePlanDetailed({ exercises, settings: s, today: '2026-11-26' })
    r.plan.days.forEach((d) => expect(minutes(d.items), d.splitName).toBeLessThanOrEqual(s.dayBudgets[d.weekday]))
    expect(r.over).toEqual([])
  })

  it('余裕のある日には削った分を回す', () => {
    // 上半身Aは短く、上半身Bは長い
    const s = base({ dayBudgets: { 1: 45, 2: 90, 4: 120, 5: 90 } })
    const r = generatePlanDetailed({ exercises, settings: s, today: '2026-11-26' })
    expect(r.cuts[0].length).toBeGreaterThan(0)
    expect(r.moved.some((m) => m.from === 0 && m.to === 2)).toBe(true)
  })
})
