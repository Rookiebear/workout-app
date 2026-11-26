// 痛み・ブランク復帰・デロードによる一時的な調整。どれも日付を引数で受け取る純粋関数
import { DELOAD, GLOBAL_GAP_DAYS, JOINT_LABEL, PAIN, RETURN_RAMP_DAYS, RETURN_RULES } from '../config/defaults'
import { addDays, daysBetween } from './dates'
import type { Suggestion } from './progression'
import type { Adjust, Exercise, Joint, Pain, Settings } from './types'
import { isFixedLoad, roundWeight, type WeightRule } from './weights'

// ── 痛み ─────────────────────────────────────────────────

export function activePains(pains: Pain[], today: string): Pain[] {
  return pains.filter((p) => p.startDate <= today && (!p.endDate || p.endDate > today))
}

export type PainAction =
  | { action: 'ok' }
  | { action: 'replace'; joint: Joint; fallback: Adjust }
  | { action: 'lighten'; joint: Joint; adjust: Adjust }
  | { action: 'exclude'; joint: Joint; level: Pain['level'] }

const RANK = { ok: 0, lighten: 1, replace: 2, exclude: 3 }

/**
 * 判定表：
 * - 軽い：負担2以上 → 同じ主働筋で負担が低い種目に置換（できなければ重量80%・RIR+1）
 * - 中程度：負担2以上 → 除外、負担1 → 重量80%
 * - 強い：負担1以上 → 除外
 * 左右は記録するが判定は共通。複数の痛みは強い方の動きを取る
 */
export function painAction(ex: Exercise, pains: Pain[]): PainAction {
  let result: PainAction = { action: 'ok' }
  const take = (next: PainAction) => {
    if (RANK[next.action] > RANK[result.action]) result = next
    else if (next.action === 'lighten' && result.action === 'lighten') {
      result = { ...result, adjust: mergePainAdjust(result.adjust, next.adjust) }
    }
  }
  for (const p of pains) {
    const stress = ex.jointStress[p.joint] ?? 0
    const where = JOINT_LABEL[p.joint]
    if (p.level === 'severe' && stress >= PAIN.severe.excludeAt) take({ action: 'exclude', joint: p.joint, level: p.level })
    else if (p.level === 'moderate') {
      if (stress >= PAIN.moderate.excludeAt) take({ action: 'exclude', joint: p.joint, level: p.level })
      else if (stress >= PAIN.moderate.lightenAt)
        take({ action: 'lighten', joint: p.joint, adjust: { kind: 'pain', label: `${where}の負担を軽く`, weightFactor: PAIN.moderate.weight } })
    } else if (p.level === 'light' && stress >= PAIN.light.replaceAt) {
      take({
        action: 'replace',
        joint: p.joint,
        fallback: { kind: 'pain', label: `${where}の負担を軽く`, weightFactor: PAIN.light.weight, rirPlus: PAIN.light.rirPlus },
      })
    }
  }
  return result
}

function mergePainAdjust(a: Adjust, b: Adjust): Adjust {
  return {
    ...a,
    weightFactor: Math.min(a.weightFactor ?? 1, b.weightFactor ?? 1),
    rirPlus: Math.max(a.rirPlus ?? 0, b.rirPlus ?? 0) || undefined,
  }
}

/** 置換先：同じ主働筋を持ち、痛みの判定が問題ない種目。同じ動作パターン→負担の低い順 */
export function painReplacement(ex: Exercise, candidates: Exercise[], pains: Pain[], joint: Joint): Exercise | undefined {
  const prim = Object.keys(ex.muscles).filter((m) => (ex.muscles[m as keyof Exercise['muscles']] ?? 0) >= 1)
  const stress = ex.jointStress[joint] ?? 0
  return candidates
    .filter((c) => c.id !== ex.id)
    .filter((c) => prim.some((m) => (c.muscles[m as keyof Exercise['muscles']] ?? 0) >= 1))
    .filter((c) => (c.jointStress[joint] ?? 0) < stress && painAction(c, pains).action === 'ok')
    .sort(
      (a, b) =>
        (a.pattern === ex.pattern ? 0 : 1) - (b.pattern === ex.pattern ? 0 : 1) ||
        (a.type === ex.type ? 0 : 1) - (b.type === ex.type ? 0 : 1) ||
        (a.jointStress[joint] ?? 0) - (b.jointStress[joint] ?? 0),
    )[0]
}

/** 解除後の初回は、その関節に関わる種目を重量90%から再開 */
export function releaseAdjust(ex: Exercise, pains: Pain[], lastDone: string | undefined, today: string): Adjust | undefined {
  const released = pains.filter((p) => p.endDate && p.endDate <= today && (ex.jointStress[p.joint] ?? 0) >= 1)
  const hit = released.find((p) => lastDone !== undefined && lastDone < (p.endDate as string))
  if (!hit) return undefined
  return { kind: 'release', label: `${JOINT_LABEL[hit.joint]}の痛みから再開`, weightFactor: PAIN.releaseWeight }
}

// ── ブランク復帰 ─────────────────────────────────────────

function ruleFor(days: number) {
  return [...RETURN_RULES].reverse().find((r) => days >= r.minDays)
}

/**
 * その種目の実施日（新しい順）から、復帰の調整を決める。
 * - 2–4週：重量90%・セット80%。1回実施したら通常に戻す
 * - 1–3か月：重量80%・セット70%。2週間かけて段階的に戻す
 * - 3か月以上：探り扱い・セット60%
 * `declinedGapStart` は全体の空白で復帰プランを断ったときの、その空白の直前の実施日
 */
export function returnAdjust(dates: string[], today: string, declinedGapStart?: string): Adjust | undefined {
  if (dates.length === 0) return undefined
  const declined = (gapStart: string, gapEnd: string) =>
    declinedGapStart !== undefined && gapStart <= declinedGapStart && gapEnd > declinedGapStart

  // いま空いている
  const now = daysBetween(dates[0], today)
  const current = ruleFor(now)
  if (current) {
    if (declined(dates[0], today)) return undefined
    return {
      kind: 'return',
      label: current.label,
      weightFactor: current.weight ?? undefined,
      setsFactor: current.sets,
      probe: current.mode === 'probe' || undefined,
    }
  }

  // 最近の空白から段階的に戻している途中
  for (let i = 0; i + 1 < dates.length; i++) {
    const gap = daysBetween(dates[i + 1], dates[i])
    const r = ruleFor(gap)
    if (!r) continue
    if (r.mode !== 'ramp' || declined(dates[i + 1], dates[i])) return undefined
    const since = daysBetween(dates[i], today)
    if (since >= RETURN_RAMP_DAYS) return undefined
    const t = since / RETURN_RAMP_DAYS
    const w = r.weight ?? 1
    return {
      kind: 'return',
      label: `${r.label}・段階的に戻す`,
      weightFactor: w + (1 - w) * t,
      setsFactor: r.sets + (1 - r.sets) * t,
    }
  }
  return undefined
}

/** 最後のトレーニングから2週以上空いていれば、その空白の直前の実施日 */
export function globalGap(lastSessionDate: string | undefined, today: string): string | undefined {
  if (!lastSessionDate) return undefined
  return daysBetween(lastSessionDate, today) >= GLOBAL_GAP_DAYS ? lastSessionDate : undefined
}

// ── デロード ─────────────────────────────────────────────

export function deloadActive(settings: Pick<Settings, 'deload'>, today: string): boolean {
  return !!settings.deload && settings.deload.start <= today && today <= settings.deload.end
}

export function deloadAdjust(): Adjust {
  return { kind: 'deload', label: 'デロード', weightFactor: DELOAD.weightFactor, setsFactor: DELOAD.setsFactor }
}

export interface DeloadAdvice {
  due: boolean
  reason?: 'weeks' | 'stall'
  weeks?: number
}

/**
 * 2週以上の空白は休養とみなし、デロードの6週をそこから数え直す。
 * 実施日（新しい順）から、直近の空白の明けた日を返す。いま空いていれば今日
 */
export function lastBreakEnd(dates: string[], today: string): string | undefined {
  if (dates.length === 0) return undefined
  if (daysBetween(dates[0], today) >= GLOBAL_GAP_DAYS) return today
  for (let i = 0; i + 1 < dates.length; i++) {
    if (daysBetween(dates[i + 1], dates[i]) >= GLOBAL_GAP_DAYS) return dates[i]
  }
  return dates[dates.length - 1]
}

/** 6週ごと、または伸びなしの種目が全体の3分の1を超えたら提案する */
export function deloadAdvice(args: {
  today: string
  settings: Pick<Settings, 'deload' | 'lastDeloadEnd' | 'deloadSnoozeUntil'>
  /** 数え始め：最初のトレーニング、または直近の空白が明けた日 */
  firstSessionDate?: string
  stalled: number
  total: number
}): DeloadAdvice {
  const { today, settings } = args
  if (deloadActive(settings, today)) return { due: false }
  if (settings.deloadSnoozeUntil && today <= settings.deloadSnoozeUntil) return { due: false }
  if (args.firstSessionDate && daysBetween(args.firstSessionDate, today) === 0) return { due: false }
  if (args.total > 0 && args.stalled / args.total > DELOAD.stallShare) return { due: true, reason: 'stall' }
  const from = [settings.lastDeloadEnd, args.firstSessionDate].filter((d): d is string => !!d).sort().pop()
  if (!from) return { due: false }
  const weeks = Math.floor(daysBetween(from, today) / 7)
  return weeks >= DELOAD.everyWeeks ? { due: true, reason: 'weeks', weeks } : { due: false }
}

export function deloadWindow(today: string): { start: string; end: string } {
  return { start: today, end: addDays(today, DELOAD.days - 1) }
}

// ── 適用 ─────────────────────────────────────────────────
// セット数とRIRはメニューを組む時点で確定させ、重量だけを提案のときに掛ける。
// こうするとセッション中に記録した値へ二重に掛からない。

/** セット数に掛ける。四捨五入で1以上 */
export function adjustSets(sets: number, adjusts: Adjust[]): number {
  const f = adjusts.reduce((x, a) => x * (a.setsFactor ?? 1), 1)
  return f === 1 ? sets : Math.max(1, Math.round(sets * f))
}

export function adjustRir(rir: [number, number], adjusts: Adjust[]): [number, number] {
  const p = adjusts.reduce((n, a) => n + (a.rirPlus ?? 0), 0)
  return [rir[0] + p, rir[1] + p]
}

export function isProbeAdjust(adjusts: Adjust[]): boolean {
  return adjusts.some((a) => a.probe)
}

/** 提案の重量に掛ける。刻みに切り捨て。探りに戻す調整があれば重量は未定にする */
export function applyWeightAdjusts(s: Suggestion, adjusts: Adjust[], rule: WeightRule): Suggestion {
  if (adjusts.length === 0) return s
  if (isProbeAdjust(adjusts)) return { ...s, kind: 'probe', weight: isFixedLoad(rule) ? 0 : null }
  const f = adjusts.reduce((x, a) => x * (a.weightFactor ?? 1), 1)
  if (s.weight === null || s.weight <= 0 || f >= 1) return s
  return { ...s, weight: roundWeight(s.weight * f, rule, 'down') }
}
