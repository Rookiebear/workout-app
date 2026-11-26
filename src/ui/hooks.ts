import { liveQuery } from 'dexie'
import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { toISODate } from '../logic/dates'
import type { Exercise, Pain, Plan, Session, Settings } from '../logic/types'

export function useLive<T>(fn: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: (v) => setValue(() => v), error: (e) => console.error(e) })
    return () => sub.unsubscribe()
  }, deps)
  return value
}

export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/')
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(path: string, replace = false) {
  const hash = `#/${path}`
  if (replace) location.replace(hash)
  else location.hash = hash
}

export function back(fallback: string) {
  if (history.length > 1) history.back()
  else go(fallback, true)
}

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    const vis = () => setNow(Date.now())
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [intervalMs, active])
  return now
}

export const todayISO = () => toISODate(new Date())

export interface AppData {
  settings: Settings
  exercises: Exercise[]
  exMap: Map<string, Exercise>
  plan?: Plan
  sessions: Session[]
  pains: Pain[]
}

export const DataContext = createContext<AppData>(null as never)
export const useData = () => useContext(DataContext)

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: message }))
}

export function useToast(): string | undefined {
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    let t: number | undefined
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail)
      clearTimeout(t)
      t = window.setTimeout(() => setMsg(undefined), 2400)
    }
    addEventListener('app-toast', on)
    return () => removeEventListener('app-toast', on)
  }, [])
  return msg
}
