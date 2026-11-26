import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Minus, Plus } from 'lucide-preact'
import { platesPerSide, formatKg, r2 } from '../logic/weights'

export const ICON = { size: 18, strokeWidth: 1.5 } as const

export function Sheet(props: { open: boolean; onClose: () => void; title?: string; action?: ComponentChildren; children: ComponentChildren }) {
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [props.open])
  if (!props.open) return null
  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="grab" />
        {(props.title || props.action) && (
          <div class="sheet-head">
            <h2>{props.title}</h2>
            {props.action}
          </div>
        )}
        {props.children}
      </div>
    </>
  )
}

export function Segmented<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="switch">
      <input type="checkbox" role="switch" aria-label={props.label} checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </label>
  )
}

export function Stepper(props: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  unit?: string
  label: string
  compact?: boolean
  decimals?: boolean
  /** Custom up/down, e.g. the next dumbbell in the list */
  up?: (v: number) => number
  down?: (v: number) => number
}) {
  const min = props.min ?? 0
  const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(min, r2(v)))
  const [text, setText] = useState(formatKg(props.value))
  useEffect(() => setText(formatKg(props.value)), [props.value])
  return (
    <div class={`stepper${props.compact ? ' compact' : ''}`}>
      <button type="button" aria-label={`${props.label}を減らす`} onClick={() => props.onChange(clamp(props.down ? props.down(props.value) : props.value - props.step))}>
        <Minus {...ICON} />
      </button>
      <div class="value">
        <input
          inputMode={props.decimals ? 'decimal' : 'numeric'}
          aria-label={props.label}
          value={text}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={() => {
            const v = Number(text.replace(',', '.'))
            if (Number.isFinite(v)) props.onChange(clamp(v))
            else setText(formatKg(props.value))
          }}
        />
        {props.unit && <span class="unit">{props.unit}</span>}
      </div>
      <button type="button" aria-label={`${props.label}を増やす`} onClick={() => props.onChange(clamp(props.up ? props.up(props.value) : props.value + props.step))}>
        <Plus {...ICON} />
      </button>
    </div>
  )
}

/** Signature: the rep range as a ruler, with this session's target marked */
export function RepLadder(props: { min: number; max: number; target?: number }) {
  const ticks = []
  for (let r = props.min; r <= props.max; r++) {
    const cls = r === props.target ? 'tick target' : props.target !== undefined && r < props.target ? 'tick reached' : 'tick'
    ticks.push(<span class={cls} />)
  }
  return (
    <span class="ladder" aria-label={`${props.min}〜${props.max}回${props.target ? `、目標${props.target}回` : ''}`}>
      <span class="mono">{props.min}</span>
      <span class="ticks">{ticks}</span>
      <span class="mono">{props.max}</span>
    </span>
  )
}

const PLATE_SIZE: Record<number, [number, number]> = {
  20: [14, 80],
  15: [13, 72],
  10: [11, 64],
  5: [9, 48],
  2.5: [7, 38],
  1.25: [6, 30],
}

/** Moment: the smith bar loaded with iron plates, one side */
export function PlateStack(props: { total: number; bar: number }) {
  const { plates, remainder } = platesPerSide(props.total, props.bar)
  const legend = plates.length ? `片側 ${plates.map(formatKg).join(' + ')}` : 'バーのみ'
  return (
    <div>
      <div class="bar" aria-hidden="true">
        <div class="shaft" />
        <div class="collar" />
        {plates.map((p, i) => {
          const [w, h] = PLATE_SIZE[p] ?? [6, 30]
          return <div key={`${props.total}-${i}`} class="plate" style={{ width: `${w}px`, height: `${h}px`, animationDelay: `${i * 30}ms` }} />
        })}
        <div class="sleeve" />
      </div>
      <p class="plates-legend mono">
        {legend} kg · バー {formatKg(props.bar)} kg{remainder > 0 ? ` · 端数 ${formatKg(remainder)} kg` : ''}
      </p>
    </div>
  )
}

export function Check(props: { on: boolean }) {
  return (
    <span class={`check${props.on ? ' on' : ''}`} aria-hidden="true">
      {props.on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  )
}
