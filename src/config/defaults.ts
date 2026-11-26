// All numbers from docs/REQUIREMENTS.md live here. Settings can override the mode table.
import type { EquipmentId, Mode, ModeParams, Muscle, Settings, SplitKey } from '../logic/types'

export const SCHEMA_VERSION = 1

// ── 目的モード ────────────────────────────────────────────
// Ranges from the spec are kept as comments; the default value used for the timer
// and the generator is the midpoint unless noted.
export const MODE_PARAMS: Record<Mode, ModeParams> = {
  hypertrophy: {
    mainRep: [6, 10],
    accRep: [10, 15],
    targetRir: [1, 2],
    weeklySets: { min: 10, target: 12, max: 16 },
    setsMain: 3,
    setsAcc: 3,
    restCompoundSec: 150, // 2–3分
    restIsolationSec: 90,
  },
  strength: {
    mainRep: [3, 6],
    accRep: [8, 12],
    targetRir: [2, 3],
    weeklySets: { min: 6, target: 8, max: 10 },
    setsMain: 4,
    setsAcc: 3,
    restCompoundSec: 210, // 3–4分
    restIsolationSec: 120,
  },
  cut: {
    mainRep: [6, 10],
    accRep: [10, 15],
    targetRir: [2, 3],
    weeklySets: { min: 6, target: 8, max: 10 }, // 筋肥大の約2/3
    setsMain: 3,
    setsAcc: 2, // 2–3
    restCompoundSec: 120,
    restIsolationSec: 75, // 60–90秒
  },
}

export const MODE_LABEL: Record<Mode, string> = {
  hypertrophy: '筋肥大',
  strength: '筋力',
  cut: '減量',
}

export const MODE_POLICY: Record<Mode, string> = {
  hypertrophy: 'ボリュームを確保しながら、回数→重量の順に伸ばす',
  strength: 'メイン種目の重量を最優先で伸ばす',
  cut: '重量を落とさず維持し、セット数は筋肥大の約2/3',
}

export const MAIN_LIFT_DEFAULTS = [
  'smith_squat',
  'smith_bench_press',
  'smith_rdl',
  'smith_shoulder_press',
]

// ── 器具 ─────────────────────────────────────────────────
export const EQUIPMENT: { id: EquipmentId; label: string; enabled: boolean }[] = [
  { id: 'smith', label: 'スミスマシン', enabled: true },
  { id: 'dumbbell', label: 'ダンベル', enabled: true },
  { id: 'bench', label: 'アジャスタブルベンチ', enabled: true },
  { id: 'machine_upper', label: '上半身マシン', enabled: true },
  { id: 'machine_lower', label: '下半身マシン', enabled: true },
  { id: 'bodyweight', label: '自重', enabled: true },
  { id: 'cable', label: 'ケーブル', enabled: false },
]

export const INCREMENT = {
  smith: 2.5,
  machine: 5,
  dumbbellStep: 2,
  bodyweight: 0,
}

export const DEFAULT_SMITH_BAR = 15
export const DEFAULT_DUMBBELL_MAX = 30

/** Plates available per side for the smith machine, heaviest first */
export const PLATES = [20, 15, 10, 5, 2.5, 1.25]

// ── 部位 ─────────────────────────────────────────────────
export const MUSCLES: { id: Muscle; label: string; short: string }[] = [
  { id: 'chest', label: '胸', short: '胸' },
  { id: 'lats', label: '背中（広背筋）', short: '広背筋' },
  { id: 'upper_back', label: '背中（僧帽筋・菱形筋）', short: '僧帽・菱形' },
  { id: 'front_delt', label: '肩前部', short: '肩前部' },
  { id: 'side_delt', label: '肩側部', short: '肩側部' },
  { id: 'rear_delt', label: '肩後部', short: '肩後部' },
  { id: 'biceps', label: '上腕二頭筋', short: '二頭' },
  { id: 'triceps', label: '上腕三頭筋', short: '三頭' },
  { id: 'quads', label: '大腿四頭筋', short: '大腿四頭' },
  { id: 'hamstrings', label: 'ハムストリングス', short: 'ハム' },
  { id: 'glutes', label: '臀部', short: '臀部' },
  { id: 'calves', label: 'ふくらはぎ', short: 'ふくらはぎ' },
  { id: 'abs', label: '腹筋', short: '腹筋' },
]

/** Order used to break ties when several muscles need the same number of sets */
export const MUSCLE_PRIORITY: Muscle[] = [
  'quads',
  'chest',
  'lats',
  'hamstrings',
  'upper_back',
  'glutes',
  'front_delt',
  'side_delt',
  'rear_delt',
  'triceps',
  'biceps',
  'calves',
  'abs',
]

export const PATTERN_LABEL: Record<string, string> = {
  horizontal_push: '水平プッシュ',
  vertical_push: '垂直プッシュ',
  horizontal_pull: '水平プル',
  vertical_pull: '垂直プル',
  squat: 'スクワット',
  hinge: 'ヒンジ',
  lunge: 'ランジ',
  isolation: '単関節',
}

export const JOINT_LABEL: Record<string, string> = {
  shoulder: '肩',
  elbow: '肘',
  wrist: '手首',
  lower_back: '腰',
  knee: '膝',
  hip: '股関節',
  neck: '首',
}

// ── 分割法 ───────────────────────────────────────────────
const UPPER: Muscle[] = ['chest', 'lats', 'upper_back', 'front_delt', 'side_delt', 'rear_delt', 'biceps', 'triceps']
const LOWER: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves']

export const SPLIT_MUSCLES: Record<SplitKey, Muscle[]> = {
  full: [...UPPER, ...LOWER],
  upper: UPPER,
  lower: LOWER,
  push: ['chest', 'front_delt', 'side_delt', 'triceps'],
  pull: ['lats', 'upper_back', 'rear_delt', 'biceps'],
  legs: LOWER,
}

/** Abs are trained on these day types when enabled */
export const ABS_SPLITS: SplitKey[] = ['full', 'lower', 'legs']

export const SPLITS: Record<number, { key: SplitKey; name: string }[]> = {
  1: [{ key: 'full', name: '全身' }],
  2: [
    { key: 'full', name: '全身A' },
    { key: 'full', name: '全身B' },
  ],
  3: [
    { key: 'full', name: '全身A' },
    { key: 'full', name: '全身B' },
    { key: 'full', name: '全身C' },
  ],
  4: [
    { key: 'upper', name: '上半身A' },
    { key: 'lower', name: '下半身A' },
    { key: 'upper', name: '上半身B' },
    { key: 'lower', name: '下半身B' },
  ],
  5: [
    { key: 'upper', name: '上半身' },
    { key: 'lower', name: '下半身' },
    { key: 'push', name: 'プッシュ' },
    { key: 'pull', name: 'プル' },
    { key: 'legs', name: '脚' },
  ],
  6: [
    { key: 'push', name: 'プッシュA' },
    { key: 'pull', name: 'プルA' },
    { key: 'legs', name: '脚A' },
    { key: 'push', name: 'プッシュB' },
    { key: 'pull', name: 'プルB' },
    { key: 'legs', name: '脚B' },
  ],
}

export const SPLIT_SUMMARY: Record<number, string> = {
  1: '全身（週1回・維持目的）',
  2: '全身 A / B',
  3: '全身 A / B / C',
  4: '上半身 / 下半身 ×2',
  5: '上半身 / 下半身 / プッシュ / プル / 脚',
  6: 'プッシュ / プル / 脚 ×2',
}

// ── 生成 ─────────────────────────────────────────────────
export const GENERATOR = {
  /** A muscle needs at least this many open sets before a compound is added for it */
  compoundMinGap: 2,
  /** …and this many before an isolation is added */
  isolationMinGap: 1,
  minSetsPerExercise: 2,
  /** Hard sets per muscle in one session; keeps a 1-day full body sane */
  maxSetsPerMusclePerDay: 8,
  maxExercisesPerDay: 8,
  /** 種目は4–8週は固定 */
  fixedWeeks: 6,
}

// ── 所要時間 ─────────────────────────────────────────────
export const TIME = {
  warmupMin: 8,
  workSec: 40,
  switchMin: 2,
  warmupSetRestSec: 60,
}

export const WARMUP_SETS: Record<Mode, number> = { hypertrophy: 2, strength: 3, cut: 2 }

/** Share of the first working weight and reps for each warm-up set */
export const WARMUP_SCHEME = [
  { pct: 0.5, reps: 8 },
  { pct: 0.7, reps: 4 },
  { pct: 0.85, reps: 2 },
]

// ── 重量の提案 ───────────────────────────────────────────
export const PROGRESSION = {
  /** 2回連続で下限を下回ったら */
  dropAfterMisses: 2,
  dropFactor: 0.9,
  /** 3回連続で伸びなし */
  stallSessions: 3,
  /** 上限到達かつRIRが目標+2以上なら2刻み */
  rirBonusMargin: 2,
  rirBonusSteps: 2,
  /** Epley is only used for sets with at most this many reps */
  epleyMaxReps: 10,
}

export const RIR_CHOICES = [0, 1, 2, 3, 4]

export const BACKUP_REMIND_DAYS = 14

export const DEFAULT_DAY_BUDGET = 60

export function dumbbellRange(step = INCREMENT.dumbbellStep, max = DEFAULT_DUMBBELL_MAX): number[] {
  const out: number[] = []
  for (let w = step; w <= max + 1e-9; w += step) out.push(Math.round(w * 100) / 100)
  return out
}

export function defaultSettings(): Settings {
  const equipmentEnabled = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e.enabled])) as Settings['equipmentEnabled']
  return {
    id: 'main',
    onboarded: false,
    mode: 'hypertrophy',
    weekdays: [1, 3, 5],
    equipmentEnabled,
    unavailableExercises: [],
    dumbbellWeights: dumbbellRange(),
    smithBarWeight: DEFAULT_SMITH_BAR,
    modeParams: JSON.parse(JSON.stringify(MODE_PARAMS)),
    favorites: [],
    exclusions: [],
    initialRecords: {},
    includeAbs: false,
    dayBudgets: {},
  }
}

export const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土']
/** Display order, Monday first */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
