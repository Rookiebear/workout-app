import { useEffect, useState } from 'preact/hooks'
import { JOINT_LABEL, PAIN_LEVEL_HINT, PAIN_LEVEL_LABEL, SIDE_LABEL } from '../../config/defaults'
import { db, updateSettings } from '../../db/db'
import type { Exercise, Joint, Pain } from '../../logic/types'
import { Segmented, Sheet } from '../components'
import { todayISO } from '../hooks'

const JOINTS = Object.keys(JOINT_LABEL) as Joint[]
const LEVELS: Pain['level'][] = ['light', 'moderate', 'severe']
const SIDES: Pain['side'][] = ['left', 'right', 'both']

export const MEDICAL_NOTE = '安静時も痛む場合は、医療機関で診てもらうことをおすすめします。アプリは負担を避けるための調整だけを行います'

/** 種目の負担が大きい関節から順に（セッション中の「痛む」で先頭に出す） */
export function jointsFor(ex?: Exercise): Joint[] {
  if (!ex) return JOINTS
  const stressed = (Object.keys(ex.jointStress) as Joint[]).sort((a, b) => (ex.jointStress[b] ?? 0) - (ex.jointStress[a] ?? 0))
  return [...stressed, ...JOINTS.filter((j) => !stressed.includes(j))]
}

export function painText(p: Pain): string {
  const side = p.side === 'both' ? '' : `（${SIDE_LABEL[p.side]}）`
  return `${JOINT_LABEL[p.joint]}${side} · ${PAIN_LEVEL_LABEL[p.level]}`
}

/** 痛みを記録する */
export function PainSheet(props: { open: boolean; onClose: () => void; onSaved?: (p: Pain) => void; exercise?: Exercise; title?: string }) {
  const order = jointsFor(props.exercise)
  const [joint, setJoint] = useState<Joint>(order[0])
  const [side, setSide] = useState<Pain['side']>('both')
  const [level, setLevel] = useState<Pain['level']>('light')
  useEffect(() => {
    if (props.open) setJoint(jointsFor(props.exercise)[0])
  }, [props.open, props.exercise?.id])

  const save = async () => {
    const p: Pain = { joint, side, level, startDate: todayISO() }
    p.id = await db.pains.add(p)
    await updateSettings({ painCheckedOn: todayISO() })
    props.onSaved?.(p)
    props.onClose()
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title ?? '痛みを記録'}>
      <div class="stack-16">
        <div class="field">
          <span class="label">場所</span>
          <div class="chips">
            {order.map((j) => (
              <button type="button" class="chip" aria-pressed={joint === j} onClick={() => setJoint(j)}>
                {JOINT_LABEL[j]}
                {props.exercise?.jointStress[j] ? <span class="muted"> {props.exercise.jointStress[j]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">左右</span>
          <Segmented label="左右" value={side} options={SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] }))} onChange={setSide} />
        </div>
        <div class="field">
          <span class="label">強さ</span>
          <Segmented label="強さ" value={level} options={LEVELS.map((l) => ({ value: l, label: PAIN_LEVEL_LABEL[l] }))} onChange={setLevel} />
          <p class="meta">{PAIN_LEVEL_HINT[level]}</p>
        </div>
        {level === 'severe' && <p class="note-warn">{MEDICAL_NOTE}</p>}
        <button class="btn primary big" onClick={save}>
          記録して調整する
        </button>
      </div>
    </Sheet>
  )
}

/** セッション開始時の「まだ痛むか」の確認。続ける／強さを変える／解除する */
export function PainCheckSheet(props: { open: boolean; onClose: () => void; pains: Pain[]; onDone: () => void }) {
  const [levels, setLevels] = useState<Record<number, Pain['level'] | 'release'>>({})
  useEffect(() => {
    if (props.open) setLevels(Object.fromEntries(props.pains.map((p) => [p.id!, p.level])))
  }, [props.open])

  const confirm = async () => {
    const today = todayISO()
    for (const p of props.pains) {
      const v = levels[p.id!]
      if (v === 'release') await db.pains.update(p.id!, { endDate: today })
      else if (v && v !== p.level) {
        // 強さが変わったら、前の記録を閉じて新しく始める
        await db.pains.update(p.id!, { endDate: today })
        await db.pains.add({ joint: p.joint, side: p.side, level: v, startDate: today })
      }
    }
    await updateSettings({ painCheckedOn: today })
    props.onDone()
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title="まだ痛みますか">
      <div class="stack-16">
        {props.pains.map((p) => (
          <div class="field">
            <span>
              {JOINT_LABEL[p.joint]}
              {p.side !== 'both' && <span class="meta">（{SIDE_LABEL[p.side]}）</span>}
            </span>
            <Segmented<Pain['level'] | 'release'>
              label={JOINT_LABEL[p.joint]}
              value={levels[p.id!] ?? p.level}
              options={[...LEVELS.map((l) => ({ value: l, label: PAIN_LEVEL_LABEL[l] })), { value: 'release', label: '治った' }]}
              onChange={(v) => setLevels((x) => ({ ...x, [p.id!]: v }))}
            />
          </div>
        ))}
        <p class="meta">治ったものは解除します。解除後の初回は、その関節を使う種目を重量90%から再開します</p>
        <button class="btn primary big" onClick={confirm}>
          この内容で始める
        </button>
      </div>
    </Sheet>
  )
}
