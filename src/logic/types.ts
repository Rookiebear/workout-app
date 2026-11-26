export type Mode = 'hypertrophy' | 'strength' | 'cut'

export type EquipmentId =
  | 'smith'
  | 'dumbbell'
  | 'bench'
  | 'machine_upper'
  | 'machine_lower'
  | 'bodyweight'
  | 'cable'

export type Pattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'isolation'

export type Muscle =
  | 'chest'
  | 'lats'
  | 'upper_back'
  | 'front_delt'
  | 'side_delt'
  | 'rear_delt'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs'

export type Joint = 'shoulder' | 'elbow' | 'wrist' | 'lower_back' | 'knee' | 'hip' | 'neck'

export interface Exercise {
  id: string
  name: string
  equipment: EquipmentId[]
  pattern: Pattern
  type: 'compound' | 'isolation'
  muscles: Partial<Record<Muscle, number>>
  jointStress: Partial<Record<Joint, number>>
  isMainLift: boolean
  increment?: number
  /** true for entries that came from data/exercises.json */
  builtin?: boolean
}

export interface ModeParams {
  mainRep: [number, number]
  accRep: [number, number]
  targetRir: [number, number]
  weeklySets: { min: number; target: number; max: number }
  setsMain: number
  setsAcc: number
  restCompoundSec: number
  restIsolationSec: number
}

export interface Exclusion {
  target: string
  type: 'exercise' | 'pattern'
  /** YYYY-MM-DD, inclusive. Missing means no end */
  until?: string
}

export interface InitialRecord {
  weight: number
  reps: number
}

export interface Settings {
  id: 'main'
  onboarded: boolean
  mode: Mode
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  equipmentEnabled: Record<EquipmentId, boolean>
  /** Machine exercises the gym does not have */
  unavailableExercises: string[]
  /** Per-hand weights in kg, ascending */
  dumbbellWeights: number[]
  smithBarWeight: number
  modeParams: Record<Mode, ModeParams>
  favorites: string[]
  exclusions: Exclusion[]
  initialRecords: Record<string, InitialRecord>
  includeAbs: boolean
  /** weekday → minutes */
  dayBudgets: Record<number, number>
  lastExportAt?: string
  /** 受け入れたデロードの期間 */
  deload?: { start: string; end: string }
  /** 直近のデロードの最終日。6週のカウントはここから */
  lastDeloadEnd?: string
  /** 見送ったデロード提案を再び出さない最終日 */
  deloadSnoozeUntil?: string
  /** 全体の空白に対する復帰プランの返事。gapStart はその空白の直前の実施日 */
  returnDecision?: { gapStart: string; use: boolean }
  /** 痛みの確認をした日 */
  painCheckedOn?: string
}

export type AdjustKind = 'return' | 'pain' | 'release' | 'deload'

/** 重量・セット・RIRへの一時的な調整。調整したセットは重量提案の履歴に使わない */
export interface Adjust {
  kind: AdjustKind
  label: string
  weightFactor?: number
  setsFactor?: number
  rirPlus?: number
  /** 探りに戻す（3か月以上のブランク） */
  probe?: boolean
}

export type Role = 'main' | 'accessory'

export interface PlanItem {
  exerciseId: string
  role: Role
  sets: number
  warmupSets: number
  repMin: number
  repMax: number
  targetRir: [number, number]
  restSec: number
}

export interface PlanDay {
  weekday: number
  splitKey: SplitKey
  splitName: string
  items: PlanItem[]
}

export interface Plan {
  id?: number
  createdAt: string
  weekStart: string
  mode: Mode
  days: PlanDay[]
}

export type SplitKey = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs'

export interface SetRecord {
  weight: number
  reps: number
  rir?: number
  isWarmup: boolean
  doneAt?: number
}

export interface SessionEntry {
  exerciseId: string
  role: Role
  repMin: number
  repMax: number
  targetRir: [number, number]
  restSec: number
  plannedSets: number
  warmupSets: number
  isProbe?: boolean
  adjust?: Adjust[]
  sets: SetRecord[]
}

export interface Session {
  id?: number
  date: string
  startedAt: number
  finishedAt?: number
  status: 'active' | 'done'
  planId?: number
  planDayIndex?: number
  splitName: string
  mode: Mode
  timeBudgetMin?: number
  fatigue?: number
  note: string
  entries: SessionEntry[]
  rest?: { startAt: number; durationSec: number }
}

export interface Pain {
  id?: number
  joint: Joint
  side: 'left' | 'right' | 'both'
  level: 'light' | 'moderate' | 'severe'
  startDate: string
  endDate?: string
}

export interface BodyMetric {
  id?: number
  date: string
  weightKg: number
  bodyFatPct?: number
}
