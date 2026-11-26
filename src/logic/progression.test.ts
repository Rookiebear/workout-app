import { describe, expect, it } from 'vitest'
import { epley, bestE1rm, weightForReps } from './oneRm'
import { historyFor, isStalled, suggestNext, warmupLadder, type HistoryEntry, type Target } from './progression'
import type { Session, SetRecord } from './types'
import { dropWeight, platesPerSide, roundWeight, stepUp, type WeightRule } from './weights'

const smith: WeightRule = { kind: 'step', step: 2.5, min: 15 }
const dumbbell: WeightRule = { kind: 'list', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] }
const bodyweight: WeightRule = { kind: 'step', step: 0, min: 0 }
const target: Target = { repMin: 6, repMax: 10, sets: 3, targetRir: [1, 2] }

const sets = (weight: number, reps: number[], rir?: number[]): SetRecord[] =>
  reps.map((r, i) => ({ weight, reps: r, rir: rir?.[i], isWarmup: false }))
const entry = (date: string, weight: number, reps: number[], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  date,
  repMin: 6,
  repMax: 10,
  sets: sets(weight, reps),
  ...extra,
})

describe('判定表：前回の結果 → 次回の提案', () => {
  it('全セットが上限に届いた → 重量を increment 分上げ、回数は下限から', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 60, [10, 10, 10])], target, rule: smith })
    expect(s.kind).toBe('increase')
    expect(s.weight).toBe(62.5)
    expect(s.reps).toEqual([6, 6, 6])
  })

  it('範囲内だが上限未達 → 同じ重量で各セット+1回', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 60, [9, 8, 7])], target, rule: smith })
    expect(s.kind).toBe('add_reps')
    expect(s.weight).toBe(60)
    expect(s.reps).toEqual([10, 9, 8])
  })

  it('1セットでも下限を下回った → 同じ重量で再挑戦', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 60, [8, 7, 5])], target, rule: smith })
    expect(s.kind).toBe('retry')
    expect(s.weight).toBe(60)
    expect(s.reps).toEqual([6, 6, 6])
  })

  it('2回連続で下限を下回った → 重量を約10%下げ、刻みに丸める', () => {
    const history = [entry('2026-11-23', 60, [7, 6, 5]), entry('2026-11-20', 60, [8, 6, 5])]
    const s = suggestNext({ history, target, rule: smith })
    expect(s.kind).toBe('decrease')
    expect(s.weight).toBe(55) // 54 → 55 on a 2.5 kg step
  })

  it('下限割れが別の重量なら連続とみなさない', () => {
    const history = [entry('2026-11-23', 62.5, [7, 6, 5]), entry('2026-11-20', 60, [8, 6, 5])]
    expect(suggestNext({ history, target, rule: smith }).kind).toBe('retry')
  })

  it('3回連続で伸びなし → 差し替えかデロードを提案する印が付く', () => {
    const history = [
      entry('2026-11-26', 60, [8, 7, 7]),
      entry('2026-11-23', 60, [8, 7, 7]),
      entry('2026-11-20', 60, [8, 8, 6]),
      entry('2026-11-17', 60, [8, 8, 7]),
    ]
    expect(isStalled(history, target)).toBe(true)
    expect(suggestNext({ history, target, rule: smith }).stalled).toBe(true)
  })

  it('途中で1回でも伸びていれば伸びなしにしない', () => {
    const history = [
      entry('2026-11-26', 60, [8, 7, 7]),
      entry('2026-11-23', 60, [8, 8, 7]),
      entry('2026-11-20', 60, [8, 7, 7]),
      entry('2026-11-17', 60, [8, 7, 7]),
    ]
    expect(isStalled(history, target)).toBe(false)
  })
})

describe('RIR', () => {
  it('上限到達かつRIRが目標+2以上なら2刻み上げる', () => {
    const history: HistoryEntry[] = [{ date: '2026-11-20', repMin: 6, repMax: 10, sets: sets(60, [10, 10, 10], [4, 4, 5]) }]
    const s = suggestNext({ history, target, rule: smith })
    expect(s.weight).toBe(65)
    expect(s.steps).toBe(2)
  })

  it('RIRが目標+2未満なら1刻み', () => {
    const history: HistoryEntry[] = [{ date: '2026-11-20', repMin: 6, repMax: 10, sets: sets(60, [10, 10, 10], [3, 4, 4]) }]
    expect(suggestNext({ history, target, rule: smith }).weight).toBe(62.5)
  })
})

describe('丸めと器具', () => {
  it('ダンベルは手持ちの重量リストで次の重さへ', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 12, [10, 10, 10])], target, rule: dumbbell })
    expect(s.weight).toBe(14)
  })

  it('ダンベルの10%減はリストの近い重さに丸め、必ず軽くする', () => {
    expect(dropWeight(12, dumbbell, 0.9)).toBe(10)
    expect(dropWeight(4, dumbbell, 0.9)).toBe(2)
  })

  it('ダンベルの最大重量で上限到達したら回数以外で伸ばす提案', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 20, [10, 10, 10])], target, rule: dumbbell })
    expect(s.kind).toBe('top_out')
  })

  it('自重種目は重量を変えず、上限到達を知らせる', () => {
    const s = suggestNext({ history: [entry('2026-11-20', 0, [10, 10, 10])], target, rule: bodyweight })
    expect(s.kind).toBe('top_out')
    expect(s.weight).toBe(0)
  })

  it('スミスはバー重量より軽くしない', () => {
    expect(roundWeight(10, smith, 'down')).toBe(15)
    expect(stepUp(15, smith)).toBe(17.5)
  })

  it('片側のプレートを重い順に並べる', () => {
    expect(platesPerSide(62.5, 15)).toEqual({ plates: [20, 2.5, 1.25], remainder: 0 })
    expect(platesPerSide(15, 15)).toEqual({ plates: [], remainder: 0 })
  })
})

describe('推定1RM（Epley）', () => {
  it('1RM = w × (1 + r / 30)', () => {
    expect(epley(60, 10)).toBeCloseTo(80)
    expect(weightForReps(80, 10)).toBeCloseTo(60)
  })

  it('10回を超えるセットと準備セットは使わない', () => {
    const s: SetRecord[] = [
      { weight: 40, reps: 15, isWarmup: false },
      { weight: 60, reps: 5, isWarmup: false },
      { weight: 80, reps: 3, isWarmup: true },
    ]
    expect(bestE1rm(s)).toBeCloseTo(70)
  })
})

describe('初期重量とモード切替', () => {
  it('分かる種目は重量×回数から換算する', () => {
    const s = suggestNext({ history: [], target, rule: smith, initial: { weight: 60, reps: 10 } })
    expect(s.kind).toBe('initial')
    // 1RM 80 → 6 reps: 80 / 1.2 = 66.7 → 65
    expect(s.weight).toBe(65)
  })

  it('分からない種目は探りにする', () => {
    const s = suggestNext({ history: [], target, rule: smith })
    expect(s.kind).toBe('probe')
    expect(s.weight).toBeNull()
  })

  it('探りの記録を起点にする', () => {
    const history = [entry('2026-11-20', 50, [8], { isProbe: true })]
    const s = suggestNext({ history, target, rule: smith })
    expect(s.kind).toBe('convert')
    // 50 × (1 + 8/30) = 63.3 → 6 reps: 52.8 → 52.5
    expect(s.weight).toBe(52.5)
  })

  it('回数範囲が変わったら推定1RMから計算し直す', () => {
    const strength: Target = { repMin: 3, repMax: 6, sets: 4, targetRir: [2, 3] }
    const s = suggestNext({ history: [entry('2026-11-20', 60, [10, 10, 9])], target: strength, rule: smith })
    expect(s.kind).toBe('convert')
    // 1RM 80 → 3 reps: 72.7 → 72.5
    expect(s.weight).toBe(72.5)
    expect(s.reps).toHaveLength(4)
  })
})

describe('補助', () => {
  it('ウォームアップを作業重量の割合で並べる', () => {
    expect(warmupLadder(60, 2, smith).map((s) => [s.weight, s.reps])).toEqual([
      [30, 8],
      [42.5, 4],
    ])
  })

  it('完了したセッションだけを新しい順に集める', () => {
    const mk = (id: number, date: string, status: Session['status'], startedAt = 0): Session => ({
      id,
      date,
      startedAt,
      status,
      splitName: '全身A',
      mode: 'hypertrophy',
      note: '',
      entries: [
        { exerciseId: 'x', role: 'main', repMin: 6, repMax: 10, targetRir: [1, 2], restSec: 150, plannedSets: 3, warmupSets: 0, sets: sets(id, [8]) },
      ],
    })
    const h = historyFor([mk(1, '2026-11-01', 'done'), mk(2, '2026-11-08', 'done'), mk(3, '2026-11-09', 'active')], 'x')
    expect(h.map((e) => e.sets[0].weight)).toEqual([2, 1])
  })
})
