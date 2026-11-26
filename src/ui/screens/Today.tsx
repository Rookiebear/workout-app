import { Play, Plus, TriangleAlert } from 'lucide-preact'
import { useMemo, useState } from 'preact/hooks'
import { DEFAULT_DAY_BUDGET, JOINT_LABEL, MODE_LABEL, WEEKDAY_LABEL, WEEKDAY_ORDER } from '../../config/defaults'
import { db, regeneratePlan, updateSettings } from '../../db/db'
import { activePains, deloadActive, deloadAdvice, deloadWindow, globalGap, lastBreakEnd } from '../../logic/adjust'
import { addDays, daysBetween, weekdayOf } from '../../logic/dates'
import { prepareDay, type PreparedDay, type PreparedItem } from '../../logic/day'
import { estimateMinutes } from '../../logic/generator'
import { STALLED_TEXT, historyFor, isStalled, lastSessionDate, suggestionText, working } from '../../logic/progression'
import { formatKg } from '../../logic/weights'
import { ICON, PlateStack, RepLadder, Stepper } from '../components'
import { go, todayISO, useData, type AppData } from '../hooks'
import {
  adjustLabel,
  dayContext,
  formatReps,
  formatSets,
  formatShortDate,
  isSmith,
  prescribe,
  restLabel,
  startSession,
  weightUnit,
} from '../workout'
import { MEDICAL_NOTE, PainCheckSheet, PainSheet, painText } from './Pain'

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
  const [budgets, setBudgets] = useState<Record<number, number>>({})
  const [sheet, setSheet] = useState<'pain' | 'check' | undefined>()
  const pains = activePains(data.pains, today)

  const dayIndex = plan ? (picked ?? pickDefaultDay(plan.days, wd)) : 0
  const day = plan?.days[dayIndex]
  const planBudget = day ? (settings.dayBudgets[day.weekday] ?? DEFAULT_DAY_BUDGET) : DEFAULT_DAY_BUDGET
  const budget = day ? (budgets[dayIndex] ?? planBudget) : planBudget
  const prepared = useMemo(
    () => (day ? prepareDay(day.items, dayContext(data, today), budget) : undefined),
    [data, dayIndex, budget, today],
  )

  if (!plan || !day || !prepared) {
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

  const isToday = day.weekday === wd
  const minutes = estimateMinutes(prepared.items)
  const [first, ...rest] = prepared.items

  const begin = async () => {
    await startSession(data, { splitName: day.splitName, items: prepared.items }, dayIndex, today, budget)
    go('session')
  }
  const start = () => (pains.length && settings.painCheckedOn !== today ? setSheet('check') : begin())

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
        <p class={`meta num${minutes > budget ? ' neg' : ''}`} style={{ marginTop: '4px' }}>
          {isToday ? '今日' : `${WEEKDAY_LABEL[day.weekday]}曜`} · {prepared.items.length}種目 · 約{minutes}分
          {minutes > budget ? `（持ち時間を${minutes - budget}分超過）` : ''}
        </p>
      </div>

      <div class="stack-8" style={{ marginTop: '16px' }}>
        {active && (
          <div class="banner">
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
        <ReturnPrompt data={data} today={today} />
        <DeloadPrompt data={data} today={today} />
        {prepared.severe.length > 0 && (
          <p class="banner note-warn">
            <TriangleAlert size={16} strokeWidth={1.5} />
            {prepared.severe.map((j) => JOINT_LABEL[j]).join('・')}：{MEDICAL_NOTE}
          </p>
        )}
      </div>

      {first ? <LiftCard data={data} item={first} /> : <p class="empty">今日できる種目がありません</p>}

      {rest.length > 0 && (
        <div class="list" style={{ marginTop: '12px' }}>
          {rest.map((it) => (
            <ExerciseRow data={data} item={it} />
          ))}
        </div>
      )}

      <AdjustNotes data={data} prepared={prepared} />

      <section class="section">
        <div class="between">
          <div>
            <h3>今日の持ち時間</h3>
            <p class="meta">{budget === planBudget ? 'いつもの持ち時間' : `いつもは${planBudget}分`}</p>
          </div>
          <div style={{ width: '184px' }}>
            <Stepper compact label="今日の持ち時間" unit="分" value={budget} step={5} min={15} onChange={(v) => setBudgets((b) => ({ ...b, [dayIndex]: v }))} />
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h3>痛み</h3>
          <button class="btn quiet small" onClick={() => setSheet('pain')}>
            <Plus {...ICON} size={16} />
            記録する
          </button>
        </div>
        {pains.length ? (
          <div class="list">
            {pains.map((p) => (
              <div class="row">
                <span class="grow">
                  <span class="title" style={{ display: 'block' }}>
                    {painText(p)}
                  </span>
                  <span class="sub num">{formatShortDate(p.startDate)}から</span>
                </span>
                <button class="btn small" onClick={() => db.pains.update(p.id!, { endDate: today })}>
                  治った
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p class="meta">記録すると、負担を避けるように種目と重量を調整します</p>
        )}
      </section>

      {!active && (
        <div class="dock">
          <div class="dock-inner">
            <button class="btn primary big" onClick={start} disabled={prepared.items.length === 0}>
              <Play {...ICON} />
              {day.splitName}を始める
            </button>
          </div>
        </div>
      )}

      <PainSheet open={sheet === 'pain'} onClose={() => setSheet(undefined)} />
      <PainCheckSheet
        open={sheet === 'check'}
        pains={pains}
        onClose={() => setSheet(undefined)}
        onDone={() => {
          setSheet(undefined)
          // 痛みの変更を反映したメニューを見てから始められるよう、ここでは開始しない
        }}
      />
    </div>
  )
}

/** 置換・除外・削減を、何をなぜ変えたかの短い一覧で出す */
function AdjustNotes({ data, prepared }: { data: AppData; prepared: PreparedDay }) {
  const name = (id: string) => data.exMap.get(id)?.name ?? id
  const lines: string[] = []
  for (const r of prepared.replaced) lines.push(`${name(r.from)} → ${name(r.to)}（${JOINT_LABEL[r.joint]}の負担を避けるため）`)
  for (const x of prepared.excluded) lines.push(`${name(x.exerciseId)}を外しました（${JOINT_LABEL[x.joint]}の負担を避けるため）`)
  const removed = prepared.trimmed.filter((c) => c.removed).map((c) => name(c.item.exerciseId))
  const shaved = prepared.trimmed
    .filter((c) => !c.removed)
    .map((c) => {
      const parts = [c.sets ? `${c.sets}セット` : '', c.warmups ? `準備${c.warmups}本` : ''].filter(Boolean)
      return `${name(c.item.exerciseId)}を${parts.join('・')}減らす`
    })
  if (removed.length) lines.push(`持ち時間に合わせて外す：${removed.join('、')}`)
  if (shaved.length) lines.push(`持ち時間に合わせて${shaved.join('、')}`)
  if (prepared.over) lines.push('削れるところまで削っても持ち時間を超えます')
  if (!lines.length) return null
  return (
    <section class="section">
      <h3 style={{ marginBottom: '8px' }}>今日の調整</h3>
      <ul class="adjust-notes">
        {lines.map((l) => (
          <li>{l}</li>
        ))}
      </ul>
    </section>
  )
}

/** 最後のトレーニングから2週以上空いたら、復帰プランを使うか確認する */
function ReturnPrompt({ data, today }: { data: AppData; today: string }) {
  const last = lastSessionDate(data.sessions)
  const gap = globalGap(last, today)
  if (!gap || data.settings.returnDecision?.gapStart === gap) return null
  const days = daysBetween(gap, today)
  return (
    <div class="banner" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
      <div>
        <h3>前回から{days}日空きました</h3>
        <p class="meta">復帰プランを使うと、空いた期間に合わせて重量とセット数を下げ、段階的に戻します</p>
      </div>
      <div class="grid-2" style={{ width: '100%' }}>
        <button class="btn" onClick={() => updateSettings({ returnDecision: { gapStart: gap, use: false } })}>
          使わない
        </button>
        <button class="btn primary" onClick={() => updateSettings({ returnDecision: { gapStart: gap, use: true } })}>
          使う
        </button>
      </div>
    </div>
  )
}

function DeloadPrompt({ data, today }: { data: AppData; today: string }) {
  const { settings, plan, sessions } = data
  const advice = useMemo(() => {
    const items = plan?.days.flatMap((d) => d.items) ?? []
    const seen = new Set<string>()
    let stalled = 0
    let total = 0
    for (const it of items) {
      if (seen.has(it.exerciseId)) continue
      seen.add(it.exerciseId)
      const h = historyFor(sessions, it.exerciseId)
      if (!h.length) continue
      total++
      if (isStalled(h, { repMin: it.repMin, repMax: it.repMax, sets: it.sets, targetRir: it.targetRir })) stalled++
    }
    const dates = [...new Set(sessions.filter((s) => s.status === 'done').map((s) => s.date))].sort().reverse()
    return deloadAdvice({ today, settings, firstSessionDate: lastBreakEnd(dates, today), stalled, total })
  }, [settings, plan, sessions, today])

  if (deloadActive(settings, today)) {
    return (
      <div class="banner">
        <div class="grow">
          <h3>デロード中</h3>
          <p class="meta num">{formatShortDate(settings.deload!.end)}まで · セット数50%・重量90%</p>
        </div>
        <button class="btn small" onClick={() => updateSettings({ deload: undefined, lastDeloadEnd: today })}>
          終える
        </button>
      </div>
    )
  }
  if (!advice.due) return null
  const why = advice.reason === 'stall' ? '伸びなしの種目が3分の1を超えました' : `前回から${advice.weeks}週たちました`
  return (
    <div class="banner" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
      <div>
        <h3>デロードの時期です</h3>
        <p class="meta">{why}。1週間、セット数を50%、重量を90%にして疲れを抜きます</p>
      </div>
      <div class="grid-2" style={{ width: '100%' }}>
        <button class="btn" onClick={() => updateSettings({ deloadSnoozeUntil: addDays(today, 6) })}>
          今回は見送る
        </button>
        <button
          class="btn primary"
          onClick={() => {
            const w = deloadWindow(today)
            updateSettings({ deload: w, lastDeloadEnd: w.end, deloadSnoozeUntil: undefined })
          }}
        >
          デロードする
        </button>
      </div>
    </div>
  )
}

function weightText(w: number | null): string {
  if (w === null) return '探り'
  if (w === 0) return '自重'
  return formatKg(w)
}

function LiftCard({ data, item }: { data: AppData; item: PreparedItem }) {
  const p = prescribe(data, item)
  if (!p) return null
  const { ex, suggestion: s, base, history } = p
  const last = history[0]
  const lastTop = last ? Math.max(...working(last.sets).map((x) => x.weight)) : undefined
  const diff = s.weight !== null && lastTop !== undefined ? s.weight - lastTop : 0
  const adjusted = item.adjust.length > 0
  return (
    <section class="lift" style={{ marginTop: '24px' }} aria-label="最初の種目">
      <div class="lift-head">
        <div>
          <p class="eyebrow">最初の種目</p>
          <h2 style={{ marginTop: '2px' }}>{ex.name}</h2>
        </div>
        <RepLadder min={item.repMin} max={item.repMax} target={s.reps[0]} />
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
          {!adjusted && diff > 0 && <b> · +{formatKg(diff)} kg</b>}
          {!adjusted && diff < 0 && <> · {formatKg(diff)} kg</>}
        </p>
      )}
      {isSmith(ex) && s.weight !== null && s.weight > 0 && <PlateStack total={s.weight} bar={data.settings.smithBarWeight} />}
      <div class="basis" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
        {adjusted && (
          <span>
            {adjustLabel(item.adjust)}
            {base.weight !== null && base.weight !== s.weight && <span class="muted num">（通常なら {formatKg(base.weight)} kg）</span>}
          </span>
        )}
        <span class={adjusted ? 'muted' : ''}>{suggestionText(base)}</span>
      </div>
      {s.stalled && (
        <p class="note-warn" style={{ marginTop: '8px' }}>
          <TriangleAlert size={16} strokeWidth={1.5} />
          {STALLED_TEXT}
        </p>
      )}
    </section>
  )
}

function ExerciseRow({ data, item }: { data: AppData; item: PreparedItem }) {
  const p = prescribe(data, item)
  if (!p) return null
  const s = p.suggestion
  const note = s.stalled ? '伸びなし' : s.kind === 'increase' && !item.adjust.length ? '重量アップ' : ''
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
        {note && <span class={s.stalled ? 'neg' : 'accent-ink'}>{note}</span>}
      </span>
      {item.adjust.length > 0 && <span class="wide adjust-line">{adjustLabel(item.adjust)}</span>}
    </div>
  )
}
