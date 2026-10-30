import { calendarOnCall, HOUR, isManual, manualGaps, rotationIndex, samplePoints } from './engine'
import { layerLanes, type Lane, type LaneSeg } from './lanes'
import { addDaysTz, atDay, dayNumber, fmtTz, isoOfDayNumber, startOfDayTz, startOfMonthTz, weekdayTz, zparts } from './tz'
import type { Calendar, Layer } from './types'

/** Понедельник недели, в которую попадает t (в зоне календаря). */
export function weekStart(t: number, tz: string) {
  const d = startOfDayTz(t, tz)
  return addDaysTz(d, -weekdayTz(d, tz), tz)
}
/** Номер недели по ISO 8601 (неделя с понедельника, первая — с первым четвергом года). */
export function isoWeek(t: number, tz: string) {
  const n = dayNumber(t, tz)
  const thursday = n - weekdayTz(t, tz) + 3
  const year = Number(isoOfDayNumber(thursday).slice(0, 4))
  const jan1 = Math.round(Date.UTC(year, 0, 1) / 86_400_000)
  return 1 + Math.floor((thursday - jan1) / 7)
}
/** Недели месяца (понедельники), начиная с недели, где 1-е число. */
export function monthWeeks(month: number, tz: string): number[] {
  const first = startOfMonthTz(month, 0, tz)
  const next = startOfMonthTz(month, 1, tz)
  const out: number[] = []
  for (let w = weekStart(first, tz); w < next; w = addDaysTz(w, 7, tz)) out.push(w)
  return out
}
/** «44 неделя, 26 окт – 1 нояб 2026» */
export function weekTitle(ws: number, tz: string) {
  const we = addDaysTz(ws, 6, tz)
  const a = zparts(ws, tz), b = zparts(we, tz)
  const mon = (t: number) => fmtTz(t, tz, { month: 'short' }).replace('.', '')
  const left = a.m === b.m ? `${a.d}` : `${a.d} ${mon(ws)}${a.y !== b.y ? ` ${a.y}` : ''}`
  return `${isoWeek(ws, tz)} неделя, ${left} – ${b.d} ${mon(we)} ${b.y}`
}

/** «Козлова М.» — фамилия и инициал, как в графиках дежурств. */
export function surnameInitial(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return name
  return `${parts[parts.length - 1]} ${parts[0][0]}.`
}

export interface WeekCard {
  key: string
  layerId?: string
  personId: string
  /** границы карточки: от первого до последнего активного часа */
  start: number
  end: number
  /** активные интервалы; между ними — неактивные часы (штриховка) */
  active: { start: number; end: number }[]
  state: 'normal' | 'subst' | 'removed'
  replaced?: string
  shiftId?: string
  slotId?: string
  note?: string
}
export interface WeekGroup { key: string; layer?: Layer; label: string; kind: string; rows: WeekCard[][]; gaps: { start: number; end: number }[] }

const stateOf = (s: LaneSeg): WeekCard['state'] => (s.removed ? 'removed' : s.hatch ? 'subst' : 'normal')

/**
 * Карточки недели: одна карточка — одна смена человека в слое (период ротации или запись ручного графика).
 * Часы вне ограничений слоя внутри смены — неактивные (штриховка), подмена стоит на месте заменяемого, снятые — серые.
 */
export function cardsOfLane(c: Calendar, ln: Lane, layer: Layer | undefined): WeekCard[] {
  const out: WeekCard[] = []
  for (const s of ln.segs) {
    const st = stateOf(s)
    const period = layer && !isManual(layer) ? rotationIndex(layer, s.start + 1, c.timezone) : -1
    const k = layer ? (isManual(layer) ? `s:${s.slotId}` : `r:${period}`) : `x:${s.shiftId ?? s.start}`
    const id = `${k}|${s.personId}|${st}|${s.shiftId ?? ''}`
    const last = out[out.length - 1]
    if (last && last.key.startsWith(id + '#')) {
      last.end = s.end
      const la = last.active[last.active.length - 1]
      if (la.end === s.start) la.end = s.end
      else last.active.push({ start: s.start, end: s.end })
      continue
    }
    out.push({ key: `${id}#${s.start}`, layerId: ln.layerId, personId: s.personId, start: s.start, end: s.end, active: [{ start: s.start, end: s.end }], state: st, replaced: s.replaced, shiftId: s.shiftId, slotId: s.slotId, note: s.extra })
  }
  return out
}

/** Все группы (слои + разовые) недели [ws, ws+7д) и дыры покрытия календаря. */
export function weekBoard(c: Calendar, ws: number, step = HOUR): { groups: WeekGroup[]; gaps: { start: number; end: number }[] } {
  const tz = c.timezone
  const we = addDaysTz(ws, 7, tz)
  const breaks = c.shifts.flatMap((s) => [+new Date(s.start), +new Date(s.end)])
  for (const l of c.layers) if (isManual(l)) for (const x of l.slots ?? []) breaks.push(+new Date(x.start), +new Date(x.end))
  const lanes = layerLanes(c, ws, we, step, breaks)
  const groups: WeekGroup[] = []
  for (const l of c.layers) {
    const mine = lanes.filter((x) => x.layerId === l.id)
    groups.push({ key: l.id, layer: l, label: l.name, kind: l.kind, rows: mine.map((ln) => cardsOfLane(c, ln, l)), gaps: isManual(l) ? manualGaps(l, ws, we) : [] })
  }
  const own = lanes.find((x) => x.key === 'shifts')
  if (own) groups.push({ key: 'shifts', label: 'Разовые дежурства', kind: 'oneoff', rows: packCards(cardsOfLane(c, own, undefined)), gaps: [] })
  // дыры покрытия: никто не дежурит во всём календаре
  const gaps: { start: number; end: number }[] = []
  const pts = samplePoints(ws, we, step, breaks)
  pts.forEach((t, i) => {
    const end = i + 1 < pts.length ? pts[i + 1] : Math.min(we, t + step)
    if (calendarOnCall(c, t + 1).length) return
    const g = gaps[gaps.length - 1]
    if (g && g.end === t) g.end = end
    else gaps.push({ start: t, end })
  })
  return { groups, gaps }
}

function packCards(cards: WeekCard[]): WeekCard[][] {
  const rows: WeekCard[][] = []
  for (const x of [...cards].sort((p, q) => p.start - q.start)) {
    const r = rows.find((row) => row[row.length - 1].end <= x.start)
    if (r) r.push(x)
    else rows.push([x])
  }
  return rows.length ? rows : [[]]
}

const HM = (t: number, tz: string) => fmtTz(t, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** Подпись карточки: «08:00 – 20:00 (12ч)»; если смена на несколько дней — с днями недели. */
export function cardTime(card: Pick<WeekCard, 'start' | 'end' | 'active'>, tz: string, compact = false) {
  const h = card.active.reduce((s, x) => s + x.end - x.start, 0) / HOUR
  const hours = `${Math.round(h * 10) / 10}ч`
  const sameDay = dayNumber(card.start, tz) === dayNumber(card.end - 1, tz)
  const wd = (t: number) => fmtTz(t, tz, { weekday: 'short' }).replace('.', '')
  if (compact) return `${HM(card.start, tz)}–${HM(card.end, tz)}`
  return sameDay || card.end - card.start <= 24 * HOUR ? `${HM(card.start, tz)} – ${HM(card.end, tz)} (${hours})` : `${wd(card.start)} ${HM(card.start, tz)} – ${wd(card.end - 1)} ${HM(card.end, tz)} (${hours})`
}

/** Момент по позиции курсора в строке недели, с привязкой к часу. */
export function snapToHour(ws: number, we: number, frac: number, tz: string, mode: 'floor' | 'ceil' | 'round' = 'round') {
  const t = ws + Math.max(0, Math.min(1, frac)) * (we - ws)
  const day = dayNumber(t, tz)
  const base = atDay(day, 0, tz)
  const h = (t - base) / HOUR
  const hh = mode === 'floor' ? Math.floor(h) : mode === 'ceil' ? Math.ceil(h) : Math.round(h)
  return Math.min(we, base + hh * HOUR)
}
