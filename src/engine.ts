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
    entries.push({ personId: s.personId, layerId: null, layerName: 'Разовое', kind: 'oneoff' })
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
  hatch?: boolean
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

export interface DutySpan {
  start: number
  end: number
  personId: string
  calendarId: string
  calendarName: string
  layerId: string | null
  layerName: string
  kind: string
  replacedId?: string
  note?: string
}

/** Смены человека по всем календарям: слои (с учётом подмен) и взятые дежурства. */
export function personDutySpans(calendars: Calendar[], personId: string, from: number, to: number, step = HOUR): DutySpan[] {
  const out: DutySpan[] = []
  for (const c of calendars) {
    const replacedAt = (t: number) => c.shifts.some((s) => s.replacesPersonId === personId && t >= +new Date(s.start) && t < +new Date(s.end))
    for (const l of c.layers) {
      if (!l.participants.includes(personId)) continue
      for (const s of sampleSegments(from, to, (t) => (replacedAt(t) || !layerOnCall(l, t).includes(personId) ? null : personId), step)) {
        out.push({ start: s.start, end: s.end, personId, calendarId: c.id, calendarName: c.name, layerId: l.id, layerName: l.name, kind: l.kind })
      }
    }
    for (const s of c.shifts) {
      if (s.personId !== personId) continue
      const start = Math.max(from, +new Date(s.start))
      const end = Math.min(to, +new Date(s.end))
      if (end <= start) continue
      out.push({
        start, end, personId, calendarId: c.id, calendarName: c.name, layerId: null,
        layerName: s.replacesPersonId ? 'Подмена' : 'Разовое', kind: s.replacesPersonId ? 'override' : 'oneoff', replacedId: s.replacesPersonId, note: s.note,
      })
    }
  }
  return out
}

export interface CoverSeg { start: number; end: number; gap: boolean; gapNames: string }

/** Дыры: интервалы, где хотя бы в одном календаре команды никто не дежурит. */
export function teamCoverage(calendars: Calendar[], from: number, to: number, step = HOUR): CoverSeg[] {
  const out: CoverSeg[] = []
  let cur: CoverSeg | null = null
  for (let t = from; t < to; t += step) {
    const names = calendars.filter((c) => calendarOnCall(c, t + 1).length === 0).map((c) => c.name)
    const gap = names.length > 0
    const gapNames = names.join(', ')
    if (cur && cur.gap === gap && cur.gapNames === gapNames) cur.end = t + step
    else {
      if (cur) out.push(cur)
      cur = { start: t, end: t + step, gap, gapNames }
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Участки, где одновременно действуют две и более смены. */
export function overlapRanges(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const ev: { t: number; d: number }[] = []
  for (const s of spans) {
    ev.push({ t: s.start, d: 1 })
    ev.push({ t: s.end, d: -1 })
  }
  ev.sort((a, b) => a.t - b.t || a.d - b.d)
  const out: { start: number; end: number }[] = []
  let n = 0
  let open: number | null = null
  for (const e of ev) {
    const prev = n
    n += e.d
    if (prev < 2 && n >= 2) open = e.t
    else if (prev >= 2 && n < 2 && open != null) {
      if (e.t > open) out.push({ start: open, end: e.t })
      open = null
    }
  }
  return out
}

function gcd(a: number, b: number) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) { const t = y; y = x % y; x = t }
  return x || 1
}

function ruCount(n: number, one: string, few: string, many: string) {
  const n10 = n % 10
  const n100 = n % 100
  const word = n10 === 1 && n100 !== 11 ? one : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? few : many
  return `${n} ${word}`
}

export interface PatternInfo {
  line: string
  regular: boolean
  onPeriods: number
  offPeriods: number
  parallel: number
  people: number
}

/** Одна строка о фактическом ритме. Совпадает с layerOnCall и меняется вместе с parallel. */
export function describePattern(l: Pick<Layer, 'participants' | 'parallel' | 'rotation'>, nameOf?: (id: string) => string): PatternInfo {
  const people = l.participants.length
  const parallel = Math.max(1, l.parallel)
  if (!people) {
    return { line: 'Отметьте участников — от их числа зависит, сколько длится отдых.', regular: false, onPeriods: 0, offPeriods: 0, parallel, people: 0 }
  }
  const k = Math.min(parallel, people)
  const cycle = people / gcd(k, people)
  const onAt: boolean[] = []
  for (let idx = 0; idx < cycle; idx++) {
    let on = false
    for (let i = 0; i < k; i++) if ((idx * k + i) % people === 0) on = true
    onAt.push(on)
  }
  const first = onAt.indexOf(true)
  let onPeriods = 0
  let offPeriods = 0
  if (first >= 0) {
    let i = first
    while (onAt[i % cycle] && onPeriods < cycle) { onPeriods++; i++ }
    while (!onAt[i % cycle] && offPeriods < cycle) { offPeriods++; i++ }
  }
  const regular = onPeriods > 0 && onPeriods + offPeriods === cycle
  const spell = (periods: number) => l.rotation.unit === 'day'
    ? ruCount(periods * l.rotation.count, 'сутки', 'суток', 'суток')
    : ruCount(periods * l.rotation.count, 'неделю', 'недели', 'недель')
  const firstIds: string[] = []
  for (let i = 0; i < k; i++) firstIds.push(l.participants[i % people])
  const who = nameOf ? firstIds.map((id) => nameOf(id).split(' ')[0]).join(' и ') : ''
  let line: string
  if (regular && offPeriods === 0) line = `Одновременно ${k}: очередь из ${people} дежурит без перерыва${who ? `, сейчас ${who}` : ''}.`
  else if (regular) line = `Одновременно ${k}: каждый дежурит ${spell(onPeriods)}, затем отдыхает ${spell(offPeriods)}${who ? `. Сначала ${who}` : ''}.`
  else line = `Одновременно ${k} из ${people}, смена ${spell(1)}: отдых в очереди получается разным${who ? `. Сначала ${who}` : ''}.`
  return { line, regular, onPeriods, offPeriods, parallel: k, people }
}

function handoffOn(dayStart: number, handoff: string) {
  const d = new Date(dayStart)
  const m = hm(handoff)
  d.setHours(Math.floor(m / 60), m % 60, 0, 0)
  return d.getTime()
}

/** Целые сутки от времени передачи смены. Прошедший интервал помечается past, частично прошедший сдвигается вперёд. */
export function snapDuty(a: number, b: number, handoff: string, now = Date.now()) {
  const s = Math.min(a, b)
  const e = Math.max(a, b)
  let start = handoffOn(startOfDay(s).getTime(), handoff)
  if (s < start) start -= DAY
  let end = handoffOn(startOfDay(e).getTime(), handoff)
  if (e > end) end += DAY
  if (end <= start) end = start + DAY
  if (end <= now) return { start, end, past: true, shifted: false }
  let shifted = false
  if (start < now) {
    let next = handoffOn(startOfDay(now).getTime(), handoff)
    if (next < now) next += DAY
    if (next >= end) end = next + DAY
    start = next
    shifted = true
  }
  return { start, end, past: false, shifted }
}

export function calendarHandoff(layers: { handoffTime: string }[]) {
  return layers[0]?.handoffTime || '10:00'
}

export type SnapMode = 'hour' | 'day'

/** Привязка интервала к часам или суткам. Конец всегда позже начала хотя бы на один шаг. */
export function snapRange(a: number, b: number, mode: SnapMode): [number, number] {
  let s = Math.min(a, b)
  let e = Math.max(a, b)
  if (mode === 'hour') {
    s = Math.floor(s / HOUR) * HOUR
    e = Math.ceil(e / HOUR) * HOUR
    if (e - s < HOUR) e = s + HOUR
  } else {
    s = startOfDay(s).getTime()
    const endDay = startOfDay(e).getTime()
    e = e > endDay ? endDay + DAY : endDay
    if (e - s < DAY) e = s + DAY
  }
  return [s, e]
}
