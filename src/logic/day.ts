// 1日分のメニューを、今日の状態（痛み・ブランク・デロード・持ち時間）に合わせて整える
import {
  activePains,
  adjustRir,
  adjustSets,
  applyWeightAdjusts,
  deloadActive,
  deloadAdjust,
  isProbeAdjust,
  painAction,
  painReplacement,
  releaseAdjust,
  returnAdjust,
} from './adjust'
import { isAvailable } from './availability'
import { trimToBudget, type Cut } from './budget'
import { makeItem } from './generator'
import { doneDates, historyFor, suggestNext, warmupLadder, type HistoryEntry, type Suggestion } from './progression'
import type { Adjust, Exercise, Joint, Pain, PlanItem, Session, SetRecord, Settings } from './types'
import { weightRuleFor, type WeightRule } from './weights'

export interface PreparedItem extends PlanItem {
  adjust: Adjust[]
}

export interface PreparedDay {
  items: PreparedItem[]
  replaced: { from: string; to: string; joint: Joint }[]
  excluded: { exerciseId: string; joint: Joint }[]
  trimmed: Cut[]
  /** 削っても持ち時間を超える */
  over: boolean
  /** 強い痛みのある関節（受診を促す表示に使う） */
  severe: Joint[]
}

export interface DayContext {
  exercises: Exercise[]
  exMap: Map<string, Exercise>
  settings: Settings
  pains: Pain[]
  sessions: Session[]
  today: string
  excludeSessionId?: number
}

/** 全体の空白で復帰プランを断っていれば、その空白の直前の日 */
function declinedGapStart(settings: Settings): string | undefined {
  return settings.returnDecision && !settings.returnDecision.use ? settings.returnDecision.gapStart : undefined
}

/** ある種目に今日かける調整（痛みによる置換・除外は prepareDay が先に済ませる） */
export function adjustsFor(ex: Exercise, ctx: DayContext, painAdjust?: Adjust): Adjust[] {
  const dates = doneDates(ctx.sessions, ex.id, ctx.excludeSessionId)
  const list: (Adjust | undefined)[] = [
    returnAdjust(dates, ctx.today, declinedGapStart(ctx.settings)),
    painAdjust,
    releaseAdjust(ex, ctx.pains, dates[0], ctx.today),
    deloadActive(ctx.settings, ctx.today) ? deloadAdjust() : undefined,
  ]
  return list.filter((a): a is Adjust => !!a)
}

export function finalizeItem(item: PlanItem, adjust: Adjust[]): PreparedItem {
  const probe = isProbeAdjust(adjust)
  return {
    ...item,
    sets: adjustSets(item.sets, adjust),
    targetRir: adjustRir(item.targetRir, adjust),
    warmupSets: probe ? 0 : item.warmupSets,
    adjust,
  }
}

/**
 * 手順：痛みで置換・除外 → 復帰・痛み・解除・デロードの調整 → 当日の持ち時間で削る
 */
export function prepareDay(items: PlanItem[], ctx: DayContext, budgetMin?: number): PreparedDay {
  const pains = activePains(ctx.pains, ctx.today)
  const params = ctx.settings.modeParams[ctx.settings.mode]
  const inDay = new Set(items.map((i) => i.exerciseId))
  const out: PreparedItem[] = []
  const replaced: PreparedDay['replaced'] = []
  const excluded: PreparedDay['excluded'] = []

  for (const original of items) {
    let item = original
    let ex = ctx.exMap.get(item.exerciseId)
    if (!ex) continue
    let painAdj: Adjust | undefined
    const pa = painAction(ex, pains)
    if (pa.action === 'exclude') {
      excluded.push({ exerciseId: ex.id, joint: pa.joint })
      continue
    }
    if (pa.action === 'replace') {
      const pool = ctx.exercises.filter((c) => !inDay.has(c.id) && isAvailable(c, ctx.settings, ctx.today))
      const to = painReplacement(ex, pool, pains, pa.joint)
      if (to) {
        replaced.push({ from: ex.id, to: to.id, joint: pa.joint })
        inDay.add(to.id)
        item = { ...makeItem(to, ctx.settings.mode, params), sets: item.sets }
        ex = to
      } else painAdj = pa.fallback
    }
    if (pa.action === 'lighten') painAdj = pa.adjust
    out.push(finalizeItem(item, adjustsFor(ex, ctx, painAdj)))
  }

  let trimmed: Cut[] = []
  let over = false
  let final = out
  if (budgetMin !== undefined) {
    const r = trimToBudget(out, budgetMin, ctx.exMap)
    final = r.items as PreparedItem[]
    trimmed = r.cuts
    over = r.over
  }
  const severe = [...new Set(pains.filter((p) => p.level === 'severe').map((p) => p.joint))]
  return { items: final, replaced, excluded, trimmed, over, severe }
}

export interface Prescription {
  ex: Exercise
  rule: WeightRule
  /** 調整後の提案 */
  suggestion: Suggestion
  /** 調整前の提案（漸進性どおりの値） */
  base: Suggestion
  history: HistoryEntry[]
  warmups: SetRecord[]
}

type Target = Pick<PlanItem, 'repMin' | 'repMax' | 'targetRir' | 'warmupSets'> & { sets: number }

/** 重量・回数の提案。セット数とRIRは調整済みの値を受け取り、重量だけここで掛ける */
export function prescribeItem(ex: Exercise, target: Target, adjust: Adjust[], ctx: Pick<DayContext, 'sessions' | 'settings' | 'excludeSessionId'>): Prescription {
  const rule = weightRuleFor(ex, ctx.settings)
  const history = historyFor(ctx.sessions, ex.id, ctx.excludeSessionId)
  const base = suggestNext({
    history,
    target: { repMin: target.repMin, repMax: target.repMax, sets: target.sets, targetRir: target.targetRir },
    rule,
    initial: ctx.settings.initialRecords[ex.id],
  })
  const suggestion = applyWeightAdjusts(base, adjust, rule)
  const warmups = suggestion.weight ? warmupLadder(suggestion.weight, target.warmupSets, rule) : []
  return { ex, rule, suggestion, base, history, warmups }
}
