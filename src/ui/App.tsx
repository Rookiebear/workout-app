import { CalendarDays, History as HistoryIcon, ListChecks, SlidersHorizontal } from 'lucide-preact'
import { useMemo } from 'preact/hooks'
import { allExercises, currentPlan, db, getSettings } from '../db/db'
import { ICON } from './components'
import { DataContext, useLive, useRoute, useToast, type AppData } from './hooks'
import { HistoryDetail, HistoryList } from './screens/History'
import { Onboarding } from './screens/Onboarding'
import { PlanScreen } from './screens/Plan'
import { SessionScreen } from './screens/Session'
import { ExerciseEdit, ExerciseList, Exclusions, Machines, ModeParamsEdit, SettingsScreen } from './screens/Settings'
import { Today } from './screens/Today'

const TABS = [
  { id: 'today', label: '今日', icon: CalendarDays },
  { id: 'plan', label: 'メニュー', icon: ListChecks },
  { id: 'history', label: '履歴', icon: HistoryIcon },
  { id: 'settings', label: '設定', icon: SlidersHorizontal },
]

export function App() {
  const settings = useLive(getSettings)
  const exercises = useLive(allExercises)
  const plan = useLive(currentPlan)
  const sessions = useLive(() => db.sessions.toArray())
  const pains = useLive(() => db.pains.toArray())
  const route = useRoute()
  const message = useToast()

  const data = useMemo<AppData | undefined>(() => {
    if (!settings || !exercises || !sessions || !pains) return undefined
    return { settings, exercises, exMap: new Map(exercises.map((e) => [e.id, e])), plan, sessions, pains }
  }, [settings, exercises, plan, sessions, pains])

  if (!data) return <div class="app" />
  if (!data.settings.onboarded)
    return (
      <DataContext.Provider value={data}>
        <div class="app">
          <Onboarding />
        </div>
      </DataContext.Provider>
    )

  const [head, a, b] = route
  const inSession = head === 'session'
  let screen
  if (head === 'session') screen = <SessionScreen />
  else if (head === 'plan') screen = <PlanScreen />
  else if (head === 'history') screen = a ? <HistoryDetail id={Number(a)} /> : <HistoryList />
  else if (head === 'settings') {
    if (a === 'exercises') screen = <ExerciseList />
    else if (a === 'exercise') screen = <ExerciseEdit id={b} />
    else if (a === 'params') screen = <ModeParamsEdit />
    else if (a === 'machines') screen = <Machines />
    else if (a === 'exclusions') screen = <Exclusions />
    else screen = <SettingsScreen />
  } else screen = <Today />

  return (
    <DataContext.Provider value={data}>
      <div class="app">{screen}</div>
      {!inSession && (
        <div class="tabbar">
          <nav aria-label="メイン">
            {TABS.map((t) => (
              <a class="tab" href={`#/${t.id}`} aria-current={(head || 'today') === t.id ? 'page' : undefined}>
                <t.icon {...ICON} size={22} />
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      )}
      {message && <div class="toast" role="status">{message}</div>}
    </DataContext.Provider>
  )
}
