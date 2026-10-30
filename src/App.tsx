import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hotkeyLabel, SearchPalette } from './SearchPalette'
import { About } from './pages/About'
import { CalendarView } from './pages/CalendarView'
import { Calendars } from './pages/Calendars'
import { Dashboard } from './pages/Dashboard'
import { Escalation } from './pages/Escalation'
import { Login } from './pages/Login'
import { Notifications } from './pages/Notifications'
import { People } from './pages/People'
import { TeamView } from './pages/TeamView'
import { useHashRoute, useStore } from './store'
import { useTheme } from './theme'
import { Avatar, Menu } from './ui'

const NAV = [
  ['', 'Сейчас'],
  ['calendars', 'Календари'],
  ['teams', 'Команды'],
  ['escalation', 'Эскалации'],
  ['notifications', 'Уведомления'],
  ['people', 'Сотрудники'],
  ['about', 'О демо'],
] as const

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
const ICONS = [
  'M12 8v4l2.5 1.5 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
  'M5 5h14v14H5z M5 10h14',
  'M8 20v-1a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v1 M11 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M16 20v-1a2.8 2.8 0 0 0-2-2.6 M15.5 4.2a2.5 2.5 0 0 1 0 4.6',
  'M12 4v10 M8 10l4 4 4-4 M6 20h12',
  'M4 12l16-7-7 16-2-7z',
  'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M20 19v-1a3.5 3.5 0 0 0-2.5-3.3 M16 5.1a3 3 0 0 1 0 5.8',
  'M12 16v.01 M12 8a3 3 0 0 1 1 5.8V15',
]

function safeDecode(s: string) {
  try { return decodeURIComponent(s) } catch { return s }
}

export default function App() {
  const { state, update, reset, toasts, toast, dismissToast } = useStore()
  const { theme, toggle } = useTheme()
  const [route] = useHashRoute()
  const [searching, setSearching] = useState(false)
  const me = state.people.find((p) => p.id === state.currentUserId)
  const signedIn = !!me && route[0] !== 'login'
  useEffect(() => {
    if (!signedIn) return
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [signedIn])
  if (!me || route[0] === 'login') return <Login />

  let page
  switch (route[0]) {
    case 'calendars': page = route[1] === 'q' ? <Calendars key={route[2] ?? ''} initialQuery={safeDecode(route[2] ?? '')} /> : route[1] ? <CalendarView key={route[1]} id={route[1]} /> : <Calendars />; break
    case 'teams': page = <TeamView key={route[1] ?? ''} name={safeDecode(route[1] ?? '')} />; break
    case 'escalation': page = <Escalation />; break
    case 'notifications': page = <Notifications key={route[1] ?? ''} incident={route[1] ? safeDecode(route[1]) : undefined} />; break
    case 'people': page = <People key={route[1] ?? ''} focus={route[1]} />; break
    case 'about': page = <About />; break
    default: page = <Dashboard />
  }
  return (
    <div className="flex min-h-full bg-canvas text-ink">
      <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r border-line bg-canvas md:flex">
        <div className="px-4 pt-5 pb-4">
          <div className="text-sm font-semibold">Дежурства</div>
          <div className="mt-0.5 text-xs text-faint">Демо · ситуационный центр</div>
        </div>
        <div className="px-2 pb-3">
          <button type="button" data-testid="search-open" onClick={() => setSearching(true)} aria-label="Поиск: команды, календари, люди, системы" aria-keyshortcuts="Control+K Meta+K"
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[13px] text-faint hover:border-line-strong hover:text-muted">
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M20 20l-4-4" /></svg>
            <span className="flex-1">Поиск</span>
            <kbd className="rounded border border-line px-1 font-sans text-[10px] text-faint">{hotkeyLabel()}</kbd>
          </button>
        </div>
        <nav aria-label="Разделы" className="flex-1 space-y-0.5 px-2">
          {NAV.map(([to, label], i) => {
            const active = (route[0] ?? '') === to
            return (
              <a key={to || 'home'} href={`#/${to}`} aria-current={active ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${active ? 'nav-active font-medium' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                <Icon d={ICONS[i]} />{label}
              </a>
            )
          })}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 px-1">
            <Avatar p={me} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{me.name}</div>
              <div className="truncate text-xs text-faint">{me.orgUnit}</div>
            </div>
            <Menu label="Аккаунт" items={[{ label: 'Сбросить данные', danger: true, onClick: () => { if (confirm('Сбросить демо-данные к исходным?')) { reset(); toast('Демо-данные сброшены') } } }]} />
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted">
            <button className="hover:text-ink" onClick={() => { update((s) => ({ ...s, currentUserId: null })); location.hash = '#/login' }}>Выйти</button>
            <button className="hover:text-ink" aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle}>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:hidden">
          <span className="text-sm font-semibold">Дежурства</span>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="search-open-mobile" className="rounded-lg border border-line px-2 py-1 text-xs text-muted" aria-label="Поиск" onClick={() => setSearching(true)}>Поиск</button>
            <button className="text-xs text-muted" aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle}>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</button>
            <select aria-label="Раздел" className="rounded-lg border border-line bg-surface px-2 py-1 text-sm" value={route[0] ?? ''} onChange={(e) => (location.hash = '#/' + e.target.value)}>{NAV.map(([to, l]) => <option key={to} value={to}>{l}</option>)}</select>
          </div>
        </header>
        <main className="rise mx-auto w-full max-w-[1180px] px-5 py-8 md:px-10 md:py-10">{page}</main>
      </div>
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {createPortal(
        <div role="status" aria-live="polite" className="fixed right-4 bottom-4 z-[60] space-y-2">
          {toasts.map((t) => (
            <div key={t.id} className="popover-in flex items-center gap-4 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm shadow-card">
              <span>{t.text}</span>
              {t.actions.map((a) => <button key={a.label} type="button" className="font-medium text-accent hover:underline" onClick={() => { a.onClick(); dismissToast(t.id) }}>{a.label}</button>)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
