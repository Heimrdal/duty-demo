/**
 * Кэш расчёта «кто дежурит» для больших наборов.
 * Календари неизменяемые: любое изменение создаёт новый объект, поэтому WeakMap по объекту календаря
 * безопасен — старые записи уходят вместе со старыми объектами.
 */
import { calendarOnCall, DAY, HOUR, type OnCallEntry } from './engine'
import type { Calendar } from './types'

const MIN = 60_000
const nowCache = new WeakMap<Calendar, { m: number; v: OnCallEntry[] }>()

/** Кто дежурит в календаре в момент t. Один расчёт на календарь в минуту. */
export function onCallAt(c: Calendar, t: number): OnCallEntry[] {
  const m = Math.floor(t / MIN)
  const hit = nowCache.get(c)
  if (hit && hit.m === m) return hit.v
  const v = calendarOnCall(c, t)
  nowCache.set(c, { m, v })
  return v
}

const weekCache = new WeakMap<Calendar, { h: number; v: boolean }>()
/** Есть ли в ближайшие 7 дней час без дежурного. Один расчёт на календарь в час. */
export function hasWeekGap(c: Calendar, now: number): boolean {
  const h = Math.floor(now / HOUR)
  const hit = weekCache.get(c)
  if (hit && hit.h === h) return hit.v
  let v = false
  if (!c.layers.length) v = true
  else for (let t = h * HOUR; t < now + 7 * DAY; t += HOUR) if (calendarOnCall(c, t + 1).length === 0) { v = true; break }
  weekCache.set(c, { h, v })
  return v
}

export interface OnCallIndex {
  /** календарь → дежурные сейчас */
  byCalendar: Map<string, OnCallEntry[]>
  /** сотрудник → календари, где он дежурит сейчас */
  byPerson: Map<string, Calendar[]>
  gapsNow: Calendar[]
  totalOnCall: number
}

let lastIndex: { cals: Calendar[]; m: number; v: OnCallIndex } | null = null
/** Сводка по всем календарям на текущую минуту. Пересчитывается только при смене минуты или данных. */
export function onCallIndex(calendars: Calendar[], now: number): OnCallIndex {
  const m = Math.floor(now / MIN)
  if (lastIndex && lastIndex.cals === calendars && lastIndex.m === m) return lastIndex.v
  const byCalendar = new Map<string, OnCallEntry[]>()
  const byPerson = new Map<string, Calendar[]>()
  const gapsNow: Calendar[] = []
  for (const c of calendars) {
    const e = onCallAt(c, now)
    byCalendar.set(c.id, e)
    if (!e.length) gapsNow.push(c)
    for (const x of e) {
      const a = byPerson.get(x.personId)
      if (a) a.push(c)
      else byPerson.set(x.personId, [c])
    }
  }
  const v = { byCalendar, byPerson, gapsNow, totalOnCall: byPerson.size }
  lastIndex = { cals: calendars, m, v }
  return v
}

/** Может ли человек дежурить в календаре: участник ротации или ручной смены. Отсекает лишние расчёты. */
export function involves(c: Calendar, personId: string) {
  return c.layers.some((l) => l.participants.includes(personId)) || c.shifts.some((s) => s.personId === personId)
}
