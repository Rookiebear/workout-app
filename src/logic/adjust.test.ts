import { describe, expect, it } from 'vitest'
import exercisesJson from '../../data/exercises.json'
import {
  activePains,
  adjustRir,
  adjustSets,
  applyWeightAdjusts,
  deloadAdjust,
  deloadAdvice,
  globalGap,
  lastBreakEnd,
  painAction,
  painReplacement,
  releaseAdjust,
  returnAdjust,
} from './adjust'
import type { Suggestion } from './progression'
import type { Exercise, Pain } from './types'
import type { WeightRule } from './weights'

const exercises = exercisesJson as Exercise[]
const ex = (id: string) => exercises.find((e) => e.id === id)!
const pain = (joint: Pain['joint'], level: Pain['level'], extra: Partial<Pain> = {}): Pain => ({
  joint,
  side: 'both',
  level,
  startDate: '2026-11-20',
  ...extra,
})
const smith: WeightRule = { kind: 'step', step: 2.5, min: 15 }
const base: Suggestion = { kind: 'add_reps', weight: 60, reps: [8, 8, 8], stalled: false }

describe('痛みの判定表', () => {
  // スミスベンチ：肩2・肘1・手首1
  const bench = ex('smith_bench_press')

  it('軽い：負担2以上の種目は、同じ主働筋で負担が低い種目に置換', () => {
    const p = [pain('shoulder', 'light')]
    const a = painAction(bench, p)
    expect(a.action).toBe('replace')
    const r = painReplacement(bench, exercises, p, 'shoulder')!
    expect(r.muscles.chest).toBe(1)
    expect(r.jointStress.shoulder ?? 0).toBeLessThan(2)
    expect(r.pattern).toBe('horizontal_push')
  })

  it('軽い：置換できない種目は重量80%・RIR+1', () => {
    // スカルクラッシャー（肘3）。三頭の種目はどれも肘に負担がある
    const p = [pain('elbow', 'light')]
    const skull = ex('db_skull_crusher')
    const a = painAction(skull, p)
    expect(a.action).toBe('replace')
    const onlyHeavy = exercises.filter((e) => (e.jointStress.elbow ?? 0) >= 2 || e.id === skull.id)
    expect(painReplacement(skull, onlyHeavy, p, 'elbow')).toBeUndefined()
    if (a.action !== 'replace') throw new Error()
    expect(a.fallback.weightFactor).toBe(0.8)
    expect(a.fallback.rirPlus).toBe(1)
  })

  it('軽い：負担1以下の種目はそのまま', () => {
    expect(painAction(bench, [pain('elbow', 'light')]).action).toBe('ok')
  })

  it('中程度：負担2以上の種目を除外', () => {
    expect(painAction(bench, [pain('shoulder', 'moderate')]).action).toBe('exclude')
  })

  it('中程度：負担1の種目は重量80%', () => {
    const a = painAction(bench, [pain('wrist', 'moderate')])
    expect(a.action).toBe('lighten')
    if (a.action !== 'lighten') throw new Error()
    expect(a.adjust.weightFactor).toBe(0.8)
    expect(a.adjust.rirPlus).toBeUndefined()
  })

  it('強い：その関節に負担が1以上の種目をすべて除外', () => {
    expect(painAction(bench, [pain('wrist', 'severe')]).action).toBe('exclude')
    expect(painAction(ex('smith_squat'), [pain('wrist', 'severe')]).action).toBe('ok')
  })

  it('左右は記録するが判定は共通', () => {
    expect(painAction(bench, [pain('shoulder', 'moderate', { side: 'left' })]).action).toBe('exclude')
  })

  it('複数の痛みは強い方を取る', () => {
    expect(painAction(bench, [pain('wrist', 'moderate'), pain('shoulder', 'severe')]).action).toBe('exclude')
  })

  it('解除後の初回は重量90%から再開し、実施後は通常に戻る', () => {
    const p = [pain('shoulder', 'moderate', { endDate: '2026-11-25' })]
    expect(activePains(p, '2026-11-26')).toEqual([])
    expect(releaseAdjust(bench, p, '2026-11-18', '2026-11-26')?.weightFactor).toBe(0.9)
    expect(releaseAdjust(bench, p, '2026-11-26', '2026-11-27')).toBeUndefined()
    expect(releaseAdjust(ex('smith_squat'), p, '2026-11-18', '2026-11-26')).toBeUndefined()
  })
})

describe('ブランク復帰の判定表', () => {
  const today = '2026-11-26'

  it('2週未満：そのまま', () => {
    expect(returnAdjust(['2026-11-13'], today)).toBeUndefined()
  })

  it('2–4週：重量90%・セット80%', () => {
    const a = returnAdjust(['2026-11-05'], today)!
    expect([a.weightFactor, a.setsFactor]).toEqual([0.9, 0.8])
  })

  it('2–4週：1回実施したら通常に戻す', () => {
    expect(returnAdjust(['2026-11-24', '2026-11-05'], today)).toBeUndefined()
  })

  it('1–3か月：重量80%・セット70%', () => {
    const a = returnAdjust(['2026-10-01'], today)!
    expect([a.weightFactor, a.setsFactor]).toEqual([0.8, 0.7])
  })

  it('1–3か月：2週間かけて段階的に戻す', () => {
    // 11/19 に復帰（その前は 10/01）。7日経って半分戻る
    const mid = returnAdjust(['2026-11-19', '2026-10-01'], today)!
    expect(mid.weightFactor).toBeCloseTo(0.9)
    expect(mid.setsFactor).toBeCloseTo(0.85)
    // 11/10 に復帰し、その後も週1で続けて2週間が過ぎた
    expect(returnAdjust(['2026-11-24', '2026-11-17', '2026-11-10', '2026-10-01'], today)).toBeUndefined()
  })

  it('3か月以上：探り扱い・セット60%', () => {
    const a = returnAdjust(['2026-08-01'], today)!
    expect(a.probe).toBe(true)
    expect(a.setsFactor).toBe(0.6)
  })

  it('全体で2週以上空いたら復帰プランを確認する', () => {
    expect(globalGap('2026-11-10', today)).toBe('2026-11-10')
    expect(globalGap('2026-11-20', today)).toBeUndefined()
  })

  it('復帰プランを断った空白には調整を掛けない', () => {
    expect(returnAdjust(['2026-11-05'], today, '2026-11-05')).toBeUndefined()
  })
})

describe('デロード', () => {
  const settings = {}

  it('6週たったら提案する', () => {
    expect(deloadAdvice({ today: '2026-11-26', settings, firstSessionDate: '2026-10-15', stalled: 0, total: 10 })).toEqual({
      due: true,
      reason: 'weeks',
      weeks: 6,
    })
    expect(deloadAdvice({ today: '2026-11-26', settings, firstSessionDate: '2026-10-20', stalled: 0, total: 10 }).due).toBe(false)
  })

  it('伸びなしの種目が3分の1を超えたら提案する', () => {
    expect(deloadAdvice({ today: '2026-11-26', settings, firstSessionDate: '2026-11-01', stalled: 4, total: 10 }).reason).toBe('stall')
    expect(deloadAdvice({ today: '2026-11-26', settings, firstSessionDate: '2026-11-01', stalled: 3, total: 9 }).due).toBe(false)
  })

  it('2週以上の空白は休養とみなし、明けた日から数え直す', () => {
    expect(lastBreakEnd(['2026-10-01'], '2026-11-26')).toBe('2026-11-26')
    expect(lastBreakEnd(['2026-11-24', '2026-11-17', '2026-11-10', '2026-11-03', '2026-09-01'], '2026-11-26')).toBe('2026-11-03')
    const first = lastBreakEnd(['2026-10-01'], '2026-11-26')
    expect(deloadAdvice({ today: '2026-11-26', settings, firstSessionDate: first, stalled: 0, total: 10 }).due).toBe(false)
  })

  it('前回のデロードから数える', () => {
    const s = { lastDeloadEnd: '2026-11-10' }
    expect(deloadAdvice({ today: '2026-11-26', settings: s, firstSessionDate: '2026-08-01', stalled: 0, total: 10 }).due).toBe(false)
  })

  it('見送ったら1週間は出さない。デロード中も出さない', () => {
    const args = { today: '2026-11-26', firstSessionDate: '2026-08-01', stalled: 0, total: 10 }
    expect(deloadAdvice({ ...args, settings: { deloadSnoozeUntil: '2026-11-30' } }).due).toBe(false)
    expect(deloadAdvice({ ...args, settings: { deload: { start: '2026-11-24', end: '2026-11-30' } } }).due).toBe(false)
  })

  it('1週間、セット数50%・重量90%', () => {
    const d = deloadAdjust()
    expect(adjustSets(4, [d])).toBe(2)
    expect(applyWeightAdjusts(base, [d], smith).weight).toBe(52.5) // 54 → 刻みに切り捨て
  })
})

describe('調整の掛け合わせ', () => {
  it('重量は掛け合わせて刻みに切り捨て、RIRは足し合わせる', () => {
    const adj = [
      { kind: 'pain' as const, label: '', weightFactor: 0.8, rirPlus: 1 },
      { kind: 'deload' as const, label: '', weightFactor: 0.9 },
    ]
    expect(applyWeightAdjusts(base, adj, smith).weight).toBe(42.5) // 60 × 0.72 = 43.2
    expect(adjustRir([1, 2], adj)).toEqual([2, 3])
  })

  it('セット数は四捨五入で1以上', () => {
    expect(adjustSets(3, [{ kind: 'return', label: '', setsFactor: 0.8 }])).toBe(2)
    expect(adjustSets(1, [{ kind: 'return', label: '', setsFactor: 0.6 }])).toBe(1)
  })

  it('探りに戻す調整があれば重量は未定', () => {
    expect(applyWeightAdjusts(base, [{ kind: 'return', label: '', probe: true }], smith)).toMatchObject({ kind: 'probe', weight: null })
  })
})
