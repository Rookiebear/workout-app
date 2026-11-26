import { Play, TriangleAlert } from 'lucide-preact'
import { useState } from 'preact/hooks'
import { MODE_LABEL, DEFAULT_DAY_BUDGET, WEEKDAY_LABEL, WEEKDAY_ORDER } from '../../config/defaults'
import { regeneratePlan, updateSettings } from '../../db/db'
import { weekdayOf } from '../../logic/dates'
import { estimateMinutes } from '../../logic/generator'
import { STALLED_TEXT, suggestionText, working } from '../../logic/progression'
import type { PlanItem } from '../../logic/types'
import { formatKg } from '../../logic/weights'
import { ICON, PlateStack, RepLadder, Stepper } from '../components'
import { go, todayISO, useData, type AppData } from '../hooks'
import { formatReps, formatSets, formatShortDate, isSmith, prescribe, restLabel, startSession, weightUnit } from '../workout'

function pickDefaultDay(days: { weekday: number }[], today: number): number {
  const exact = days.findIndex((d) => d.weekday === today)
  if (exact >= 0) return exact
  const pos = WEEKDAY_ORDER.indexOf(today)
  for (let k = 1; k <= 7; k++) {
    const wd = WEEKDAY_ORDER[(pos + k) % 7]
    const i = days.findIndex((d) => d.weekday === wd)
    if (i >= 0) return i
  }
  return 0
}

export function Today() {
  const data = useData()
  const { plan, settings } = data
  const today = todayISO()
  const wd = weekdayOf(today)
  const [m, d] = today.split('-').slice(1).map(Number)
  const active = data.sessions.find((s) => s.status === 'active')
  const [picked, setPicked] = useState<number | undefined>(undefined)

  if (!plan || plan.days.length === 0) {
    return (
      <div class="page">
        <p class="eyebrow">{`${m}月${d}日（${WEEKDAY_LABEL[wd]}）`}</p>
        <h1>メニューがありません</h1>
        <button class="btn primary big" style={{ marginTop: '24px' }} onClick={() => regeneratePlan(today)}>
          メニューを作る
        </button>
      </div>
    )
  }

  const dayIndex = picked ?? pickDefaultDay(plan.days, wd)
  const day = plan.days[dayIndex]
  const isToday = day.weekday === wd
  const minutes = estimateMinutes(day.items)
  const budget = settings.dayBudgets[day.weekday] ?? DEFAULT_DAY_BUDGET
  const [first, ...rest] = day.items

  const start = async () => {
    await startSession(data, day, dayIndex, today, budget)
    go('session')
  }

  return (
    <div class="page">
      <div class="between">
        <p class="eyebrow">
          {`${m}月${d}日（${WEEKDAY_LABEL[wd]}）`}
          {!plan.days.some((x) => x.weekday === wd) && ' · 今日は休養日'}
        </p>
        <span class="eyebrow">{MODE_LABEL[settings.mode]}</span>
      </div>

      {plan.days.length > 1 && (
        <div class="daypick" style={{ marginTop: '12px' }} role="group" aria-label="トレーニング日">
          {plan.days.map((x, i) => (
            <button type="button" aria-pressed={i === dayIndex} onClick={() => setPicked(i)}>
              <span class="d">{x.weekday === wd ? '今日' : WEEKDAY_LABEL[x.weekday]}</span>
              <span class="n">{x.splitName}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <h1>{day.splitName}</h1>
        <p class="meta num" style={{ marginTop: '4px' }}>
          {isToday ? '今日' : `${WEEKDAY_LABEL[day.weekday]}曜`} · {day.items.length}種目 · 約{minutes}分
        </p>
      </div>

      {active && (
        <div class="banner" style={{ marginTop: '16px' }}>
          <div class="grow">
            <h3>記録の途中です</h3>
            <p class="meta">
              {active.splitName} · {active.entries.filter((e) => working(e.sets).length > 0).length}/{active.entries.length}種目
            </p>
          </div>
          <button class="btn primary small" onClick={() => go('session')}>
            続ける
          </button>
        </div>
      )}

      {first && <LiftCard data={data} item={first} />}

      {rest.length > 0 && (
        <div class="list" style={{ marginTop: '12px' }}>
          {rest.map((it) => (
            <ExerciseRow data={data} item={it} />
          ))}
        </div>
      )}

      <section class="section">
        <div class="between">
          <div>
            <h3>持ち時間</h3>
            <p class={`meta num${minutes > budget ? ' neg' : ''}`}>
              見積もり 約{minutes}分{minutes > budget ? ` · ${minutes - budget}分オーバー` : ''}
            </p>
          </div>
          <div style={{ width: '184px' }}>
            <Stepper
              compact
              label="持ち時間"
              unit="分"
              value={budget}
              step={5}
              min={10}
              onChange={(v) => updateSettings({ dayBudgets: { ...settings.dayBudgets, [day.weekday]: v } })}
            />
          </div>
        </div>
      </section>

      {!active && (
        <div class="dock">
          <div class="dock-inner">
            <button class="btn primary big" onClick={start}>
              <Play {...ICON} />
              {day.splitName}を始める
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function weightText(w: number | null): string {
  if (w === null) return '探り'
  if (w === 0) return '自重'
  return formatKg(w)
}

function LiftCard({ data, item }: { data: AppData; item: PlanItem }) {
  const p = prescribe(data, item)
  if (!p) return null
  const { ex, suggestion: s, history } = p
  const last = history[0]
  const lastTop = last ? Math.max(...working(last.sets).map((x) => x.weight)) : undefined
  const diff = s.weight !== null && lastTop !== undefined ? s.weight - lastTop : 0
  const target = s.reps[0]
  return (
    <section class="lift" style={{ marginTop: '24px' }} aria-label="最初の種目">
      <div class="lift-head">
        <div>
          <p class="eyebrow">最初の種目</p>
          <h2 style={{ marginTop: '2px' }}>{ex.name}</h2>
        </div>
        <RepLadder min={item.repMin} max={item.repMax} target={target} />
      </div>
      <div class="figure">
        <span class="w">{weightText(s.weight)}</span>
        {s.weight !== null && s.weight > 0 && <span class="u">{weightUnit(ex)}</span>}
        <span class="x">×</span>
        <span class="r">{formatReps(s.reps)}</span>
        <span class="u">回 · {item.sets}セット</span>
      </div>
      {last && (
        <p class="delta num">
          前回 {formatShortDate(last.date)} {formatSets(last.sets)}
          {diff > 0 && <b> · +{formatKg(diff)} kg</b>}
          {diff < 0 && <> · {formatKg(diff)} kg</>}
        </p>
      )}
      {isSmith(ex) && s.weight !== null && s.weight > 0 && <PlateStack total={s.weight} bar={data.settings.smithBarWeight} />}
      <div class="basis">{suggestionText(s)}</div>
      {s.stalled && (
        <p class="note-warn" style={{ marginTop: '8px' }}>
          <TriangleAlert size={16} strokeWidth={1.5} />
          {STALLED_TEXT}
        </p>
      )}
    </section>
  )
}

function ExerciseRow({ data, item }: { data: AppData; item: PlanItem }) {
  const p = prescribe(data, item)
  if (!p) return null
  const s = p.suggestion
  return (
    <div class="ex-row">
      <span class="name ellipsis">{p.ex.name}</span>
      <span class="target">
        {s.weight === null ? '探り' : s.weight === 0 ? '自重' : `${formatKg(s.weight)} kg`}
        <span class="muted"> × {formatReps(s.reps)}</span>
      </span>
      <span class="info">
        <RepLadder min={item.repMin} max={item.repMax} target={s.reps[0]} />
        <span class="num">
          {item.sets}セット · 休憩{restLabel(item.restSec)}
        </span>
      </span>
      <span class="info" style={{ justifyContent: 'flex-end' }}>
        {s.stalled ? <span class="neg">伸びなし</span> : s.kind === 'increase' ? <span class="accent-ink">重量アップ</span> : null}
      </span>
    </div>
  )
}
