import { useState } from 'react'
import { TakeDutyModal } from './forms'
import { About } from './pages/About'
import { CalendarView } from './pages/CalendarView'
import { Calendars } from './pages/Calendars'
import { Dashboard } from './pages/Dashboard'
import { Escalation } from './pages/Escalation'
import { Login } from './pages/Login'
import { Notifications } from './pages/Notifications'
import { People } from './pages/People'
import { useHashRoute, useStore } from './store'
import { Avatar } from './ui'

const NAV = [
  ['', '🟢', 'Кто дежурит сейчас'],
  ['calendars', '📅', 'Календари'],
  ['escalation', '📣', 'Эскалации'],
  ['notifications', '✈️', 'Уведомления (Telegram)'],
  ['people', '👥', 'Сотрудники'],
  ['about', 'ℹ️', 'О демо / OneUptime'],
] as const

export default function App() {
  const { state, update, reset, toasts, toast } = useStore()
  const [route] = useHashRoute()
  const [take, setTake] = useState(false)
  const me = state.people.find((p) => p.id === state.currentUserId)
  if (!me || route[0] === 'login') return <Login />

  let page
  switch (route[0]) {
    case 'calendars': page = route[1] ? <CalendarView key={route[1]} id={route[1]} /> : <Calendars />; break
    case 'escalation': page = <Escalation />; break
    case 'notifications': page = <Notifications />; break
    case 'people': page = <People />; break
    case 'about': page = <About />; break
    default: page = <Dashboard />
  }
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
        <div className="px-5 py-5">
          <div className="text-lg font-bold text-white">📟 Дежурства</div>
          <div className="text-xs text-slate-400">СЦ и мониторинг · банк</div>
          <span className="mt-2 inline-block rounded bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">ДЕМО-СТЕНД</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(([to, icon, label]) => {
            const active = (route[0] ?? '') === to
            return <a key={to} href={`#/${to}`} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'}`}><span>{icon}</span>{label}</a>
          })}
          <button onClick={() => setTake(true)} className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500">✋ Взять дежурство</button>
        </nav>
        <div className="border-t border-slate-800 p-4 text-sm">
          <div className="flex items-center gap-2"><Avatar p={me} /><div className="min-w-0"><div className="truncate text-white">{me.name}</div><div className="truncate text-xs text-slate-400">{me.team} · SSO</div></div></div>
          <div className="mt-3 flex justify-between text-xs">
            <button className="hover:text-white" onClick={() => { update((s) => ({ ...s, currentUserId: null })); location.hash = '#/login' }}>Выйти</button>
            <button className="hover:text-white" title="Вернуть исходные демо-данные" onClick={() => { if (confirm('Сбросить демо-данные к исходным?')) { reset(); toast('Демо-данные сброшены') } }}>↺ Сбросить данные</button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-2 md:hidden">
          <b>📟 Дежурства</b>
          <select className="rounded border px-2 py-1 text-sm" value={route[0] ?? ''} onChange={(e) => (location.hash = '#/' + e.target.value)}>{NAV.map(([to, , l]) => <option key={to} value={to}>{l}</option>)}</select>
        </header>
        <main className="mx-auto max-w-7xl p-6">{page}</main>
      </div>
      {take && <TakeDutyModal onClose={() => setTake(false)} />}
      <div className="fixed right-4 bottom-4 z-[60] space-y-2">
        {toasts.map((t) => <div key={t.id} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{t.text}</div>)}
      </div>
    </div>
  )
}
