import { ArrowLeftRight, ChevronLeft, ListOrdered, Plus, TriangleAlert, X } from 'lucide-preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { RIR_CHOICES, TIME } from '../../config/defaults'
import { db, savePlan } from '../../db/db'
import { activePains, adjustRir, painAction } from '../../logic/adjust'
import { swapCandidates, makeItem } from '../../logic/generator'
import { STALLED_TEXT, suggestionText, working } from '../../logic/progression'
import type { Adjust, Exercise, Pain, Session, SessionEntry, SetRecord } from '../../logic/types'
import { formatKg, isFixedLoad, roundWeight, stepDown, stepUp, type WeightRule } from '../../logic/weights'
import { Check, ICON, PlateStack, RepLadder, Sheet, Stepper } from '../components'
import { go, toast, useData, useNow } from '../hooks'
import { cancelChime, chimeNow, isChimeScheduled, scheduleChime, unlockAudio } from '../sound'
import { adjustLabel, entryForExercise, formatReps, formatSets, formatShortDate, isSmith, prescribe, weightUnit, type Prescription } from '../workout'
import { PainSheet } from './Pain'
import { ExercisePicker, FavoriteButton } from './shared'

interface Row {
  isWarmup: boolean
  weight: number | null
  reps: number
}

function plannedRows(entry: SessionEntry, p: Prescription): Row[] {
  const warm: Row[] = p.warmups.slice(0, entry.warmupSets).map((w) => ({ isWarmup: true, weight: w.weight, reps: w.reps }))
  const work: Row[] = Array.from({ length: entry.plannedSets }, (_, i) => ({
    isWarmup: false,
    weight: p.suggestion.weight,
    reps: p.suggestion.reps[i] ?? p.suggestion.reps[p.suggestion.reps.length - 1] ?? entry.repMin,
  }))
  return [...warm, ...work]
}

const save = (s: Session) => db.sessions.put(s)

function firstOpen(s: Session): number {
  const i = s.entries.findIndex((e) => e.sets.filter((x) => !x.isWarmup).length < e.plannedSets)
  return i < 0 ? Math.max(0, s.entries.length - 1) : i
}

export function SessionScreen() {
  const data = useData()
  const session = data.sessions.find((s) => s.status === 'active')
  const [idx, setIdx] = useState<number | undefined>(undefined)
  const [sheet, setSheet] = useState<'swap' | 'list' | 'add' | 'finish' | 'pain' | undefined>()
  /** セッション中に「痛む」で記録した痛み。差し替え候補をこれで絞る */
  const [newPain, setNewPain] = useState<Pain | undefined>()
  // Pin the exercise on open so finishing its last set does not jump away before "次の種目へ"
  useEffect(() => {
    if (idx === undefined && session) setIdx(firstOpen(session))
  }, [session?.id])
  const show = (i: number) => {
    setIdx(i)
    window.scrollTo(0, 0)
  }

  if (!session) {
    return (
      <div class="page bare">
        <div class="topbar">
          <button class="icon-btn" aria-label="戻る" onClick={() => go('today', true)}>
            <ChevronLeft {...ICON} size={22} />
          </button>
        </div>
        <h1>記録中のセッションはありません</h1>
        <button class="btn primary big" style={{ marginTop: '24px' }} onClick={() => go('today', true)}>
          今日のメニューへ
        </button>
      </div>
    )
  }

  const current = Math.min(idx ?? firstOpen(session), session.entries.length - 1)
  const entry = session.entries[current]

  const updateEntry = (patch: Partial<SessionEntry>, extra: Partial<Session> = {}) => {
    const entries = session.entries.map((e, i) => (i === current ? { ...e, ...patch } : e))
    return save({ ...session, ...extra, entries })
  }

  return (
    <div class="page bare" style={{ paddingBottom: 'calc(var(--safe-b) + 200px)' }}>
      <div class="topbar">
        <button class="icon-btn" aria-label="今日の画面へ" onClick={() => go('today')}>
          <ChevronLeft {...ICON} size={22} />
        </button>
        <div class="progress-dots" aria-label={`${current + 1}/${session.entries.length}種目`}>
          {session.entries.map((e, i) => (
            <span class={i === current ? 'now' : working(e.sets).length >= e.plannedSets ? 'done' : ''} />
          ))}
        </div>
        <span class="spacer" />
        <button class="icon-btn" aria-label="種目一覧" onClick={() => setSheet('list')}>
          <ListOrdered {...ICON} />
        </button>
        <button class="btn quiet small" onClick={() => setSheet('finish')}>
          終了
        </button>
      </div>

      {entry ? (
        <EntryView
          key={`${current}-${entry.exerciseId}`}
          session={session}
          entry={entry}
          index={current}
          onUpdate={updateEntry}
          onNext={() => (current + 1 < session.entries.length ? show(current + 1) : setSheet('finish'))}
          onSwap={() => {
            setNewPain(undefined)
            setSheet('swap')
          }}
          onPain={() => setSheet('pain')}
        />
      ) : (
        <div class="empty">
          種目がありません
          <div style={{ marginTop: '16px' }}>
            <button class="btn" onClick={() => setSheet('add')}>
              <Plus {...ICON} />
              種目を追加
            </button>
          </div>
        </div>
      )}

      <Sheet open={sheet === 'list'} onClose={() => setSheet(undefined)} title="種目">
        <div class="list">
          {session.entries.map((e, i) => {
            const ex = data.exMap.get(e.exerciseId)
            const done = working(e.sets).length
            return (
              <button
                class="row"
                onClick={() => {
                  show(i)
                  setSheet(undefined)
                }}
              >
                <Check on={done >= e.plannedSets} />
                <span class="grow">
                  <span class="title ellipsis" style={{ display: 'block' }}>{ex?.name ?? e.exerciseId}</span>
                  <span class="sub num">
                    {done}/{e.plannedSets}セット{e.sets.length ? ` · ${formatSets(e.sets)}` : ''}
                  </span>
                </span>
                {i === current && <span class="mono muted">記録中</span>}
              </button>
            )
          })}
        </div>
        <button class="btn block" style={{ marginTop: '12px' }} onClick={() => setSheet('add')}>
          <Plus {...ICON} />
          種目を追加
        </button>
      </Sheet>

      <Sheet open={sheet === 'add'} onClose={() => setSheet(undefined)} title="種目を追加">
        <ExercisePicker
          exclude={session.entries.map((e) => e.exerciseId)}
          onPick={async (ex) => {
            const next = { ...session, entries: [...session.entries, entryForExercise(ex, data, session.date)] }
            await save(next)
            show(next.entries.length - 1)
            setSheet(undefined)
          }}
        />
      </Sheet>

      {entry && (
        <SwapSheet
          open={sheet === 'swap'}
          onClose={() => setSheet(undefined)}
          session={session}
          entry={entry}
          index={current}
          pain={newPain}
        />
      )}

      <PainSheet
        open={sheet === 'pain'}
        title="どこが痛みますか"
        exercise={entry ? data.exMap.get(entry.exerciseId) : undefined}
        onClose={() => setSheet((s) => (s === 'pain' ? undefined : s))}
        onSaved={(p) => {
          setNewPain(p)
          setSheet('swap')
        }}
      />

      <FinishSheet open={sheet === 'finish'} onClose={() => setSheet(undefined)} session={session} />
    </div>
  )
}

function EntryView(props: {
  session: Session
  entry: SessionEntry
  index: number
  onUpdate: (patch: Partial<SessionEntry>, extra?: Partial<Session>) => Promise<unknown>
  onNext: () => void
  onSwap: () => void
  onPain: () => void
}) {
  const data = useData()
  const { session, entry } = props
  const p = useMemo(() => prescribe(data, entry, session.id), [data, entry.exerciseId, entry.repMin, entry.repMax, entry.plannedSets])
  const [editing, setEditing] = useState<number | undefined>()
  const [draft, setDraft] = useState<SetRecord | undefined>()
  if (!p) return <p class="empty">種目が見つかりません</p>
  const { ex, rule, suggestion: s, history } = p
  const rows = plannedRows(entry, p)
  const done = entry.sets.length
  const allDone = done >= rows.length
  const last = history[0]

  const fallbackWeight = () => {
    const lastWork = [...entry.sets].reverse().find((x) => !x.isWarmup)
    if (lastWork) return lastWork.weight
    if (rule.kind === 'list') return rule.values[0]
    return rule.min > 0 ? rule.min : rule.step
  }
  const pending = rows[done]
  const pendingDraft: SetRecord | undefined = pending && {
    weight: pending.isWarmup ? pending.weight ?? 0 : ([...entry.sets].reverse().find((x) => !x.isWarmup)?.weight ?? pending.weight ?? fallbackWeight()),
    reps: pending.reps,
    isWarmup: pending.isWarmup,
  }

  const shownDraft = draft && pendingDraft && draft.isWarmup === pendingDraft.isWarmup ? draft : pendingDraft

  const record = async (set: SetRecord) => {
    unlockAudio()
    const duration = set.isWarmup ? TIME.warmupSetRestSec : entry.restSec
    const startAt = Date.now()
    scheduleChime(startAt + duration * 1000)
    await props.onUpdate({ sets: [...entry.sets, { ...set, doneAt: startAt }] }, { rest: { startAt, durationSec: duration } })
  }

  const replaceSet = (i: number, set: SetRecord | null) => {
    const sets = entry.sets.slice()
    if (set) sets[i] = { ...sets[i], ...set }
    else sets.splice(i, 1)
    setEditing(undefined)
    return props.onUpdate({ sets })
  }

  return (
    <div>
      <div class="between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p class="eyebrow num">
            {props.index + 1}/{session.entries.length} · {entry.role === 'main' ? 'メイン' : '補助'} · {entry.repMin}–{entry.repMax}回 · RIR {entry.targetRir[0]}–{entry.targetRir[1]}
          </p>
          <h1 style={{ fontSize: '24px', lineHeight: '30px', marginTop: '2px' }}>{ex.name}</h1>
        </div>
        <div class="hstack" style={{ gap: 0, marginRight: '-8px' }}>
          <button class="btn quiet small" onClick={props.onPain}>
            痛む
          </button>
          <FavoriteButton id={ex.id} />
          <button class="icon-btn" aria-label="差し替え" onClick={props.onSwap}>
            <ArrowLeftRight {...ICON} />
          </button>
        </div>
      </div>

      <section class="lift" style={{ marginTop: '16px' }}>
        <div class="between">
          <p class="eyebrow">{entry.isProbe ? (entry.adjust?.some((a) => a.probe) ? '久しぶりなので探り' : '初回は探り') : '今回の提案'}</p>
          <RepLadder min={entry.repMin} max={entry.repMax} target={s.reps[0]} />
        </div>
        {s.weight === null ? (
          <p style={{ marginTop: '12px' }}>{suggestionText(s)}</p>
        ) : (
          <>
            <div class="figure small" style={{ marginTop: '12px' }}>
              <span class="w">{s.weight === 0 ? '自重' : formatKg(s.weight)}</span>
              {s.weight > 0 && <span class="u">{weightUnit(ex)}</span>}
              <span class="x">×</span>
              <span class="r">{formatReps(s.reps)}</span>
              <span class="u">回</span>
            </div>
            {isSmith(ex) && s.weight > 0 && <PlateStack total={shownDraft && !shownDraft.isWarmup ? shownDraft.weight : s.weight} bar={data.settings.smithBarWeight} />}
          </>
        )}
        <div class="basis" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
          {entry.adjust?.length ? (
            <span>
              {adjustLabel(entry.adjust)}
              {p.base.weight !== null && p.base.weight !== s.weight && <span class="muted num">（通常なら {formatKg(p.base.weight)} kg）</span>}
            </span>
          ) : null}
          {last ? (
            <span class="num">
              前回 {formatShortDate(last.date)} · {formatSets(last.sets)}
            </span>
          ) : (
            <span>前回の記録なし</span>
          )}
          {s.weight !== null && <span class="muted">{suggestionText(s)}</span>}
        </div>
        {s.stalled && (
          <p class="note-warn" style={{ marginTop: '8px' }}>
            <TriangleAlert size={16} strokeWidth={1.5} />
            {STALLED_TEXT}
          </p>
        )}
      </section>

      <div class="list sets">
        {rows.map((row, i) => {
          const rec = entry.sets[i]
          const label = row.isWarmup ? `W${i + 1}` : entry.isProbe ? `探${i - entry.warmupSets + 1}` : String(i - entry.warmupSets + 1)
          if (editing === i && rec)
            return <SetEditor key={`e${i}`} initial={rec} rule={rule} ex={ex} onSave={(v) => replaceSet(i, v)} onDelete={() => replaceSet(i, null)} saveLabel="更新" />
          if (i === done && pendingDraft && editing === undefined)
            return <SetEditor key={`p${i}-${done}`} initial={pendingDraft} rule={rule} ex={ex} onSave={record} onDraft={setDraft} label={label} pending />
          return (
            <button class={`set-row${rec ? ' done' : ''}`} onClick={() => rec && setEditing(i)} disabled={!rec}>
              <span class="idx">{label}</span>
              <span class="val">
                {rec ? (
                  <>
                    {formatKg(rec.weight)}
                    <span class="u">kg</span> × {rec.reps}
                    {rec.rir !== undefined && <span class="rir">RIR {rec.rir}</span>}
                  </>
                ) : (
                  <span class="muted">
                    {row.weight === null ? '—' : formatKg(row.weight)}
                    <span class="u">kg</span> × {row.reps}
                  </span>
                )}
              </span>
              <Check on={!!rec} />
            </button>
          )
        })}
      </div>

      <div class="between" style={{ marginTop: '8px' }}>
        {entry.warmupSets > 0 && done === 0 ? (
          <button class="btn quiet small" onClick={() => props.onUpdate({ warmupSets: 0 })}>
            ウォームアップを省く
          </button>
        ) : (
          <span />
        )}
        <button class="btn quiet small" onClick={() => props.onUpdate({ plannedSets: entry.plannedSets + 1 })}>
          <Plus {...ICON} size={16} />
          セットを追加
        </button>
      </div>

      <div class="dock no-tabs">
        <div class="dock-inner">
          <RestTimer session={session} onChange={(rest) => props.onUpdate({}, { rest })} />
          {allDone ? (
            <button class="btn primary big" onClick={props.onNext}>
              {props.index + 1 < session.entries.length ? '次の種目へ' : 'トレーニングを終える'}
            </button>
          ) : (
            <button
              class="btn primary big num"
              disabled={editing !== undefined}
              onClick={() => document.querySelector<HTMLFormElement>('#pending-set')?.requestSubmit()}
            >
              {editing !== undefined ? '編集中' : shownDraft ? `記録  ${formatKg(shownDraft.weight)} kg × ${shownDraft.reps}` : '記録'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SetEditor(props: {
  initial: SetRecord
  rule: WeightRule
  ex: Exercise
  onSave: (s: SetRecord) => unknown
  onDraft?: (s: SetRecord) => void
  onDelete?: () => unknown
  saveLabel?: string
  label?: string
  pending?: boolean
}) {
  const [weight, setWeight] = useState(props.initial.weight)
  const [reps, setReps] = useState(props.initial.reps)
  const [rir, setRir] = useState<number | undefined>(props.initial.rir)
  const fixed = isFixedLoad(props.rule)
  const step = props.rule.kind === 'step' ? (fixed ? 2.5 : props.rule.step) : 2
  const min = props.rule.kind === 'step' ? props.rule.min : 0
  const value = { weight, reps, rir, isWarmup: props.initial.isWarmup }

  // Keep the dock button label in sync with what is about to be recorded
  useEffect(() => {
    if (props.pending) props.onDraft?.(value)
  }, [weight, reps, rir])

  return (
    <form
      id={props.pending ? 'pending-set' : undefined}
      class="set-edit"
      onSubmit={(e) => {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        props.onSave(value)
      }}
    >
      {props.label && (
        <p class="eyebrow">
          {props.initial.isWarmup ? `ウォームアップ ${props.label}` : `セット ${props.label}`}
        </p>
      )}
      <div class="pair">
        <div>
          <div class="lbl">
            <span>重量</span>
            <span class="muted">{weightUnit(props.ex)}{fixed ? '・加重' : ''}</span>
          </div>
          <Stepper
            label="重量"
            value={weight}
            step={step}
            min={min}
            decimals
            up={fixed ? undefined : (v) => stepUp(v, props.rule)}
            down={fixed ? undefined : (v) => (props.rule.kind === 'list' ? stepDown(v, props.rule) : roundWeight(v - step, props.rule, 'down'))}
            onChange={setWeight}
          />
        </div>
        <div>
          <div class="lbl">
            <span>回数</span>
          </div>
          <Stepper label="回数" value={reps} step={1} min={0} onChange={setReps} />
        </div>
      </div>
      {!props.initial.isWarmup && (
        <div>
          <div class="lbl">
            <span>RIR（あと何回できたか・任意）</span>
          </div>
          <div class="chips" role="group" aria-label="RIR">
            {RIR_CHOICES.map((r) => (
              <button type="button" class="chip" aria-pressed={rir === r} onClick={() => setRir(rir === r ? undefined : r)}>
                {r === RIR_CHOICES[RIR_CHOICES.length - 1] ? `${r}+` : r}
              </button>
            ))}
          </div>
        </div>
      )}
      {!props.pending && (
        <div class="grid-2">
          <button type="button" class="btn danger" onClick={() => props.onDelete?.()}>
            削除
          </button>
          <button type="submit" class="btn primary">
            {props.saveLabel ?? '保存'}
          </button>
        </div>
      )}
    </form>
  )
}

function RestTimer(props: { session: Session; onChange: (rest: Session['rest']) => void }) {
  const rest = props.session.rest
  const now = useNow(250, !!rest)
  const chimed = useRef<number | undefined>()
  const end = rest ? rest.startAt + rest.durationSec * 1000 : 0
  const left = rest ? Math.ceil((end - now) / 1000) : 0

  useEffect(() => {
    // Fallback when the page was reloaded and the scheduled chime was lost
    if (rest && left <= 0 && chimed.current !== end && !isChimeScheduled(end) && now - end < 5000) {
      chimed.current = end
      chimeNow()
    }
  }, [left <= 0, end])

  if (!rest) return null
  const adjust = (delta: number) => {
    const next = { ...rest, durationSec: Math.max(0, rest.durationSec + delta) }
    const nextEnd = next.startAt + next.durationSec * 1000
    if (nextEnd > Date.now()) scheduleChime(nextEnd)
    else cancelChime()
    props.onChange(next)
  }
  const over = left <= 0
  const shown = Math.abs(left)
  const text = `${over ? '+' : ''}${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`
  const pct = over ? 100 : Math.min(100, ((rest.durationSec - left) / rest.durationSec) * 100)

  return (
    <div class="timer" role="timer" aria-live="off">
      <span class={`t${over ? ' done' : ''}`}>{text}</span>
      <span class="lbl">{over ? '休憩終了' : '休憩'}</span>
      <button class="btn small" onClick={() => adjust(-30)} aria-label="30秒短く">
        −30
      </button>
      <button class="btn small" onClick={() => adjust(30)} aria-label="30秒長く">
        +30
      </button>
      <button
        class="icon-btn"
        aria-label="タイマーを閉じる"
        onClick={() => {
          cancelChime()
          props.onChange(undefined)
        }}
      >
        <X {...ICON} />
      </button>
      <span class="progress" style={{ width: `${pct}%` }} />
    </div>
  )
}

function SwapSheet(props: { open: boolean; onClose: () => void; session: Session; entry: SessionEntry; index: number; pain?: Pain }) {
  const data = useData()
  const [alsoPlan, setAlsoPlan] = useState(true)
  const ex = data.exMap.get(props.entry.exerciseId)
  if (!ex) return null
  const today = props.session.date
  const pains = props.pain ? activePains([...data.pains.filter((p) => p.id !== props.pain!.id), props.pain], today) : []
  const candidates = swapCandidates(ex, data.exercises, data.settings, today)
    .filter((c) => !props.session.entries.some((e) => e.exerciseId === c.id))
    .filter((c) => !props.pain || painAction(c, pains).action === 'ok')
  const here = props.pain ? painAction(ex, pains) : undefined
  const keepAdjust: Adjust | undefined = here?.action === 'lighten' ? here.adjust : here?.action === 'replace' ? here.fallback : undefined

  const pick = async (next: Exercise) => {
    if (props.entry.sets.length && !confirm('記録済みのセットは消えます。差し替えますか')) return
    const entries = props.session.entries.slice()
    entries[props.index] = entryForExercise(next, data, today)
    await save({ ...props.session, entries })
    const plan = data.plan
    const dayIndex = props.session.planDayIndex
    // 痛みによる差し替えは一時的なので、メニューには反映しない
    if (alsoPlan && !props.pain && plan && dayIndex !== undefined && plan.days[dayIndex]) {
      const days = plan.days.map((d, i) =>
        i !== dayIndex
          ? d
          : {
              ...d,
              items: d.items.map((it) =>
                it.exerciseId === ex.id ? makeItem(next, data.settings.mode, data.settings.modeParams[data.settings.mode]) : it,
              ),
            },
      )
      await savePlan({ ...plan, days })
    }
    toast(`${next.name}に差し替えました`)
    props.onClose()
  }

  /** 差し替えずに、痛みの分だけ軽くして続ける */
  const keep = async () => {
    if (keepAdjust) {
      const current = props.entry.adjust ?? []
      const prev = current.find((a) => a.kind === 'pain')
      const baseRir = adjustRir(props.entry.targetRir, prev ? [{ ...prev, rirPlus: -(prev.rirPlus ?? 0) }] : [])
      const entries = props.session.entries.slice()
      entries[props.index] = {
        ...props.entry,
        adjust: [...current.filter((a) => a.kind !== 'pain'), keepAdjust],
        targetRir: adjustRir(baseRir, [keepAdjust]),
      }
      await save({ ...props.session, entries })
      toast('負担を避けるため、重量を軽くしました')
    }
    props.onClose()
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.pain ? '負担の少ない種目に替える' : `${ex.name}の代わり`}>
      {props.pain ? (
        <p class="meta" style={{ marginBottom: '12px' }}>
          {here?.action === 'exclude'
            ? 'いまの種目はこの関節への負担が大きいので、替えるか飛ばすのがおすすめです'
            : here?.action === 'ok'
              ? 'いまの種目はこの関節への負担が小さめです。続けても、替えてもかまいません'
              : '替えない場合は重量を軽くして続けます'}
        </p>
      ) : (
        <label class="field-row" style={{ padding: '4px 0', marginBottom: '8px' }}>
          <span class="meta">次回以降のメニューにも反映</span>
          <input type="checkbox" checked={alsoPlan} onChange={(e) => setAlsoPlan((e.target as HTMLInputElement).checked)} style={{ width: '22px', height: '22px' }} />
        </label>
      )}
      <ExercisePicker candidates={candidates} onPick={pick} />
      {props.pain && here?.action !== 'exclude' && (
        <button class="btn block" style={{ marginTop: '12px' }} onClick={keep}>
          {keepAdjust ? '替えずに軽くして続ける' : '替えずに続ける'}
        </button>
      )}
    </Sheet>
  )
}

function FinishSheet(props: { open: boolean; onClose: () => void; session: Session }) {
  const [note, setNote] = useState(props.session.note)
  useEffect(() => setNote(props.session.note), [props.open])
  const recorded = props.session.entries.some((e) => working(e.sets).length > 0)

  const finish = async () => {
    cancelChime()
    const entries = props.session.entries.filter((e) => e.sets.length > 0)
    await save({ ...props.session, note, entries, status: 'done', finishedAt: props.session.finishedAt ?? Date.now(), rest: undefined })
    toast('記録しました。次回の提案を更新しました')
    go('today', true)
  }
  const discard = async () => {
    if (!confirm('このセッションの記録をすべて消します。元に戻せません')) return
    cancelChime()
    if (props.session.id) await db.sessions.delete(props.session.id)
    go('today', true)
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title="トレーニングを終える">
      <div class="stack-12">
        <div class="field">
          <label for="note">メモ</label>
          <textarea id="note" class="input" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} placeholder="フォームの気づき、体調など" />
        </div>
        <button class="btn primary big" disabled={!recorded} onClick={finish}>
          記録を保存
        </button>
        {!recorded && <p class="meta">本番セットが1つ以上あると保存できます</p>}
        <button class="btn quiet danger block" onClick={discard}>
          記録を破棄
        </button>
      </div>
    </Sheet>
  )
}
