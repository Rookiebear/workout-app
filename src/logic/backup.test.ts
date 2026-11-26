import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, defaultSettings } from '../config/defaults'
import { BackupError, makeBackup, parseBackup } from './backup'

const data = {
  settings: [{ ...defaultSettings(), onboarded: true }],
  exercises: [],
  plans: [],
  sessions: [],
  pains: [],
  bodyMetrics: [],
}

describe('JSONの書き出し・読み込み', () => {
  it('schemaVersion を持ち、そのまま読み戻せる', () => {
    const file = makeBackup(data, '2026-11-26T10:00:00.000Z')
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    const back = parseBackup(JSON.stringify(file))
    expect(back.settings[0].onboarded).toBe(true)
  })

  it('足りない設定項目は初期値で補う', () => {
    const file = makeBackup({ ...data, settings: [{ id: 'main', mode: 'strength' } as never] }, 'x')
    const back = parseBackup(JSON.stringify(file))
    expect(back.settings[0].mode).toBe('strength')
    expect(back.settings[0].smithBarWeight).toBe(defaultSettings().smithBarWeight)
  })

  it('別アプリのJSONや新しすぎる形式は断る', () => {
    expect(() => parseBackup('{"a":1}')).toThrow(BackupError)
    expect(() => parseBackup('not json')).toThrow(BackupError)
    const future = { ...makeBackup(data, 'x'), schemaVersion: SCHEMA_VERSION + 1 }
    expect(() => parseBackup(JSON.stringify(future))).toThrow(/新しいバージョン/)
  })
})
