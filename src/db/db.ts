import Dexie, { type Table } from 'dexie'
import exercisesJson from '../../data/exercises.json'
import { defaultSettings } from '../config/defaults'
import { makeBackup, type BackupData } from '../logic/backup'
import { generatePlan } from '../logic/generator'
import type { BodyMetric, Exercise, Pain, Plan, Session, Settings } from '../logic/types'

class WorkoutDB extends Dexie {
  settings!: Table<Settings, string>
  exercises!: Table<Exercise, string>
  plans!: Table<Plan, number>
  sessions!: Table<Session, number>
  pains!: Table<Pain, number>
  bodyMetrics!: Table<BodyMetric, number>

  constructor() {
    super('workout-app')
    this.version(1).stores({
      settings: 'id',
      exercises: 'id, pattern',
      plans: '++id, createdAt',
      sessions: '++id, date, status',
      pains: '++id, joint, startDate',
      bodyMetrics: '++id, date',
    })
  }
}

export const db = new WorkoutDB()

const builtins = (exercisesJson as Exercise[]).map((e) => ({ ...e, builtin: true }))

/** Fill defaults on first run and add any new built-in exercises without touching edited ones */
export async function ensureSeeded(): Promise<void> {
  await db.transaction('rw', db.settings, db.exercises, async () => {
    if (!(await db.settings.get('main'))) await db.settings.put(defaultSettings())
    const have = new Set(await db.exercises.toCollection().primaryKeys())
    const missing = builtins.filter((e) => !have.has(e.id))
    if (missing.length) await db.exercises.bulkAdd(missing)
  })
  // Ask the browser not to evict our data (Safari may clear unused sites)
  navigator.storage?.persist?.().catch(() => undefined)
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('main')) ?? defaultSettings()
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, id: 'main' as const }
  await db.settings.put(next)
  return next
}

export async function currentPlan(): Promise<Plan | undefined> {
  return db.plans.orderBy('id').last()
}

export async function allExercises(): Promise<Exercise[]> {
  const list = await db.exercises.toArray()
  const order = new Map(builtins.map((e, i) => [e.id, i]))
  return list.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999))
}

/** Build a new weekly plan, preferring the exercises of the current one */
export async function regeneratePlan(today: string): Promise<Plan> {
  const [settings, exercises, previous] = await Promise.all([getSettings(), allExercises(), currentPlan()])
  const plan = generatePlan({ exercises, settings, today, previous })
  const id = await db.plans.add(plan)
  return { ...plan, id }
}

export async function savePlan(plan: Plan): Promise<void> {
  await db.plans.put(plan)
}

export async function activeSession(): Promise<Session | undefined> {
  return db.sessions.where('status').equals('active').first()
}

export async function exportAll(nowIso: string): Promise<string> {
  const data: BackupData = {
    settings: await db.settings.toArray(),
    exercises: await db.exercises.toArray(),
    plans: await db.plans.toArray(),
    sessions: await db.sessions.toArray(),
    pains: await db.pains.toArray(),
    bodyMetrics: await db.bodyMetrics.toArray(),
  }
  return JSON.stringify(makeBackup(data, nowIso), null, 2)
}

export async function importAll(data: BackupData): Promise<void> {
  await db.transaction('rw', [db.settings, db.exercises, db.plans, db.sessions, db.pains, db.bodyMetrics], async () => {
    await Promise.all([db.settings, db.exercises, db.plans, db.sessions, db.pains, db.bodyMetrics].map((t) => t.clear()))
    await db.settings.bulkPut(data.settings.length ? data.settings : [defaultSettings()])
    await db.exercises.bulkPut(data.exercises)
    await db.plans.bulkPut(data.plans)
    await db.sessions.bulkPut(data.sessions)
    await db.pains.bulkPut(data.pains)
    await db.bodyMetrics.bulkPut(data.bodyMetrics)
  })
  await ensureSeeded()
}
