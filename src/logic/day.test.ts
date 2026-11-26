import { describe, expect, it } from 'vitest'
import exercisesJson from '../../data/exercises.json'
import { defaultSettings } from '../config/defaults'
import { estimateSeconds } from './budget'
import { prepareDay, prescribeItem, type DayContext } from './day'
import { makeItem } from './generator'
import type { Adjust, Exercise, Pain, Session, Settings } from './types'

const exercises = exercisesJson as Exercise[]
const exMap = new Map(exercises.map((e) => [e.id, e]))
const params = defaultSettings().modeParams.hypertrophy
const item = (id: string) => makeItem(exMap.get(id)!, 'hypertrophy', params)
const today = '2026-11-26'

function session(date: string, exerciseId: string, weight: number, reps: number[], adjust?: Adjust[]): Session {
  return {
    id: Math.floor(Math.random() * 1e9),
    date,
    startedAt: 0,
    status: 'done',
    splitName: '上半身A',
    mode: 'hypertrophy',
    note: '',
    entries: [
      {
        exerciseId,
        role: 'main',
        repMin: 6,
        repMax: 10,
        targetRir: [1, 2],
        restSec: 150,
        plannedSets: reps.length,
        warmupSets: 0,
        adjust,
        sets: reps.map((r) => ({ weight, reps: r, isWarmup: false })),
      },
    ],
  }
}

const ctx = (patch: Omit<Partial<DayContext>, 'settings'> & { settings?: Partial<Settings> } = {}): DayContext => ({
  exercises,
  exMap,
  pains: [],
  sessions: [],
  today,
  ...patch,
  settings: { ...defaultSettings(), onboarded: true, ...patch.settings },
})
const pain = (joint: Pain['joint'], level: Pain['level']): Pain => ({ joint, side: 'right', level, startDate: '2026-11-25' })
const day = () => [item('smith_bench_press'), item('machine_lat_pulldown'), item('db_lateral_raise')]

describe('1日のメニューを今日の状態に合わせる', () => {
  it('調整がなければそのまま', () => {
    const r = prepareDay(day(), ctx())
    expect(r.items.map((i) => [i.exerciseId, i.sets])).toEqual(day().map((i) => [i.exerciseId, i.sets]))
    expect(r.items.every((i) => i.adjust.length === 0)).toBe(true)
  })

  it('軽い痛みでは負担の低い種目に置き換える', () => {
    const r = prepareDay(day(), ctx({ pains: [pain('shoulder', 'light')] }))
    expect(r.replaced).toEqual([{ from: 'smith_bench_press', to: 'db_bench_press', joint: 'shoulder' }])
    expect(r.items[0].exerciseId).toBe('db_bench_press')
  })

  it('中程度の痛みでは負担2以上を外し、負担1は軽くする', () => {
    const r = prepareDay(day(), ctx({ pains: [pain('shoulder', 'moderate')] }))
    expect(r.excluded.map((x) => x.exerciseId)).toEqual(['smith_bench_press'])
    const pulldown = r.items.find((i) => i.exerciseId === 'machine_lat_pulldown')!
    expect(pulldown.adjust[0]).toMatchObject({ kind: 'pain', weightFactor: 0.8 })
  })

  it('強い痛みは受診を促す関節として返す', () => {
    expect(prepareDay(day(), ctx({ pains: [pain('knee', 'severe')] })).severe).toEqual(['knee'])
  })

  it('デロード中はセット数50%、提案重量90%', () => {
    const c = ctx({
      settings: { deload: { start: '2026-11-24', end: '2026-11-30' } },
      sessions: [session('2026-11-20', 'smith_bench_press', 60, [8, 8, 8])],
    })
    const r = prepareDay(day(), c)
    expect(r.items[0].sets).toBe(2)
    const p = prescribeItem(exMap.get('smith_bench_press')!, r.items[0], r.items[0].adjust, c)
    expect(p.base.weight).toBe(60)
    expect(p.suggestion.weight).toBe(52.5)
  })

  it('1–3か月ぶりの種目はセット70%・重量80%', () => {
    const c = ctx({ sessions: [session('2026-10-01', 'smith_bench_press', 60, [8, 8, 8])] })
    const r = prepareDay(day(), c)
    expect(r.items[0].sets).toBe(2) // 3 × 0.7 = 2.1
    expect(prescribeItem(exMap.get('smith_bench_press')!, r.items[0], r.items[0].adjust, c).suggestion.weight).toBe(47.5)
  })

  it('軽くした記録は次の重量提案に使わない', () => {
    const c = ctx({
      sessions: [
        session('2026-11-24', 'smith_bench_press', 50, [10, 10], [{ kind: 'deload', label: '', weightFactor: 0.9 }]),
        session('2026-11-17', 'smith_bench_press', 60, [8, 8, 8]),
      ],
    })
    const p = prescribeItem(exMap.get('smith_bench_press')!, item('smith_bench_press'), [], c)
    expect(p.history.map((h) => h.date)).toEqual(['2026-11-17'])
    expect(p.suggestion).toMatchObject({ kind: 'add_reps', weight: 60 })
  })

  it('当日の持ち時間に合わせて削る', () => {
    const items = day()
    const r = prepareDay(items, ctx(), 35)
    expect(r.trimmed.length).toBeGreaterThan(0)
    expect(estimateSeconds(r.items) / 60).toBeLessThanOrEqual(35)
  })
})
