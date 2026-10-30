/**
 * «Проверка перед запуском»: всё, что лиду нужно увидеть до того, как график начнёт работать.
 * Чистые функции — без React, чтобы проверять тестами.
 */
import { calendarConflicts, calendarLaunch, DAY, HOUR, isGapAt, isManual, manualSlots, readySig, samplePoints, type Conflict } from './engine'
import { resolveChain, type ChainLevel } from './escalation'
import type { Calendar, NotifySettings, Person } from './types'

export const READY_WINDOW_DAYS = 28

export interface Readiness {
  /** первый старт календаря (Infinity — графика нет) */
  launch: number
  /** окно проверки: 4 недели от старта или от «сейчас», что позже */
  from: number
  to: number
  participants: { layerId: string; layerName: string; ids: string[] }[]
  holes: { start: number; end: number }[]
  conflicts: Conflict[]
  chain: ChainLevel[]
  channels: { personId: string; telegram: string; linked: boolean; onEscalation: boolean }[]
  issues: string[]
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}

/** Дыры в покрытии после старта: часы, когда в запущенном календаре никто не дежурит. */
export function coverageHoles(c: Calendar, from: number, to: number): { start: number; end: number }[] {
  const breaks = c.shifts.flatMap((s) => [+new Date(s.start), +new Date(s.end)])
  for (const l of c.layers) if (isManual(l)) for (const x of manualSlots(l)) breaks.push(x.start, x.end)
  const pts = samplePoints(from, to, HOUR, breaks)
  const out: { start: number; end: number }[] = []
  pts.forEach((t, i) => {
    const end = i + 1 < pts.length ? pts[i + 1] : Math.min(to, t + HOUR)
    if (!isGapAt(c, t + 1)) return
    const last = out[out.length - 1]
    if (last && last.end === t) last.end = end
    else out.push({ start: t, end })
  })
  return out
}

export function readiness(c: Calendar, people: Person[], calendars: Calendar[], notify: Record<string, NotifySettings>, now: number, fmt: (t: number) => string): Readiness {
  const launch = calendarLaunch(c)
  const from = Math.floor(Math.max(now, Number.isFinite(launch) ? launch : now) / HOUR) * HOUR
  const to = from + READY_WINDOW_DAYS * DAY
  const participants = c.layers.map((l) => ({ layerId: l.id, layerName: l.name, ids: l.participants }))
  const ids = [...new Set(participants.flatMap((p) => p.ids))]
  const holes = Number.isFinite(launch) ? coverageHoles(c, from, to) : []
  const conflicts = calendarConflicts(c, calendars, from, to)
  const chain = c.layers.length ? resolveChain(c, people, from + 1, calendars) : []
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id
  const channels = ids.map((id) => {
    const n = notify[id]
    return { personId: id, telegram: n?.telegram ?? people.find((p) => p.id === id)?.telegram ?? '', linked: !!n?.chatLinked, onEscalation: n ? n.onEscalation : false }
  })

  const issues: string[] = []
  if (!c.layers.length) issues.push('В календаре нет графика дежурств')
  else if (!ids.length) issues.push('В графике нет участников')
  if (holes.length) {
    const h = holes.reduce((s, x) => s + x.end - x.start, 0) / HOUR
    issues.push(`Дыры в покрытии: ${holes.length} ${plural(holes.length, 'интервал', 'интервала', 'интервалов')}, всего ${Math.round(h)} ч; первая — ${fmt(holes[0].start)} — ${fmt(holes[0].end)}`)
  }
  if (conflicts.length) {
    const who = new Set(conflicts.map((x) => x.personId)).size
    issues.push(`Пересечения с другими дежурствами: ${conflicts.length} у ${who} ${plural(who, 'человека', 'человек', 'человек')}`)
  }
  const unlinked = channels.filter((x) => !x.linked)
  if (unlinked.length) issues.push(`Telegram не подключён: ${unlinked.map((x) => name(x.personId)).join(', ')} — уведомления о сменах не дойдут`)
  const muted = channels.filter((x) => x.linked && !x.onEscalation)
  if (muted.length) issues.push(`Отключены уведомления об эскалации: ${muted.map((x) => name(x.personId)).join(', ')}`)
  if (c.layers.length && !c.escalation.length) issues.push('Эскалация не настроена')
  for (const lv of chain) if (!lv.people.length && !lv.already.length) issues.push(`Эскалация, уровень ${lv.level} («${lv.label}»): уведомлять некого`)
  return { launch, from, to, participants, holes, conflicts, chain, channels, issues }
}

/** Проверка готовности действует, пока график и эскалация не менялись. */
export function readyChecked(c: Calendar): boolean {
  return !!c.readyCheck && c.readyCheck.sig === readySig(c)
}
