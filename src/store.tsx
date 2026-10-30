import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { initialState, migrateState } from './data'
import { uid } from './engine'
import { canEditSchedule } from './perm'
import type { Calendar, State, TgMessage } from './types'

const KEY = 'oncall-demo-state-v3' // ключ прежний: внутри version, миграция в migrateState

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = migrateState(JSON.parse(raw))
      if (s) return s
    }
  } catch { /* ignore */ }
  return initialState()
}

export interface ToastAction { label: string; onClick: () => void }
export interface Toast { id: string; text: string; action?: ToastAction }

interface Ctx {
  state: State
  update: (fn: (s: State) => State) => void
  updateCalendar: (id: string, fn: (c: Calendar) => Calendar) => void
  sendTg: (m: Omit<TgMessage, 'id' | 'ts'>) => void
  reset: () => void
  toast: (text: string, action?: ToastAction) => void
  dismissToast: (id: string) => void
  toasts: Toast[]
}

const StoreCtx = createContext<Ctx>(null as unknown as Ctx)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state])
  const update = useCallback((fn: (s: State) => State) => setState(fn), [])
  const updateCalendar = useCallback((id: string, fn: (c: Calendar) => Calendar) =>
    setState((s) => ({ ...s, calendars: s.calendars.map((c) => (c.id === id ? fn(c) : c)) })), [])
  const sendTg = useCallback((m: Omit<TgMessage, 'id' | 'ts'>) =>
    setState((s) => ({ ...s, messages: [...s.messages, { ...m, id: uid(), ts: new Date().toISOString() }] })), [])
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback((text: string, action?: ToastAction) => {
    const id = uid()
    setToasts((t) => [...t, { id, text, action }])
    // с кнопкой «Вернуть» тост живёт дольше, чтобы успеть нажать
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 3500)
  }, [])
  const reset = useCallback(() => {
    const s = initialState()
    setState((old) => ({ ...s, currentUserId: old.currentUserId }))
  }, [])
  return <StoreCtx.Provider value={{ state, update, updateCalendar, sendTg, reset, toast, dismissToast, toasts }}>{children}</StoreCtx.Provider>
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

/** Права текущего пользователя на расписание календаря и подсказка, кто его ведёт. */
export function useScheduleAccess(c: Calendar | undefined) {
  const { state } = useStore()
  const me = state.currentUserId
  if (!c) return { canEdit: false, me, editorsLabel: '' }
  const canEdit = canEditSchedule(c, state.people, me)
  const name = (id: string) => state.people.find((p) => p.id === id)?.name
  const lead = name(c.leadId)
  const owner = c.ownerId !== c.leadId ? name(c.ownerId) : undefined
  const editorsLabel = [lead && `лид ${lead}`, owner && `владелец ${owner}`].filter(Boolean).join(' и ')
  return { canEdit, me, editorsLabel }
}
