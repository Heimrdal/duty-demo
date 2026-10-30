import type { Calendar, Layer, Person, Restriction, Shift } from './types'
import { addDaysTz, atDay, dayNumber, dayNumberOfIso, DEFAULT_TZ, fmtTz, isoDateTz, minutesOfDayTz, startOfDayTz, weekdayTz } from './tz'

export const HOUR = 3600_000
export const DAY = 24 * HOUR

export const uid = () => Math.random().toString(36).slice(2, 10)


export { DEFAULT_TZ }

/** Начало суток в зоне (по умолчанию МСК), а не в зоне браузера. */
export function startOfDay(t: Date | number, tz: string = DEFAULT_TZ) {
  return startOfDayTz(+t, tz)
}
export function addDays(t: Date | number, n: number, tz: string = DEFAULT_TZ) {
  return addDaysTz(+t, n, tz)
}
export function hm(s: string) {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}
export function isoDate(t: Date | number, tz: string = DEFAULT_TZ) {
  return isoDateTz(+t, tz)
}
export function weekday(t: Date | number, tz: string = DEFAULT_TZ) {
  return weekdayTz(+t, tz) // 0 = Пн
}

export function periodDays(l: Pick<Layer, 'rotation'>) {
  return l.rotation.count * (l.rotation.unit === 'week' ? 7 : 1)
}
/** Начало ротации слоя: дата startsAt + время передачи смены, в зоне календаря */
export function layerAnchor(l: Layer, tz: string) {
  return atDay(dayNumberOfIso(l.startsAt), hm(l.handoffTime), tz)
}
/** Момент передачи смены перед сменой номер idx (0 — начало ротации). */
export function layerBoundary(l: Layer, idx: number, tz: string) {
  return atDay(dayNumberOfIso(l.startsAt) + idx * periodDays(l), hm(l.handoffTime), tz)
}

export function inRestriction(r: Restriction, t: number, tz: string) {
  if (r.type === 'none') return true
  const mins = minutesOfDayTz(t, tz)
  const from = hm(r.from)
  const to = hm(r.to)
  let inWindow: boolean
  let dayForCheck = weekdayTz(t, tz)
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

/** Индекс ротации (номер смены) в момент t. Сутки считаются по календарю зоны, поэтому переход на летнее время не сдвигает передачу. */
export function rotationIndex(l: Layer, t: number, tz: string) {
  if (t < layerAnchor(l, tz)) return -1
  const eff = dayNumber(t, tz) - (minutesOfDayTz(t, tz) < hm(l.handoffTime) ? 1 : 0)
  return Math.floor((eff - dayNumberOfIso(l.startsAt)) / periodDays(l))
}

/** Кто дежурит в слое в момент t (с учётом параллельных мест) */
export function layerOnCall(l: Layer, t: number, tz: string): string[] {
  const n = l.participants.length
  if (!n) return []
  const idx = rotationIndex(l, t, tz)
  if (idx < 0) return []
  if (!inRestriction(l.restriction, t, tz)) return []
  const k = Math.min(l.parallel, n)
  const res: string[] = []
  for (let i = 0; i < k; i++) res.push(l.participants[(idx * k + i) % n])
  return res
}
export function layerSlot(l: Layer, t: number, slot: number, tz: string): string | null {
  return layerOnCall(l, t, tz)[slot] ?? null
}
/** Следующий по ротации (OneUptime: "Next in rotation") */
export function nextInRotation(l: Layer, t: number, tz: string): string[] {
  const n = l.participants.length
  if (!n) return []
  const idx = Math.max(rotationIndex(l, t, tz), 0) + 1
  const k = Math.min(l.parallel, n)
  const res: string[] = []
  for (let i = 0; i < k; i++) res.push(l.participants[(idx * k + i) % n])
  return res
}
export function nextHandoff(l: Layer, t: number, tz: string) {
  const a = layerAnchor(l, tz)
  if (t < a) return a
  return layerBoundary(l, rotationIndex(l, t, tz) + 1, tz)
}

export interface OnCallEntry {
  personId: string
  layerId: string | null // null = ручная смена/подмена
  layerName: string
  kind: string
  replaced?: string
}

export const isRemoval = (s: Shift) => !!s.removesPersonId
const inShift = (s: Shift, t: number) => t >= +new Date(s.start) && t < +new Date(s.end)
// календари неизменяемые: список снятий считаем один раз на массив смен (горячий путь — расчёт «кто дежурит»)
const NO_REMOVALS: Shift[] = []
const removalsCache = new WeakMap<Shift[], Shift[]>()
function removalsOf(c: Calendar): Shift[] {
  if (!c.shifts.length) return NO_REMOVALS
  let v = removalsCache.get(c.shifts)
  if (!v) { v = c.shifts.filter(isRemoval); if (!v.length) v = NO_REMOVALS; removalsCache.set(c.shifts, v) }
  return v
}

/** Снят ли человек с дежурства в слое в момент t. */
export function removedAt(c: Calendar, personId: string, layerId: string, t: number): Shift | undefined {
  const all = removalsOf(c)
  return all.length ? all.find((s) => s.removesPersonId === personId && (!s.layerId || s.layerId === layerId) && inShift(s, t)) : undefined
}

/** Итоговое расписание календаря в момент t */
export function calendarOnCall(c: Calendar, t: number): OnCallEntry[] {
  let entries: OnCallEntry[] = []
  const all = removalsOf(c)
  const removals = all.length ? all.filter((s) => inShift(s, t)) : all
  for (const l of c.layers) {
    let ids = layerOnCall(l, t, c.timezone)
    // снятые с дежурства не получают алерты; если слой опустел — в режиме приоритета работает следующий слой
    if (removals.length) ids = ids.filter((id) => !removals.some((r) => r.removesPersonId === id && (!r.layerId || r.layerId === l.id)))
    if (!ids.length) continue
    for (const id of ids) entries.push({ personId: id, layerId: l.id, layerName: l.name, kind: l.kind })
    if (c.layerMode === 'priority') break // OneUptime: верхний слой, где кто-то есть, перекрывает нижние
  }
  for (const s of c.shifts) {
    if (s.removesPersonId || !s.personId) continue
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

/** Точки выборки: сетка с шагом step плюс точные границы (например, начало снятия с дежурства). */
export function samplePoints(from: number, to: number, step = HOUR, breaks: number[] = []): number[] {
  const pts: number[] = []
  for (let t = from; t < to; t += step) pts.push(t)
  if (!breaks.length) return pts
  for (const x of breaks) if (x > from && x < to) pts.push(x)
  return [...new Set(pts)].sort((x, y) => x - y)
}

/** Сегменты для таймлайна: почасовая выборка + склейка (+ точные границы breaks) */
export function sampleSegments(from: number, to: number, fn: (t: number) => string | null, step = HOUR, breaks: number[] = []): Segment[] {
  const out: Segment[] = []
  let cur: Segment | null = null
  const pts = samplePoints(from, to, step, breaks)
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i]
    const next = i + 1 < pts.length ? pts[i + 1] : Math.min(to, t + step)
    const p = fn(t + 1)
    if (cur && cur.personId === p) {
      cur.end = next
      continue
    }
    if (cur) out.push(cur)
    cur = p ? { start: t, end: next, personId: p } : null
  }
  if (cur) out.push(cur)
  return out
}

export function managerOf(people: Person[], id: string) {
  const p = people.find((x) => x.id === id)
  return p?.managerId ? people.find((x) => x.id === p.managerId) : undefined
}

export function fmtDT(t: number | string | Date, tz: string = DEFAULT_TZ) {
  return fmtTz(t, tz, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function fmtT(t: number | string | Date, tz: string = DEFAULT_TZ) {
  return fmtTz(t, tz, { hour: '2-digit', minute: '2-digit' })
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
      for (const s of sampleSegments(from, to, (t) => (replacedAt(t) || removedAt(c, personId, l.id, t) || !layerOnCall(l, t, c.timezone).includes(personId) ? null : personId), step)) {
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

function handoffOn(t: number, handoff: string, tz: string) {
  return atDay(dayNumber(t, tz), hm(handoff), tz)
}

/** Целые сутки от времени передачи смены (в зоне календаря). Прошедший интервал помечается past, частично прошедший сдвигается вперёд. */
export function snapDuty(a: number, b: number, handoff: string, tz: string, now = Date.now()) {
  const s = Math.min(a, b)
  const e = Math.max(a, b)
  let start = handoffOn(s, handoff, tz)
  if (s < start) start = addDaysTz(start, -1, tz)
  let end = handoffOn(e, handoff, tz)
  if (e > end) end = addDaysTz(end, 1, tz)
  if (end <= start) end = addDaysTz(start, 1, tz)
  if (end <= now) return { start, end, past: true, shifted: false }
  let shifted = false
  if (start < now) {
    let next = handoffOn(now, handoff, tz)
    if (next < now) next = addDaysTz(next, 1, tz)
    if (next >= end) end = addDaysTz(next, 1, tz)
    start = next
    shifted = true
  }
  return { start, end, past: false, shifted }
}

export function calendarHandoff(layers: { handoffTime: string }[]) {
  return layers[0]?.handoffTime || '10:00'
}

/** Первый и последний момент в [a, b), где в after никого нет, а в before кто-то был (шаг 15 минут, только будущее). */
function newGap(before: Calendar, after: Calendar, a: number, b: number): { start: number; end: number } | null {
  let gs = -1
  let ge = -1
  for (let t = a; t < b; t += HOUR / 4) {
    const probe = t === a ? t + 1 : t
    if (calendarOnCall(after, probe).length === 0 && calendarOnCall(before, probe).length > 0) {
      if (gs < 0) gs = t
      ge = Math.min(b, t + HOUR / 4)
    }
  }
  return gs < 0 ? null : { start: gs, end: ge }
}

/** Интервалы, где без этой смены в календаре никого не останется (только будущее). */
export function shiftGap(c: Calendar, s: Shift, now: number): { start: number; end: number } | null {
  const without = { ...c, shifts: c.shifts.filter((x) => x.id !== s.id) }
  return newGap(c, without, Math.max(now, +new Date(s.start)), +new Date(s.end))
}

/** Дыра, которая появится, если добавить смены (например, снятие с дежурства без замены). */
export function addGap(c: Calendar, add: Shift[], now: number): { start: number; end: number } | null {
  if (!add.length) return null
  const a = Math.max(now, Math.min(...add.map((s) => +new Date(s.start))))
  const b = Math.max(...add.map((s) => +new Date(s.end)))
  return newGap(c, { ...c, shifts: [...c.shifts, ...add] }, a, b)
}

export interface RemovalInput { personId: string; layerId?: string; start: number; end: number; note?: string }
/** Запись «снят с дежурства». personId пустой: дежурного в слоте нет, пока его не поставят. */
export function makeRemoval(x: RemovalInput, now: number = Date.now()): Shift {
  if (!x.personId) throw new Error('Не выбран дежурный')
  if (!(x.end > x.start)) throw new Error('Окончание раньше начала')
  return {
    id: uid(), personId: '', removesPersonId: x.personId, layerId: x.layerId || undefined,
    start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString(),
    note: x.note?.trim() || undefined, createdAt: new Date(now).toISOString(),
  }
}
