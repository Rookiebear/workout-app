import { describe, expect, it } from 'vitest'
import exercisesJson from '../../data/exercises.json'
import { MUSCLES, defaultSettings } from '../config/defaults'
import { isAvailable } from './availability'
import { estimateMinutes, generatePlan, swapCandidates, volumeWarnings, weeklyFrequency } from './generator'
import type { Exercise, Muscle, Settings } from './types'

const exercises = exercisesJson as Exercise[]
const exMap = new Map(exercises.map((e) => [e.id, e]))
const today = '2026-11-26'
const WEEKDAYS: Record<number, number[]> = {
  1: [3],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
}
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), onboarded: true, ...patch })
const trained = MUSCLES.map((m) => m.id).filter((m) => m !== 'abs') as Muscle[]

describe('種目マスタ', () => {
  it('各部位に主働筋の種目が3つ以上ある', () => {
    for (const m of trained) {
      const n = exercises.filter((e) => (e.muscles[m] ?? 0) >= 1).length
      expect(n, m).toBeGreaterThanOrEqual(3)
    }
  })

  it('筋力モードのメイン種目は初期値の4種目', () => {
    expect(exercises.filter((e) => e.isMainLift).map((e) => e.id).sort()).toEqual(
      ['smith_bench_press', 'smith_rdl', 'smith_shoulder_press', 'smith_squat'],
    )
  })
})

describe('分割法', () => {
  it.each([
    [1, ['全身']],
    [2, ['全身A', '全身B']],
    [3, ['全身A', '全身B', '全身C']],
    [4, ['上半身A', '下半身A', '上半身B', '下半身B']],
    [5, ['上半身', '下半身', 'プッシュ', 'プル', '脚']],
    [6, ['プッシュA', 'プルA', '脚A', 'プッシュB', 'プルB', '脚B']],
  ])('週%i日', (n, names) => {
    const plan = generatePlan({ exercises, settings: settings({ weekdays: WEEKDAYS[n] }), today })
    expect(plan.days.map((d) => d.splitName)).toEqual(names)
    expect(plan.days.map((d) => d.weekday)).toEqual(WEEKDAYS[n])
  })

  it.each([2, 3, 4, 5, 6])('週%i日なら各部位を週2回以上刺激する', (n) => {
    const plan = generatePlan({ exercises, settings: settings({ weekdays: WEEKDAYS[n] }), today })
    const freq = weeklyFrequency(plan, exMap)
    for (const m of trained) expect(freq.get(m) ?? 0, m).toBeGreaterThanOrEqual(2)
  })

  it('日曜始まりの指定でも月曜から順に並べる', () => {
    const plan = generatePlan({ exercises, settings: settings({ weekdays: [0, 2, 4] }), today })
    expect(plan.days.map((d) => d.weekday)).toEqual([2, 4, 0])
  })
})

describe('種目の選び方', () => {
  const plan = generatePlan({ exercises, settings: settings({ weekdays: WEEKDAYS[4] }), today })

  it('同じ動作パターンの多関節種目は1日1種目まで', () => {
    for (const d of plan.days) {
      const patterns = d.items.map((i) => exMap.get(i.exerciseId)!).filter((e) => e.type === 'compound').map((e) => e.pattern)
      expect(new Set(patterns).size).toBe(patterns.length)
    }
  })

  it('多関節種目 → 単関節種目の順に並ぶ', () => {
    for (const d of plan.days) {
      const types = d.items.map((i) => exMap.get(i.exerciseId)!.type)
      const firstIso = types.indexOf('isolation')
      if (firstIso >= 0) expect(types.slice(firstIso)).not.toContain('compound')
    }
  })

  it('器具OFFの種目は使わない', () => {
    const s = settings({ weekdays: WEEKDAYS[3], equipmentEnabled: { ...defaultSettings().equipmentEnabled, smith: false } })
    const p = generatePlan({ exercises, settings: s, today })
    const used = p.days.flatMap((d) => d.items.map((i) => exMap.get(i.exerciseId)!))
    expect(used.some((e) => e.equipment.includes('smith'))).toBe(false)
  })

  it('除外は種目単位・動作パターン単位で効き、期限を過ぎたら戻る', () => {
    const bench = exMap.get('smith_bench_press')!
    const s1 = settings({ exclusions: [{ target: 'smith_bench_press', type: 'exercise' }] })
    expect(isAvailable(bench, s1, today)).toBe(false)
    const s2 = settings({ exclusions: [{ target: 'hinge', type: 'pattern', until: '2026-12-01' }] })
    expect(isAvailable(exMap.get('smith_rdl')!, s2, today)).toBe(false)
    expect(isAvailable(exMap.get('smith_rdl')!, s2, '2026-12-02')).toBe(true)
    const p = generatePlan({ exercises, settings: { ...s2, weekdays: WEEKDAYS[4] }, today })
    const patterns = p.days.flatMap((d) => d.items.map((i) => exMap.get(i.exerciseId)!.pattern))
    expect(patterns).not.toContain('hinge')
  })

  it('使えないマシンは使わない', () => {
    const s = settings({ weekdays: WEEKDAYS[4], unavailableExercises: ['machine_lat_pulldown'] })
    const p = generatePlan({ exercises, settings: s, today })
    expect(p.days.flatMap((d) => d.items.map((i) => i.exerciseId))).not.toContain('machine_lat_pulldown')
  })

  it('お気に入りを優先する', () => {
    const s = settings({ weekdays: WEEKDAYS[4], favorites: ['machine_chest_press'] })
    const p = generatePlan({ exercises, settings: s, today })
    const upper = p.days.filter((d) => d.splitKey === 'upper')
    for (const d of upper) expect(d.items.map((i) => i.exerciseId)).toContain('machine_chest_press')
  })

  it('前回のプランと同じ種目を優先する', () => {
    const s = settings({ weekdays: WEEKDAYS[4] })
    const previous = structuredCopy(plan)
    const day = previous.days[0]
    const idx = day.items.findIndex((i) => exMap.get(i.exerciseId)!.pattern === 'horizontal_push')
    day.items[idx] = { ...day.items[idx], exerciseId: 'db_bench_press' }
    const p = generatePlan({ exercises, settings: s, today, previous })
    expect(p.days[0].items.map((i) => i.exerciseId)).toContain('db_bench_press')
  })

  it('筋力モードはメイン種目を選び、4セット・3–6回にする', () => {
    const s = settings({ mode: 'strength', weekdays: WEEKDAYS[4] })
    const p = generatePlan({ exercises, settings: s, today })
    const ids = p.days.flatMap((d) => d.items.map((i) => i.exerciseId))
    for (const id of ['smith_squat', 'smith_bench_press', 'smith_rdl', 'smith_shoulder_press']) expect(ids).toContain(id)
    const squat = p.days.flatMap((d) => d.items).find((i) => i.exerciseId === 'smith_squat')!
    expect([squat.sets, squat.repMin, squat.repMax, squat.warmupSets]).toEqual([4, 3, 6, 3])
  })

  it('メイン種目にはウォームアップセットが付き、単関節には付かない', () => {
    for (const d of plan.days) {
      expect(d.items[0].warmupSets).toBeGreaterThanOrEqual(2)
      for (const it of d.items) if (exMap.get(it.exerciseId)!.type === 'isolation') expect(it.warmupSets).toBe(0)
    }
  })

  it('同じ主働筋の2種目目にはウォームアップを付けない', () => {
    const lower = plan.days.find((d) => d.splitKey === 'lower')!
    const quadCompounds = lower.items.filter((i) => (exMap.get(i.exerciseId)!.muscles.quads ?? 0) >= 1 && exMap.get(i.exerciseId)!.type === 'compound')
    expect(quadCompounds.length).toBeGreaterThanOrEqual(2)
    expect(quadCompounds[0].warmupSets).toBeGreaterThan(0)
    expect(quadCompounds[1].warmupSets).toBe(0)
  })
})

describe('集計と警告', () => {
  it('目標の下限を下回る部位を警告する', () => {
    const s = settings({ weekdays: WEEKDAYS[1] })
    const p = generatePlan({ exercises, settings: s, today })
    const warnings = volumeWarnings(p, exMap, s)
    expect(warnings.length).toBeGreaterThan(0)
    for (const w of warnings) expect(w.sets).toBeLessThan(10)
  })

  it('週4日の筋肥大は主要部位の下限を満たす', () => {
    const s = settings({ weekdays: WEEKDAYS[4] })
    const p = generatePlan({ exercises, settings: s, today })
    const warned = volumeWarnings(p, exMap, s).map((w) => w.muscle)
    for (const m of ['chest', 'lats', 'quads', 'hamstrings'] as Muscle[]) expect(warned).not.toContain(m)
  })
})

describe('所要時間', () => {
  it('ウォームアップ8分＋各セット（40秒＋休憩）＋種目切替2分', () => {
    const minutes = estimateMinutes([
      { exerciseId: 'a', role: 'main', sets: 3, warmupSets: 2, repMin: 6, repMax: 10, targetRir: [1, 2], restSec: 140 },
    ])
    // 8 + (120 + 3 × 180 + 2 × 100) / 60 = 8 + 14.33
    expect(minutes).toBe(22)
  })
})

describe('差し替え候補', () => {
  it('同じ主働筋の種目を、同じ動作パターンから先に並べる', () => {
    const bench = exMap.get('smith_bench_press')!
    const c = swapCandidates(bench, exercises, settings(), today)
    expect(c[0].pattern).toBe('horizontal_push')
    expect(c.map((e) => e.id)).toContain('machine_pec_fly')
    expect(c.map((e) => e.id)).not.toContain('smith_bench_press')
  })
})

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}
