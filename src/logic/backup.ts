import { SCHEMA_VERSION, defaultSettings } from '../config/defaults'
import type { BodyMetric, Exercise, Pain, Plan, Session, Settings } from './types'

export interface BackupData {
  settings: Settings[]
  exercises: Exercise[]
  plans: Plan[]
  sessions: Session[]
  pains: Pain[]
  bodyMetrics: BodyMetric[]
}

export interface BackupFile {
  app: 'workout-app'
  schemaVersion: number
  exportedAt: string
  data: BackupData
}

export function makeBackup(data: BackupData, exportedAt: string): BackupFile {
  return { app: 'workout-app', schemaVersion: SCHEMA_VERSION, exportedAt, data }
}

export function backupFileName(isoDate: string): string {
  return `workout-backup-${isoDate}.json`
}

/** Each step upgrades a file one schema version. Add entries here when the format changes. */
const MIGRATIONS: Record<number, (f: BackupFile) => BackupFile> = {}

export class BackupError extends Error {}

export function parseBackup(text: string): BackupData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('JSONとして読み込めませんでした')
  }
  if (!raw || typeof raw !== 'object') throw new BackupError('バックアップの形式ではありません')
  let file = raw as BackupFile
  if (file.app !== 'workout-app' || typeof file.schemaVersion !== 'number' || !file.data) {
    throw new BackupError('このアプリのバックアップではありません')
  }
  if (file.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('新しいバージョンのアプリで書き出されたファイルです。アプリを更新してください')
  }
  while (file.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[file.schemaVersion]
    if (!step) throw new BackupError(`schemaVersion ${file.schemaVersion} は読み込めません`)
    file = step(file)
  }
  const d = file.data
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
  const settings = arr(d.settings).map((s) => ({ ...defaultSettings(), ...s, id: 'main' as const }))
  return {
    settings,
    exercises: arr(d.exercises),
    plans: arr(d.plans),
    sessions: arr(d.sessions),
    pains: arr(d.pains),
    bodyMetrics: arr(d.bodyMetrics),
  }
}
