import type { Calendar, Layer, Person, Restriction } from './types'

export const HOUR = 3600_000
export const DAY = 24 * HOUR

export const uid = () => Math.random().toString(36).slice(2, 10)

export function startOfDay(d: Date | number) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function addDays(d: Date | number, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function hm(s: string) {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}
export function isoDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function weekday(d: Date) {
  return (d.getDay() + 6) % 7 // 0 = Пн
}

/** Начало ротации слоя: дата startsAt + время передачи смены */
export function layerAnchor(l: Layer) {
  const d = new Date(l.startsAt + 'T00:00:00')
  const m = hm(l.handoffTime)
  d.setHours(Math.floor(m / 60), m % 60, 0, 0)
  return d.getTime()
}
export function periodMs(l: Layer) {
  return l.rotation.count * (l.rotation.unit === 'week' ? 7 : 1) * DAY
}

export function inRestriction(r: Restriction, t: number) {
  if (r.type === 'none') return true
  const d = new Date(t)
  const mins = d.getHours() * 60 + d.getMinutes()
  const from = hm(r.from)
  const to = hm(r.to)
  let inWindow: boolean
  let dayForCheck = weekday(d)
  if (from === to) inWindow = true
  else if (from < to) inWindow = mins >= from && mins < to
  else {
    // окно через полночь: 20:00–08:00
    inWindow = mins >= from || mins < to
    if (mins < to) dayForCheck = (dayForCheck + 6) % 7 // относится к предыдущему дню
  }
  if (!inWindow) return false
  if (r.type === 'weekly') return r.days.includes(dayForCheck)
  return true
}

/** Индекс ротации (номер смены) в момент t */
export function rotationIndex(l: Layer, t: number) {
  const a = layerAnchor(l)
  if (t < a) return -1
  return Math.floor((t - a) / periodMs(l))
}

/** Кто дежурит в слое в момент t (с учётом параллельных мест) */
export function layerOnCall(l: Layer, t: number): string[] {
  const n = l.participants.length
  if (!n) return []
  const idx = rotationIndex(l, t)
  if (idx < 0) return []
  if (!inRestriction(l.restriction, t)) return []
  const k = Math.min(l.parallel, n)
  const res: string[] = []
  for (let i = 0; i < k; i++) res.push(l.participants[(idx * k + i) % n])
  return res
}
export function layerSlot(l: Layer, t: number, slot: number): string | null {
  return layerOnCall(l, t)[slot] ?? null
}
/** Следующий по ротации (OneUptime: "Next in rotation") */
export function nextInRotation(l: Layer, t: number): string[] {
  const n = l.participants.length
  if (!n) return []
  const idx = Math.max(rotationIndex(l, t), 0) + 1
  const k = Math.min(l.parallel, n)
  const res: string[] = []
  for (let i = 0; i < k; i++) res.push(l.participants[(idx * k + i) % n])
  return res
}
export function nextHandoff(l: Layer, t: number) {
  const a = layerAnchor(l)
  const p = periodMs(l)
  if (t < a) return a
  return a + (Math.floor((t - a) / p) + 1) * p
}

export interface OnCallEntry {
  personId: string
  layerId: string | null // null = ручная смена/подмена
  layerName: string
  kind: string
  replaced?: string
}

/** Итоговое расписание календаря в момент t */
export function calendarOnCall(c: Calendar, t: number): OnCallEntry[] {
  let entries: OnCallEntry[] = []
  for (const l of c.layers) {
    const ids = layerOnCall(l, t)
    if (!ids.length) continue
    for (const id of ids) entries.push({ personId: id, layerId: l.id, layerName: l.name, kind: l.kind })
    if (c.layerMode === 'priority') break // OneUptime: верхний слой, где кто-то есть, перекрывает нижние
  }
  for (const s of c.shifts) {
    const a = new Date(s.start).getTime()
    const b = new Date(s.end).getTime()
    if (t < a || t >= b) continue
    if (s.replacesPersonId) {
      const hit = entries.find((e) => e.personId === s.replacesPersonId)
      if (hit) {
        hit.replaced = hit.personId
        hit.personId = s.personId
        hit.kind = 'override'
        continue
      }
    }
    entries.push({ personId: s.personId, layerId: null, layerName: 'Взятое дежурство', kind: 'override' })
  }
  // убираем дубли
  const seen = new Set<string>()
  entries = entries.filter((e) => (seen.has(e.personId) ? false : (seen.add(e.personId), true)))
  return entries
}

export interface Segment {
  start: number
  end: number
  personId: string
  extra?: string
}

/** Сегменты для таймлайна: почасовая выборка + склейка */
export function sampleSegments(from: number, to: number, fn: (t: number) => string | null, step = HOUR): Segment[] {
  const out: Segment[] = []
  let cur: Segment | null = null
  for (let t = from; t < to; t += step) {
    const p = fn(t + 1)
    if (cur && cur.personId === p) {
      cur.end = t + step
      continue
    }
    if (cur) out.push(cur)
    cur = p ? { start: t, end: t + step, personId: p } : null
  }
  if (cur) out.push(cur)
  return out
}

export function managerOf(people: Person[], id: string) {
  const p = people.find((x) => x.id === id)
  return p?.managerId ? people.find((x) => x.id === p.managerId) : undefined
}

export function fmtDT(t: number | string | Date) {
  return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function fmtD(t: number | string | Date) {
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' })
}
export function fmtT(t: number | string | Date) {
  return new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
export function fmtDur(ms: number) {
  const h = Math.round(ms / HOUR)
  if (h < 24) return `${h} ч`
  const d = Math.floor(h / 24)
  const r = h % 24
  return r ? `${d} д ${r} ч` : `${d} д`
}
export function rotationLabel(l: Layer) {
  const { unit, count } = l.rotation
  if (unit === 'day') return count === 1 ? 'по суткам' : `по ${count} сут.`
  return count === 1 ? 'по неделе' : `по ${count} нед.`
}
