import { ChevronLeft, ChevronRight, Download, Plus, Upload, X } from 'lucide-preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import {
  EQUIPMENT,
  JOINT_LABEL,
  MODE_LABEL,
  MODE_PARAMS,
  MODE_POLICY,
  MUSCLES,
  PATTERN_LABEL,
  SPLIT_SUMMARY,
} from '../../config/defaults'
import { db, exportAll, importAll, regeneratePlan, updateSettings } from '../../db/db'
import { isActiveExclusion, isMachine, unavailableReason } from '../../logic/availability'
import { backupFileName, BackupError, parseBackup } from '../../logic/backup'
import type { EquipmentId, Exclusion, Exercise, Joint, Mode, ModeParams, Muscle, Pattern, Settings } from '../../logic/types'
import { ICON, Segmented, Stepper, Switch } from '../components'
import { back, go, todayISO, toast, useData } from '../hooks'
import { exerciseMeta, formatShortDate } from '../workout'
import { WeekdayPicker } from './shared'

const MODES: Mode[] = ['hypertrophy', 'strength', 'cut']

/** Settings that change what the generator can pick rebuild the plan right away */
async function updateAndRegenerate(patch: Partial<Settings>) {
  await updateSettings(patch)
  await regeneratePlan(todayISO())
}

function SubPage(props: { title: string; fallback?: string; children: preact.ComponentChildren; action?: preact.ComponentChildren }) {
  return (
    <div class="page">
      <div class="topbar">
        <button class="icon-btn" aria-label="戻る" onClick={() => back(props.fallback ?? 'settings')}>
          <ChevronLeft {...ICON} size={22} />
        </button>
        <span class="spacer" />
        {props.action}
      </div>
      <h1>{props.title}</h1>
      {props.children}
    </div>
  )
}

export function SettingsScreen() {
  const { settings, exercises } = useData()
  const file = useRef<HTMLInputElement>(null)
  const [dbText, setDbText] = useState(settings.dumbbellWeights.join(', '))
  const today = todayISO()
  const activeExclusions = settings.exclusions.filter((x) => isActiveExclusion(x, today)).length
  const machines = exercises.filter(isMachine)
  const machinesOn = machines.filter((m) => !settings.unavailableExercises.includes(m.id)).length

  const doExport = async () => {
    const now = new Date()
    const json = await exportAll(now.toISOString())
    const name = backupFileName(today)
    const blob = new Blob([json], { type: 'application/json' })
    const f = new File([blob], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: name })
      else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
      await updateSettings({ lastExportAt: today })
      toast('書き出しました')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('書き出せませんでした')
    }
  }

  const doImport = async (input: HTMLInputElement) => {
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    try {
      const data = parseBackup(await f.text())
      const n = data.sessions.length
      if (!confirm(`いまのデータをすべて置き換えます（記録 ${n} 件）。元に戻せません`)) return
      await importAll(data)
      toast('読み込みました')
    } catch (e) {
      toast(e instanceof BackupError ? e.message : '読み込めませんでした')
    }
  }

  return (
    <div class="page">
      <h1>設定</h1>

      <section class="section stack-8">
        <h2>目的</h2>
        <Segmented<Mode> label="目的" value={settings.mode} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={(mode) => updateAndRegenerate({ mode })} />
        <p class="meta">{MODE_POLICY[settings.mode]}。切り替えても履歴と推定1RMは引き継ぎ、次回の重量は新しい回数範囲で計算し直します</p>
      </section>

      <section class="section stack-8">
        <h2>トレーニング日</h2>
        <WeekdayPicker value={settings.weekdays} onChange={(weekdays) => weekdays.length && updateAndRegenerate({ weekdays })} />
        <p class="meta">
          週{settings.weekdays.length}日 · {SPLIT_SUMMARY[settings.weekdays.length]}
        </p>
      </section>

      <section class="section">
        <h2 style={{ marginBottom: '8px' }}>器具</h2>
        <div class="list">
          {EQUIPMENT.map((e) => (
            <div class="field-row">
              <span>{e.label}</span>
              <Switch
                label={e.label}
                checked={settings.equipmentEnabled[e.id]}
                onChange={(v) => updateAndRegenerate({ equipmentEnabled: { ...settings.equipmentEnabled, [e.id]: v } })}
              />
            </div>
          ))}
          <div class="field-row">
            <span>腹筋を部位に含める</span>
            <Switch label="腹筋を部位に含める" checked={settings.includeAbs} onChange={(includeAbs) => updateAndRegenerate({ includeAbs })} />
          </div>
        </div>
      </section>

      <section class="section stack-12">
        <h2>重量</h2>
        <div class="field">
          <span class="label">スミスマシンのバー重量</span>
          <Stepper label="バー重量" unit="kg" value={settings.smithBarWeight} step={0.5} decimals onChange={(smithBarWeight) => updateSettings({ smithBarWeight })} />
        </div>
        <div class="field">
          <label for="dbw">手持ちのダンベル（片手 kg・カンマ区切り）</label>
          <input
            id="dbw"
            class="input num"
            inputMode="decimal"
            value={dbText}
            onInput={(e) => setDbText((e.target as HTMLInputElement).value)}
            onBlur={() => {
              const list = [...new Set(dbText.split(/[,、\s]+/).map(Number).filter((n) => n > 0))].sort((a, b) => a - b)
              if (list.length) {
                updateSettings({ dumbbellWeights: list })
                setDbText(list.join(', '))
              } else setDbText(settings.dumbbellWeights.join(', '))
            }}
          />
        </div>
      </section>

      <section class="section">
        <h2 style={{ marginBottom: '8px' }}>種目</h2>
        <div class="list">
          <a class="row" href="#/settings/exercises">
            <span class="grow">種目マスタ</span>
            <span class="end num">{exercises.length}</span>
            <ChevronRight {...ICON} class="chev" />
          </a>
          <a class="row" href="#/settings/machines">
            <span class="grow">使えるマシン</span>
            <span class="end num">
              {machinesOn}/{machines.length}
            </span>
            <ChevronRight {...ICON} class="chev" />
          </a>
          <a class="row" href="#/settings/exclusions">
            <span class="grow">除外</span>
            <span class="end num">{activeExclusions || 'なし'}</span>
            <ChevronRight {...ICON} class="chev" />
          </a>
          <a class="row" href="#/settings/params">
            <span class="grow">回数・セット・休憩の数値</span>
            <ChevronRight {...ICON} class="chev" />
          </a>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>データ</h2>
          <span class="meta num">{settings.lastExportAt ? `前回の書き出し ${formatShortDate(settings.lastExportAt)}` : 'まだ書き出していません'}</span>
        </div>
        <div class="grid-2">
          <button class="btn" onClick={doExport}>
            <Download {...ICON} />
            書き出す
          </button>
          <button class="btn" onClick={() => file.current?.click()}>
            <Upload {...ICON} />
            読み込む
          </button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target as HTMLInputElement)} />
        <p class="meta" style={{ marginTop: '8px' }}>
          記録はこのiPhoneの中だけに保存されます。ホーム画面に追加して使い、ときどきJSONで書き出しておくと安心です
        </p>
      </section>
    </div>
  )
}

export function Machines() {
  const { settings, exercises } = useData()
  const machines = exercises.filter(isMachine)
  return (
    <SubPage title="使えるマシン">
      <p class="meta" style={{ marginTop: '4px' }}>ジムにないマシンを外すと、メニューに出なくなります</p>
      <div class="list" style={{ marginTop: '16px' }}>
        {machines.map((ex) => (
          <div class="field-row">
            <span>{ex.name}</span>
            <Switch
              label={ex.name}
              checked={!settings.unavailableExercises.includes(ex.id)}
              onChange={(v) =>
                updateAndRegenerate({
                  unavailableExercises: v ? settings.unavailableExercises.filter((id) => id !== ex.id) : [...settings.unavailableExercises, ex.id],
                })
              }
            />
          </div>
        ))}
      </div>
    </SubPage>
  )
}

const REASON: Record<string, string> = { equipment: '器具OFF', machine: 'マシンなし', excluded: '除外中', abs: '腹筋OFF' }

export function ExerciseList() {
  const { exercises, settings } = useData()
  const today = todayISO()
  const groups = useMemo(() => {
    const byMuscle = new Map<Muscle, Exercise[]>()
    for (const ex of exercises) {
      const prim = (Object.keys(ex.muscles) as Muscle[]).find((m) => (ex.muscles[m] ?? 0) >= 1) ?? 'chest'
      byMuscle.set(prim, [...(byMuscle.get(prim) ?? []), ex])
    }
    return MUSCLES.filter((m) => byMuscle.has(m.id)).map((m) => ({ label: m.label, list: byMuscle.get(m.id)! }))
  }, [exercises])

  return (
    <SubPage
      title="種目マスタ"
      action={
        <button class="btn small" onClick={() => go('settings/exercise/new')}>
          <Plus {...ICON} size={16} />
          追加
        </button>
      }
    >
      {groups.map((g) => (
        <section class="section" style={{ marginTop: '24px' }}>
          <h3 class="meta" style={{ marginBottom: '8px' }}>
            {g.label}
          </h3>
          <div class="list">
            {g.list.map((ex) => {
              const reason = unavailableReason(ex, settings, today)
              const fav = settings.favorites.includes(ex.id)
              return (
                <a class="row" href={`#/settings/exercise/${ex.id}`}>
                  <span class="grow">
                    <span class="title ellipsis" style={{ display: 'block' }}>
                      {ex.name}
                    </span>
                    <span class="sub">
                      {exerciseMeta(ex)}
                      {fav ? ' · お気に入り' : ''}
                      {settings.initialRecords[ex.id] ? ' · 記録あり' : ''}
                    </span>
                  </span>
                  {reason && <span class="mono muted">{REASON[reason]}</span>}
                  <ChevronRight {...ICON} class="chev" />
                </a>
              )
            })}
          </div>
        </section>
      ))}
    </SubPage>
  )
}

const PATTERNS = Object.keys(PATTERN_LABEL) as Pattern[]
const JOINTS = Object.keys(JOINT_LABEL) as Joint[]

function blankExercise(): Exercise {
  return {
    id: `custom_${Date.now().toString(36)}`,
    name: '',
    equipment: ['dumbbell'],
    pattern: 'isolation',
    type: 'isolation',
    muscles: {},
    jointStress: {},
    isMainLift: false,
  }
}

export function ExerciseEdit({ id }: { id?: string }) {
  const { exMap, settings } = useData()
  const existing = id && id !== 'new' ? exMap.get(id) : undefined
  const [ex, setEx] = useState<Exercise>(() => (existing ? JSON.parse(JSON.stringify(existing)) : blankExercise()))
  const today = todayISO()
  const exclusion = settings.exclusions.find((x) => x.type === 'exercise' && x.target === ex.id)
  const [exMode, setExMode] = useState<'none' | 'forever' | 'until'>(exclusion ? (exclusion.until ? 'until' : 'forever') : 'none')
  const [until, setUntil] = useState(exclusion?.until ?? today)
  const init = settings.initialRecords[ex.id]
  const [initW, setInitW] = useState(init ? String(init.weight) : '')
  const [initR, setInitR] = useState(init ? String(init.reps) : '')
  const fav = settings.favorites.includes(ex.id)
  const [favorite, setFavorite] = useState(fav)
  const set = (patch: Partial<Exercise>) => setEx((e) => ({ ...e, ...patch }))
  const hasPrimary = Object.values(ex.muscles).some((v) => (v ?? 0) >= 1)
  const valid = ex.name.trim().length > 0 && ex.equipment.length > 0 && hasPrimary

  const saveAll = async () => {
    const clean: Exercise = { ...ex, name: ex.name.trim() }
    if (!clean.increment) delete clean.increment
    await db.exercises.put(clean)
    const exclusions: Exclusion[] = settings.exclusions.filter((x) => !(x.type === 'exercise' && x.target === ex.id))
    if (exMode !== 'none') exclusions.push({ target: ex.id, type: 'exercise', ...(exMode === 'until' ? { until } : {}) })
    const initialRecords = { ...settings.initialRecords }
    const w = Number(initW)
    const r = Number(initR)
    if (initW !== '' && initR !== '' && w >= 0 && r > 0) initialRecords[ex.id] = { weight: w, reps: r }
    else delete initialRecords[ex.id]
    const favorites = favorite ? [...new Set([...settings.favorites, ex.id])] : settings.favorites.filter((f) => f !== ex.id)
    const exclusionChanged = JSON.stringify(exclusions) !== JSON.stringify(settings.exclusions)
    await updateSettings({ exclusions, initialRecords, favorites })
    if (exclusionChanged) await regeneratePlan(today)
    toast('保存しました')
    back('settings/exercises')
  }

  const remove = async () => {
    if (!confirm(`${ex.name}を種目マスタから削除します`)) return
    await db.exercises.delete(ex.id)
    back('settings/exercises')
  }

  return (
    <SubPage title={existing ? ex.name || '種目' : '種目を追加'} fallback="settings/exercises">
      <div class="stack-16" style={{ marginTop: '16px' }}>
        <div class="field">
          <label for="exname">名前</label>
          <input id="exname" class="input" value={ex.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
        </div>

        <div class="field">
          <span class="label">必要な器具</span>
          <div class="chips">
            {EQUIPMENT.map((e) => {
              const on = ex.equipment.includes(e.id)
              return (
                <button type="button" class="chip" aria-pressed={on} onClick={() => set({ equipment: on ? ex.equipment.filter((x) => x !== e.id) : [...ex.equipment, e.id as EquipmentId] })}>
                  {e.label}
                </button>
              )
            })}
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="pattern">動作パターン</label>
            <select id="pattern" class="input" value={ex.pattern} onChange={(e) => set({ pattern: (e.target as HTMLSelectElement).value as Pattern })}>
              {PATTERNS.map((p) => (
                <option value={p}>{PATTERN_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="type">種類</label>
            <select id="type" class="input" value={ex.type} onChange={(e) => set({ type: (e.target as HTMLSelectElement).value as Exercise['type'] })}>
              <option value="compound">多関節</option>
              <option value="isolation">単関節</option>
            </select>
          </div>
        </div>

        <div>
          <div class="section-head">
            <span class="label">部位（主働筋 1.0 · 補助筋 0.5）</span>
            {!hasPrimary && <span class="meta neg">主働筋を1つ選ぶ</span>}
          </div>
          <div class="list">
            {MUSCLES.map((m) => (
              <div class="field-row">
                <span>{m.label}</span>
                <div style={{ width: '184px' }}>
                  <Segmented<number>
                    label={m.label}
                    value={ex.muscles[m.id] ?? 0}
                    options={[
                      { value: 0, label: '—' },
                      { value: 0.5, label: '補助' },
                      { value: 1, label: '主' },
                    ]}
                    onChange={(v) => {
                      const muscles = { ...ex.muscles }
                      if (v) muscles[m.id] = v
                      else delete muscles[m.id]
                      set({ muscles })
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span class="label">関節の負担（0–3）</span>
          <div class="list" style={{ marginTop: '8px' }}>
            {JOINTS.map((j) => (
              <div class="field-row">
                <span>{JOINT_LABEL[j]}</span>
                <div style={{ width: '184px' }}>
                  <Segmented<number>
                    label={JOINT_LABEL[j]}
                    value={ex.jointStress[j] ?? 0}
                    options={[0, 1, 2, 3].map((v) => ({ value: v, label: String(v) }))}
                    onChange={(v) => {
                      const jointStress = { ...ex.jointStress }
                      if (v) jointStress[j] = v
                      else delete jointStress[j]
                      set({ jointStress })
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div class="list">
          <div class="field-row">
            <span>筋力モードのメイン種目</span>
            <Switch label="メイン種目" checked={ex.isMainLift} onChange={(isMainLift) => set({ isMainLift })} />
          </div>
          <div class="field-row">
            <span>お気に入り</span>
            <Switch label="お気に入り" checked={favorite} onChange={setFavorite} />
          </div>
          <div class="field-row">
            <span>
              重量の刻み
              <span class="meta"> kg・空欄で器具の初期値</span>
            </span>
            <input
              class="input num-input num"
              inputMode="decimal"
              value={ex.increment ?? ''}
              onInput={(e) => {
                const v = Number((e.target as HTMLInputElement).value)
                set({ increment: v > 0 ? v : undefined })
              }}
            />
          </div>
        </div>

        <div class="field">
          <span class="label">除外</span>
          <Segmented
            label="除外"
            value={exMode}
            options={[
              { value: 'none', label: 'しない' },
              { value: 'forever', label: '期限なし' },
              { value: 'until', label: '期限付き' },
            ]}
            onChange={setExMode}
          />
          {exMode === 'until' && <input type="date" class="input" value={until} min={today} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} />}
        </div>

        <div class="field">
          <span class="label">最初の重量（分かる場合）</span>
          <div class="grid-2">
            <input class="input num" inputMode="decimal" placeholder="重量 kg" value={initW} onInput={(e) => setInitW((e.target as HTMLInputElement).value)} />
            <input class="input num" inputMode="numeric" placeholder="回数" value={initR} onInput={(e) => setInitR((e.target as HTMLInputElement).value)} />
          </div>
          <p class="meta">推定1RMから今の回数範囲に換算します。空欄なら初回は探り（軽い重量から少しずつ上げる）になります</p>
        </div>

        <button class="btn primary big" disabled={!valid} onClick={saveAll}>
          保存
        </button>
        {existing && !existing.builtin && (
          <button class="btn quiet danger block" onClick={remove}>
            この種目を削除
          </button>
        )}
      </div>
    </SubPage>
  )
}

export function Exclusions() {
  const { settings, exMap } = useData()
  const today = todayISO()
  const [pattern, setPattern] = useState<Pattern>('hinge')
  const [hasUntil, setHasUntil] = useState(false)
  const [until, setUntil] = useState(today)

  const remove = (x: Exclusion) => updateAndRegenerate({ exclusions: settings.exclusions.filter((e) => e !== x) })
  const add = () => {
    const rest = settings.exclusions.filter((e) => !(e.type === 'pattern' && e.target === pattern))
    updateAndRegenerate({ exclusions: [...rest, { target: pattern, type: 'pattern', ...(hasUntil ? { until } : {}) }] })
  }

  return (
    <SubPage title="除外">
      <p class="meta" style={{ marginTop: '4px' }}>除外した種目と動作パターンはメニューに出ません。種目単位の除外は種目マスタから設定します</p>

      <section class="section">
        <div class="list">
          {settings.exclusions.length === 0 && <p class="empty">除外はありません</p>}
          {settings.exclusions.map((x) => {
            const active = isActiveExclusion(x, today)
            const name = x.type === 'pattern' ? `${PATTERN_LABEL[x.target]}（動作パターン）` : exMap.get(x.target)?.name ?? x.target
            return (
              <div class="row">
                <span class="grow">
                  <span class="title" style={{ display: 'block' }}>
                    {name}
                  </span>
                  <span class="sub num">{x.until ? `${formatShortDate(x.until)}まで${active ? '' : ' · 期限切れ'}` : '期限なし'}</span>
                </span>
                <button class="icon-btn" aria-label={`${name}の除外を解除`} onClick={() => remove(x)}>
                  <X {...ICON} />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section class="section stack-12">
        <h2>動作パターンを除外</h2>
        <select class="input" value={pattern} onChange={(e) => setPattern((e.target as HTMLSelectElement).value as Pattern)} aria-label="動作パターン">
          {PATTERNS.filter((p) => p !== 'isolation').map((p) => (
            <option value={p}>{PATTERN_LABEL[p]}</option>
          ))}
        </select>
        <div class="list">
          <div class="field-row">
            <span>期限を付ける</span>
            <Switch label="期限を付ける" checked={hasUntil} onChange={setHasUntil} />
          </div>
          {hasUntil && (
            <div class="field-row">
              <span>最終日</span>
              <input type="date" class="input" style={{ width: '168px' }} value={until} min={today} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} />
            </div>
          )}
        </div>
        <button class="btn block" onClick={add}>
          除外する
        </button>
      </section>
    </SubPage>
  )
}

type NumKey = { label: string; get: (p: ModeParams) => number; set: (p: ModeParams, v: number) => void; step: number; unit: string }

const PARAM_FIELDS: { title: string; fields: NumKey[] }[] = [
  {
    title: '回数',
    fields: [
      { label: 'メイン種目 下限', get: (p) => p.mainRep[0], set: (p, v) => (p.mainRep[0] = v), step: 1, unit: '回' },
      { label: 'メイン種目 上限', get: (p) => p.mainRep[1], set: (p, v) => (p.mainRep[1] = v), step: 1, unit: '回' },
      { label: '補助・単関節 下限', get: (p) => p.accRep[0], set: (p, v) => (p.accRep[0] = v), step: 1, unit: '回' },
      { label: '補助・単関節 上限', get: (p) => p.accRep[1], set: (p, v) => (p.accRep[1] = v), step: 1, unit: '回' },
      { label: '目標RIR 下限', get: (p) => p.targetRir[0], set: (p, v) => (p.targetRir[0] = v), step: 1, unit: '' },
      { label: '目標RIR 上限', get: (p) => p.targetRir[1], set: (p, v) => (p.targetRir[1] = v), step: 1, unit: '' },
    ],
  },
  {
    title: 'セット',
    fields: [
      { label: '部位あたり週 下限', get: (p) => p.weeklySets.min, set: (p, v) => (p.weeklySets.min = v), step: 1, unit: 'セット' },
      { label: '部位あたり週 目標', get: (p) => p.weeklySets.target, set: (p, v) => (p.weeklySets.target = v), step: 1, unit: 'セット' },
      { label: '部位あたり週 上限', get: (p) => p.weeklySets.max, set: (p, v) => (p.weeklySets.max = v), step: 1, unit: 'セット' },
      { label: 'メイン種目', get: (p) => p.setsMain, set: (p, v) => (p.setsMain = v), step: 1, unit: 'セット' },
      { label: '補助・単関節', get: (p) => p.setsAcc, set: (p, v) => (p.setsAcc = v), step: 1, unit: 'セット' },
    ],
  },
  {
    title: '休憩',
    fields: [
      { label: '多関節', get: (p) => p.restCompoundSec, set: (p, v) => (p.restCompoundSec = v), step: 15, unit: '秒' },
      { label: '単関節', get: (p) => p.restIsolationSec, set: (p, v) => (p.restIsolationSec = v), step: 15, unit: '秒' },
    ],
  },
]

export function ModeParamsEdit() {
  const { settings } = useData()
  const [mode, setMode] = useState<Mode>(settings.mode)
  const params = settings.modeParams[mode]

  const change = (f: NumKey, v: number) => {
    const next: ModeParams = JSON.parse(JSON.stringify(params))
    f.set(next, v)
    updateAndRegenerate({ modeParams: { ...settings.modeParams, [mode]: next } })
  }

  return (
    <SubPage title="数値">
      <div style={{ marginTop: '16px' }}>
        <Segmented<Mode> label="モード" value={mode} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
      </div>
      {PARAM_FIELDS.map((g) => (
        <section class="section" style={{ marginTop: '24px' }}>
          <h3 class="meta" style={{ marginBottom: '8px' }}>
            {g.title}
          </h3>
          <div class="list">
            {g.fields.map((f) => (
              <div class="field-row">
                <span>
                  {f.label}
                  {f.unit && <span class="meta"> {f.unit}</span>}
                </span>
                <div style={{ width: '168px' }}>
                  <Stepper compact label={f.label} value={f.get(params)} step={f.step} min={0} onChange={(v) => change(f, v)} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section class="section">
        <button
          class="btn block"
          onClick={() => updateAndRegenerate({ modeParams: { ...settings.modeParams, [mode]: JSON.parse(JSON.stringify(MODE_PARAMS[mode])) } })}
        >
          {MODE_LABEL[mode]}の数値を初期値に戻す
        </button>
      </section>
    </SubPage>
  )
}
