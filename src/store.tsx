import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { initialState, migrateState } from './data'
import { uid } from './engine'
import { canEditSchedule } from './perm'
import type { Calendar, Dataset, Person, State, TgMessage } from './types'

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
  /** Переключить демо-набор. Локальные изменения сбрасываются. */
  setDataset: (d: Dataset) => void
  toast: (text: string, action?: ToastAction) => void
  dismissToast: (id: string) => void
  toasts: Toast[]
}

const StoreCtx = createContext<Ctx>(null as unknown as Ctx)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    // большой набор весит ~1 МБ: сохраняем не на каждое изменение, а пачкой
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ } }
    if (state.dataset !== 'large') { save(); return }
    const t = setTimeout(save, 250)
    const flush = () => { clearTimeout(t); save() }
    window.addEventListener('pagehide', flush)
    return () => { clearTimeout(t); window.removeEventListener('pagehide', flush) }
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
    setState((old) => ({ ...initialState(Date.now(), old.dataset ?? 'small'), currentUserId: old.currentUserId }))
  }, [])
  const setDataset = useCallback((d: Dataset) => {
    setState((old) => {
      const s = initialState(Date.now(), d)
      return { ...s, currentUserId: s.people.some((p) => p.id === old.currentUserId) ? old.currentUserId : null }
    })
  }, [])
  return <StoreCtx.Provider value={{ state, update, updateCalendar, sendTg, reset, setDataset, toast, dismissToast, toasts }}>{children}</StoreCtx.Provider>
}

export const useStore = () => useContext(StoreCtx)

const byIdCache = new WeakMap<Person[], Map<string, Person>>()
/** Сотрудники по id. Один Map на версию списка — для 1500 человек find() в цикле слишком дорог. */
export function peopleById(people: Person[]) {
  let m = byIdCache.get(people)
  if (!m) { m = new Map(people.map((p) => [p.id, p])); byIdCache.set(people, m) }
  return m
}

export function usePerson(id?: string | null) {
  const { state } = useStore()
  return id ? peopleById(state.people).get(id) : undefined
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
