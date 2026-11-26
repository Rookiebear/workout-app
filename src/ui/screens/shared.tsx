import { Search, Star } from 'lucide-preact'
import { useMemo, useState } from 'preact/hooks'
import { WEEKDAY_LABEL, WEEKDAY_ORDER } from '../../config/defaults'
import { updateSettings } from '../../db/db'
import { isAvailable } from '../../logic/availability'
import type { Exercise } from '../../logic/types'
import { ICON } from '../components'
import { todayISO, useData } from '../hooks'
import { exerciseMeta } from '../workout'

export function WeekdayPicker(props: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div class="days" role="group" aria-label="曜日">
      {WEEKDAY_ORDER.map((d) => {
        const on = props.value.includes(d)
        const full = !on && props.value.length >= 6
        return (
          <button
            type="button"
            aria-pressed={on}
            disabled={full}
            onClick={() => props.onChange(on ? props.value.filter((x) => x !== d) : [...props.value, d])}
          >
            {WEEKDAY_LABEL[d]}
          </button>
        )
      })}
    </div>
  )
}

export function FavoriteButton(props: { id: string }) {
  const { settings } = useData()
  const on = settings.favorites.includes(props.id)
  return (
    <button
      class={`icon-btn${on ? ' on' : ''}`}
      aria-label={on ? 'お気に入りから外す' : 'お気に入りにする'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        updateSettings({ favorites: on ? settings.favorites.filter((f) => f !== props.id) : [...settings.favorites, props.id] })
      }}
    >
      <Star {...ICON} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

/** Searchable list of exercises; `candidates` narrows it, e.g. for a swap */
export function ExercisePicker(props: { candidates?: Exercise[]; onPick: (ex: Exercise) => void; exclude?: string[] }) {
  const data = useData()
  const [q, setQ] = useState('')
  const today = todayISO()
  const list = useMemo(() => {
    const base = props.candidates ?? data.exercises.filter((e) => isAvailable(e, data.settings, today))
    const fav = new Set(data.settings.favorites)
    return base
      .filter((e) => !props.exclude?.includes(e.id))
      .filter((e) => !q || e.name.includes(q))
      .sort((a, b) => (props.candidates ? 0 : (fav.has(a.id) ? 0 : 1) - (fav.has(b.id) ? 0 : 1)))
  }, [q, props.candidates, data])

  return (
    <div class="stack-8">
      <label class="hstack input" style={{ padding: '0 12px' }}>
        <Search {...ICON} class="muted" />
        <input
          style={{ border: 0, background: 'transparent', flex: 1, minHeight: '42px', fontSize: '16px', outline: 'none' }}
          placeholder="検索"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="list">
        {list.length === 0 && <p class="empty">候補がありません</p>}
        {list.map((ex) => (
          <div class="row" style={{ paddingRight: '4px' }}>
            <button class="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, minHeight: '44px' }} onClick={() => props.onPick(ex)}>
              <div class="title">{ex.name}</div>
              <div class="sub">{exerciseMeta(ex)}</div>
            </button>
            <FavoriteButton id={ex.id} />
          </div>
        ))}
      </div>
    </div>
  )
}
