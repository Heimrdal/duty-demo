import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { initialState } from './data'
import { uid } from './engine'
import type { Calendar, State, TgMessage } from './types'

const KEY = 'oncall-demo-state-v3'

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s.version === 3) return s
    }
  } catch { /* ignore */ }
  return initialState()
}

interface Ctx {
  state: State
  update: (fn: (s: State) => State) => void
  updateCalendar: (id: string, fn: (c: Calendar) => Calendar) => void
  sendTg: (m: Omit<TgMessage, 'id' | 'ts'>) => void
  reset: () => void
  toast: (text: string) => void
  toasts: { id: string; text: string }[]
}

const StoreCtx = createContext<Ctx>(null as unknown as Ctx)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state])
  const update = useCallback((fn: (s: State) => State) => setState(fn), [])
  const updateCalendar = useCallback((id: string, fn: (c: Calendar) => Calendar) =>
    setState((s) => ({ ...s, calendars: s.calendars.map((c) => (c.id === id ? fn(c) : c)) })), [])
  const sendTg = useCallback((m: Omit<TgMessage, 'id' | 'ts'>) =>
    setState((s) => ({ ...s, messages: [...s.messages, { ...m, id: uid(), ts: new Date().toISOString() }] })), [])
  const toast = useCallback((text: string) => {
    const id = uid()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])
  const reset = useCallback(() => {
    const s = initialState()
    setState((old) => ({ ...s, currentUserId: old.currentUserId }))
  }, [])
  return <StoreCtx.Provider value={{ state, update, updateCalendar, sendTg, reset, toast, toasts }}>{children}</StoreCtx.Provider>
}

export const useStore = () => useContext(StoreCtx)

export function usePerson(id?: string | null) {
  const { state } = useStore()
  return state.people.find((p) => p.id === id)
}

export function useHashRoute(): [string[], (to: string) => void] {
  const get = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean)
  const [parts, setParts] = useState(get)
  useEffect(() => {
    const h = () => { setParts(get()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return [parts, (to: string) => { location.hash = '#/' + to.replace(/^\//, '') }]
}

/** тикающее «сейчас», чтобы дашборд обновлялся */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(i)
  }, [intervalMs])
  return now
}
