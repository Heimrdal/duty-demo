import { uid } from './engine'
import type { Calendar, Person, Shift } from './types'

/** Цепочка руководителей сотрудника снизу вверх (без самого сотрудника). */
export function managerChain(people: Person[], id: string): string[] {
  const out: string[] = []
  let cur = people.find((p) => p.id === id)?.managerId
  while (cur && !out.includes(cur) && cur !== id) {
    out.push(cur)
    cur = people.find((p) => p.id === cur)?.managerId
  }
  return out
}

/**
 * Кто вправе менять расписание календаря: лид группы, владелец календаря
 * и их руководители по оргструктуре. Остальные видят расписание и могут записаться сами.
 */
export function scheduleEditors(c: Calendar, people: Person[]): string[] {
  const base = [c.leadId, c.ownerId].filter(Boolean)
  return [...new Set([...base, ...base.flatMap((id) => managerChain(people, id))])]
}

export function canEditSchedule(c: Calendar, people: Person[], userId: string | null | undefined): boolean {
  if (!userId) return false
  return scheduleEditors(c, people).includes(userId)
}

/** Свою смену человек отменяет сам, чужую — только тот, кто ведёт расписание. */
export function canCancelShift(c: Calendar, people: Person[], userId: string | null | undefined, s: Shift): boolean {
  if (!userId) return false
  return s.personId === userId || canEditSchedule(c, people, userId)
}

/** Сотрудники для выбора дежурного: сначала команда календаря и участники его ротаций. */
export function teamFirstIds(c: Calendar, people: Person[]): string[] {
  const inLayers = c.layers.flatMap((l) => l.participants)
  return [...new Set([...people.filter((p) => p.teams.includes(c.team)).map((p) => p.id), ...inLayers, c.leadId])]
}

export interface ShiftInput {
  personId: string
  start: number
  end: number
  replacesPersonId?: string
  note?: string
}

/** Новая смена (разовая или подмена, если указан replacesPersonId). */
export function makeShift(x: ShiftInput, now: number = Date.now()): Shift {
  if (!(x.end > x.start)) throw new Error('Окончание раньше начала')
  if (x.replacesPersonId && x.replacesPersonId === x.personId) throw new Error('Нельзя подменить человека им же')
  return {
    id: uid(),
    personId: x.personId,
    start: new Date(x.start).toISOString(),
    end: new Date(x.end).toISOString(),
    replacesPersonId: x.replacesPersonId || undefined,
    note: x.note?.trim() || undefined,
    createdAt: new Date(now).toISOString(),
  }
}

/** Добавить смену или заменить существующую с тем же id. */
export function upsertShift(c: Calendar, s: Shift): Calendar {
  return c.shifts.some((x) => x.id === s.id)
    ? { ...c, shifts: c.shifts.map((x) => (x.id === s.id ? s : x)) }
    : { ...c, shifts: [...c.shifts, s] }
}
