import type { Exclusion, Exercise, Muscle, Settings } from './types'

export function isActiveExclusion(x: Exclusion, today: string): boolean {
  return !x.until || x.until >= today
}

export function exclusionFor(ex: Exercise, exclusions: Exclusion[], today: string): Exclusion | undefined {
  return exclusions.find(
    (x) =>
      isActiveExclusion(x, today) &&
      ((x.type === 'exercise' && x.target === ex.id) || (x.type === 'pattern' && x.target === ex.pattern)),
  )
}

export function primaryMuscles(ex: Exercise): Muscle[] {
  return (Object.keys(ex.muscles) as Muscle[]).filter((m) => (ex.muscles[m] ?? 0) >= 1)
}

export function isAbsExercise(ex: Exercise): boolean {
  return primaryMuscles(ex).includes('abs')
}

export type Unavailable = 'equipment' | 'machine' | 'excluded' | 'abs'

export function unavailableReason(ex: Exercise, settings: Settings, today: string): Unavailable | undefined {
  if (!ex.equipment.every((e) => settings.equipmentEnabled[e])) return 'equipment'
  if (settings.unavailableExercises.includes(ex.id)) return 'machine'
  if (exclusionFor(ex, settings.exclusions, today)) return 'excluded'
  if (!settings.includeAbs && isAbsExercise(ex)) return 'abs'
  return undefined
}

export function isAvailable(ex: Exercise, settings: Settings, today: string): boolean {
  return unavailableReason(ex, settings, today) === undefined
}

export function isMachine(ex: Exercise): boolean {
  return ex.equipment.includes('machine_upper') || ex.equipment.includes('machine_lower')
}
