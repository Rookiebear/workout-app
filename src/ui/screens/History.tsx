import { ChevronLeft, ChevronRight } from 'lucide-preact'
import { MODE_LABEL, WEEKDAY_LABEL } from '../../config/defaults'
import { db } from '../../db/db'
import { weekdayOf } from '../../logic/dates'
import { working } from '../../logic/progression'
import type { Session } from '../../logic/types'
import { formatKg } from '../../logic/weights'
import { ICON } from '../components'
import { back, go, toast, useData } from '../hooks'

const workSets = (s: Session) => s.entries.reduce((n, e) => n + working(e.sets).length, 0)
const minutes = (s: Session) => (s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : undefined)
const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}月${d}日（${WEEKDAY_LABEL[weekdayOf(iso)]}）`
}

export function HistoryList() {
  const { sessions } = useData()
  const done = sessions
    .filter((s) => s.status === 'done')
    .sort((a, b) => (a.date === b.date ? b.startedAt - a.startedAt : a.date < b.date ? 1 : -1))

  const groups = new Map<string, Session[]>()
  for (const s of done) {
    const key = s.date.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), s])
  }

  return (
    <div class="page">
      <h1>履歴</h1>
      {done.length === 0 && <p class="meta" style={{ marginTop: '16px' }}>記録したトレーニングがここに並びます</p>}
      {[...groups.entries()].map(([month, list]) => {
        const [y, m] = month.split('-').map(Number)
        return (
          <section class="section">
            <div class="section-head">
              <h2>
                {y}年{m}月
              </h2>
              <span class="meta num">{list.length}回</span>
            </div>
            <div class="list">
              {list.map((s) => (
                <a class="row" href={`#/history/${s.id}`}>
                  <span class="grow">
                    <span class="title" style={{ display: 'block' }}>
                      {dayLabel(s.date)} · {s.splitName}
                    </span>
                    <span class="sub num">
                      {s.entries.length}種目 · {workSets(s)}セット{minutes(s) ? ` · ${minutes(s)}分` : ''}
                    </span>
                  </span>
                  <ChevronRight {...ICON} class="chev" />
                </a>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function HistoryDetail({ id }: { id: number }) {
  const { sessions, exMap } = useData()
  const s = sessions.find((x) => x.id === id)
  if (!s) {
    return (
      <div class="page">
        <button class="btn quiet" onClick={() => go('history', true)}>
          履歴へ戻る
        </button>
      </div>
    )
  }
  const active = sessions.find((x) => x.status === 'active')

  const edit = async () => {
    if (active && active.id !== s.id) {
      toast('記録中のセッションを先に終えてください')
      return
    }
    await db.sessions.put({ ...s, status: 'active', rest: undefined })
    go('session')
  }
  const remove = async () => {
    if (!confirm(`${dayLabel(s.date)}の記録を削除します。元に戻せません`)) return
    await db.sessions.delete(id)
    go('history', true)
  }

  return (
    <div class="page">
      <div class="topbar">
        <button class="icon-btn" aria-label="戻る" onClick={() => back('history')}>
          <ChevronLeft {...ICON} size={22} />
        </button>
      </div>
      <p class="eyebrow">
        {dayLabel(s.date)} · {MODE_LABEL[s.mode]}
      </p>
      <h1 style={{ marginTop: '2px' }}>{s.splitName}</h1>
      <p class="meta num" style={{ marginTop: '4px' }}>
        {s.entries.length}種目 · {workSets(s)}セット{minutes(s) ? ` · ${minutes(s)}分` : ''}
      </p>

      {s.entries.map((e) => (
        <section class="section" style={{ marginTop: '24px' }}>
          <div class="section-head">
            <h3>{exMap.get(e.exerciseId)?.name ?? e.exerciseId}</h3>
            <span class="meta num">
              {e.repMin}–{e.repMax}回{e.isProbe ? ' · 探り' : ''}
            </span>
          </div>
          <div class="list">
            {e.sets.map((set, i) => (
              <div class="set-row done">
                <span class="idx">{set.isWarmup ? 'W' : i + 1 - e.sets.slice(0, i).filter((x) => x.isWarmup).length}</span>
                <span class="val">
                  {formatKg(set.weight)}
                  <span class="u">kg</span> × {set.reps}
                  {set.rir !== undefined && <span class="rir">RIR {set.rir}</span>}
                </span>
                <span />
              </div>
            ))}
          </div>
        </section>
      ))}

      {s.note && (
        <section class="section">
          <h3>メモ</h3>
          <p class="meta" style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>
            {s.note}
          </p>
        </section>
      )}

      <section class="section grid-2">
        <button class="btn danger" onClick={remove}>
          削除
        </button>
        <button class="btn" onClick={edit}>
          編集する
        </button>
      </section>
    </div>
  )
}
