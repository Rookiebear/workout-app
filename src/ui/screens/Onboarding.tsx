import { useState } from 'preact/hooks'
import { DEFAULT_DAY_BUDGET, DEFAULT_DUMBBELL_MAX, EQUIPMENT, INCREMENT, MODE_LABEL, MODE_POLICY, SPLIT_SUMMARY, dumbbellRange } from '../../config/defaults'
import { regeneratePlan, updateSettings } from '../../db/db'
import { isMachine } from '../../logic/availability'
import type { Mode, Settings } from '../../logic/types'
import { Segmented, Stepper, Switch } from '../components'
import { go, todayISO, useData } from '../hooks'
import { WeekdayPicker } from './shared'

export function Onboarding() {
  const { settings, exercises } = useData()
  const [draft, setDraft] = useState<Settings>(settings)
  const [dbMax, setDbMax] = useState(Math.max(...settings.dumbbellWeights, DEFAULT_DUMBBELL_MAX))
  const [budget, setBudget] = useState(DEFAULT_DAY_BUDGET)
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }))
  const machines = exercises.filter(isMachine)

  const finish = async () => {
    const dayBudgets = Object.fromEntries(draft.weekdays.map((d) => [d, budget]))
    await updateSettings({ ...draft, dayBudgets, dumbbellWeights: dumbbellRange(INCREMENT.dumbbellStep, dbMax), onboarded: true })
    await regeneratePlan(todayISO())
    go('today', true)
  }

  return (
    <div class="page bare stack-16">
      <div>
        <p class="eyebrow">はじめに</p>
        <h1>週のメニューを作ります</h1>
        <p class="meta" style={{ marginTop: '8px' }}>
          目的、通う曜日、ジムの器具から分割法と種目を決めます。あとから設定でいつでも変えられます
        </p>
      </div>

      <section class="section stack-8">
        <h2>目的</h2>
        <Segmented<Mode>
          label="目的"
          value={draft.mode}
          options={(['hypertrophy', 'strength', 'cut'] as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          onChange={(mode) => set({ mode })}
        />
        <p class="meta">{MODE_POLICY[draft.mode]}</p>
      </section>

      <section class="section stack-8">
        <h2>通う曜日</h2>
        <WeekdayPicker value={draft.weekdays} onChange={(weekdays) => set({ weekdays })} />
        <p class="meta">
          週{draft.weekdays.length}日 · {SPLIT_SUMMARY[draft.weekdays.length] ?? '1日以上選んでください'}
        </p>
      </section>

      <section class="section stack-8">
        <h2>1回の持ち時間</h2>
        <Stepper label="1回の持ち時間" unit="分" value={budget} step={5} min={15} onChange={setBudget} />
        <p class="meta">ウォームアップ込み。この時間に収まるようにメニューを組みます。曜日ごとの変更は設定から</p>
      </section>

      <section class="section stack-8">
        <h2>器具</h2>
        <div class="list">
          {EQUIPMENT.map((e) => (
            <div class="field-row">
              <span>{e.label}</span>
              <Switch
                label={e.label}
                checked={draft.equipmentEnabled[e.id]}
                onChange={(v) => set({ equipmentEnabled: { ...draft.equipmentEnabled, [e.id]: v } })}
              />
            </div>
          ))}
        </div>
      </section>

      <section class="section stack-8">
        <div class="section-head">
          <h2>使えるマシン</h2>
          <span class="meta">ないものを外す</span>
        </div>
        <div class="list">
          {machines.map((ex) => {
            const on = !draft.unavailableExercises.includes(ex.id)
            return (
              <div class="field-row">
                <span>{ex.name}</span>
                <Switch
                  label={ex.name}
                  checked={on}
                  onChange={(v) =>
                    set({
                      unavailableExercises: v
                        ? draft.unavailableExercises.filter((id) => id !== ex.id)
                        : [...draft.unavailableExercises, ex.id],
                    })
                  }
                />
              </div>
            )
          })}
        </div>
      </section>

      <section class="section stack-12">
        <h2>重量</h2>
        <div class="field">
          <span class="label">スミスマシンのバー重量</span>
          <Stepper label="バー重量" unit="kg" value={draft.smithBarWeight} step={0.5} decimals onChange={(v) => set({ smithBarWeight: v })} />
        </div>
        <div class="field">
          <span class="label">ダンベルの最大重量（片手・2kg刻み）</span>
          <Stepper label="ダンベル最大重量" unit="kg" value={dbMax} step={2} min={2} onChange={setDbMax} />
        </div>
      </section>

      <button class="btn primary big" style={{ marginTop: '32px' }} disabled={draft.weekdays.length === 0} onClick={finish}>
        メニューを作る
      </button>
    </div>
  )
}
