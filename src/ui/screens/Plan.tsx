import { ChevronRight, Plus, RefreshCw } from 'lucide-preact'
import { useState } from 'preact/hooks'
import { DEFAULT_DAY_BUDGET, MODE_LABEL, MUSCLES, SPLIT_SUMMARY, WEEKDAY_LABEL } from '../../config/defaults'
import { regeneratePlan, savePlan } from '../../db/db'
import { estimateMinutes, makeItem, swapCandidates, volumeWarnings, weeklyTally } from '../../logic/generator'
import type { Muscle, PlanItem } from '../../logic/types'
import { ICON, Sheet, Stepper } from '../components'
import { todayISO, toast, useData } from '../hooks'
import { restLabel } from '../workout'
import { ExercisePicker } from './shared'

export function PlanScreen() {
  const data = useData()
  const { plan, settings, exMap } = data
  const [selected, setSelected] = useState<{ day: number; item: number } | undefined>()
  const [mode, setMode] = useState<'actions' | 'swap' | 'add'>('actions')
  const [addDay, setAddDay] = useState<number | undefined>()

  if (!plan) {
    return (
      <div class="page">
        <h1>週のメニュー</h1>
        <button class="btn primary big" style={{ marginTop: '24px' }} onClick={() => regeneratePlan(todayISO())}>
          メニューを作る
        </button>
      </div>
    )
  }

  const tally = weeklyTally(plan, exMap)
  const params = settings.modeParams[plan.mode]
  const { min, max } = params.weeklySets
  const low = new Set(volumeWarnings(plan, exMap, settings).map((w) => w.muscle))
  const muscles = MUSCLES.filter((m) => m.id !== 'abs' || settings.includeAbs)
  const scaleMax = Math.max(max + 4, ...[...tally.values()])

  const updateDay = (dayIndex: number, items: PlanItem[]) =>
    savePlan({ ...plan, days: plan.days.map((d, i) => (i === dayIndex ? { ...d, items } : d)) })

  const sel = selected && plan.days[selected.day]?.items[selected.item]
  const selEx = sel && exMap.get(sel.exerciseId)
  const close = () => {
    setSelected(undefined)
    setMode('actions')
  }

  return (
    <div class="page">
      <p class="eyebrow">
        {MODE_LABEL[plan.mode]} · 週{plan.days.length}日 · {SPLIT_SUMMARY[plan.days.length]}
      </p>
      <h1 style={{ marginTop: '2px' }}>週のメニュー</h1>

      <section class="section">
        <div class="section-head">
          <h2>部位別の週セット数</h2>
          <span class="meta num">目標 {min}–{max}</span>
        </div>
        <div class="list">
          {muscles.map((m) => {
            const v = tally.get(m.id as Muscle) ?? 0
            const isLow = low.has(m.id as Muscle)
            return (
              <div class="vol" style={{ padding: '8px 16px' }}>
                <span class="lbl">{m.short}</span>
                <span class="track" aria-hidden="true">
                  <span class="band" style={{ left: `${(min / scaleMax) * 100}%`, width: `${((max - min) / scaleMax) * 100}%` }} />
                  <span class={`fill${isLow ? ' low' : ''}`} style={{ width: `${Math.min(100, (v / scaleMax) * 100)}%` }} />
                </span>
                <span class={`val${isLow ? ' low' : ''}`}>{Number.isInteger(v) ? v : v.toFixed(1)}</span>
              </div>
            )
          })}
        </div>
        {low.size > 0 && (
          <p class="meta" style={{ marginTop: '8px' }}>
            赤い部位は目標の下限を下回っています。種目の追加かセット数で補えます
          </p>
        )}
        {plan.days.length === 1 && <p class="meta" style={{ marginTop: '8px' }}>週1日は各部位週1回の維持目的です</p>}
      </section>

      {plan.days.map((day, di) => (
        <section class="section">
          <div class="section-head">
            <h2>
              <span class="muted" style={{ fontWeight: 400 }}>
                {WEEKDAY_LABEL[day.weekday]}
              </span>{' '}
              {day.splitName}
            </h2>
            <span class={`meta num${estimateMinutes(day.items) > (settings.dayBudgets[day.weekday] ?? DEFAULT_DAY_BUDGET) ? ' neg' : ''}`}>
              約{estimateMinutes(day.items)}分 / {settings.dayBudgets[day.weekday] ?? DEFAULT_DAY_BUDGET}分
            </span>
          </div>
          <div class="list">
            {day.items.map((it, ii) => {
              const ex = exMap.get(it.exerciseId)
              return (
                <button class="row" onClick={() => setSelected({ day: di, item: ii })}>
                  <span class="grow">
                    <span class="title ellipsis" style={{ display: 'block' }}>{ex?.name ?? it.exerciseId}</span>
                    <span class="sub num">
                      {it.sets}セット × {it.repMin}–{it.repMax}回 · 休憩{restLabel(it.restSec)}
                      {it.warmupSets ? ` · W${it.warmupSets}` : ''}
                    </span>
                  </span>
                  <ChevronRight {...ICON} class="chev" />
                </button>
              )
            })}
            <button class="row" onClick={() => setAddDay(di)}>
              <Plus {...ICON} class="muted" />
              <span class="grow meta">種目を追加</span>
            </button>
          </div>
        </section>
      ))}

      <section class="section">
        <button
          class="btn block"
          onClick={async () => {
            if (!confirm('いまの設定でメニューを作り直します。今のメニューの種目を優先して残します')) return
            await regeneratePlan(todayISO())
            toast('メニューを作り直しました')
          }}
        >
          <RefreshCw {...ICON} />
          メニューを作り直す
        </button>
      </section>

      <Sheet open={!!sel && mode === 'actions'} onClose={close} title={selEx?.name}>
        {sel && selected && (
          <div class="stack-12">
            <div class="field">
              <span class="label">セット数</span>
              <Stepper
                label="セット数"
                value={sel.sets}
                step={1}
                min={1}
                max={10}
                onChange={(v) =>
                  updateDay(
                    selected.day,
                    plan.days[selected.day].items.map((it, i) => (i === selected.item ? { ...it, sets: v } : it)),
                  )
                }
              />
            </div>
            <button class="btn block" onClick={() => setMode('swap')}>
              差し替える
            </button>
            <button
              class="btn block danger"
              onClick={async () => {
                await updateDay(selected.day, plan.days[selected.day].items.filter((_, i) => i !== selected.item))
                close()
              }}
            >
              この日から外す
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!sel && mode === 'swap'} onClose={close} title={selEx ? `${selEx.name}の代わり` : ''}>
        {selEx && selected && (
          <ExercisePicker
            candidates={swapCandidates(selEx, data.exercises, settings, todayISO()).filter(
              (c) => !plan.days[selected.day].items.some((it) => it.exerciseId === c.id),
            )}
            onPick={async (ex) => {
              await updateDay(
                selected.day,
                plan.days[selected.day].items.map((it, i) =>
                  i === selected.item ? makeItem(ex, plan.mode, settings.modeParams[plan.mode]) : it,
                ),
              )
              close()
            }}
          />
        )}
      </Sheet>

      <Sheet open={addDay !== undefined} onClose={() => setAddDay(undefined)} title="種目を追加">
        {addDay !== undefined && (
          <ExercisePicker
            exclude={plan.days[addDay].items.map((it) => it.exerciseId)}
            onPick={async (ex) => {
              await updateDay(addDay, [...plan.days[addDay].items, makeItem(ex, plan.mode, settings.modeParams[plan.mode])])
              setAddDay(undefined)
            }}
          />
        )}
      </Sheet>
    </div>
  )
}
