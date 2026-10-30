/** Поиск по командам, календарям, людям и системам + фильтры списков. Чистые функции: легко тестировать. */
import { hasWeekGap, onCallAt } from './cache'
import { calendarLaunch } from './engine'
import type { Calendar, Person } from './types'

/** Нижний регистр, ё → е, всё кроме букв и цифр — пробел. */
export function norm(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9+]+/g, ' ').trim()
}
export const tokens = (q: string) => norm(q).split(' ').filter(Boolean)

export type HitKind = 'calendar' | 'team' | 'person' | 'product'
export interface SearchItem {
  kind: HitKind
  id: string
  title: string
  sub: string
  href: string
  /** календари, связанные с результатом (для команды и системы) */
  calendarIds: string[]
  nTitle: string
  nOther: string
}

const KIND_BONUS: Record<HitKind, number> = { calendar: 3, team: 2, person: 1, product: 0 }

/** Индекс строится один раз на версию данных. */
export function buildIndex(people: Person[], calendars: Calendar[]): SearchItem[] {
  const items: SearchItem[] = []
  const item = (x: Omit<SearchItem, 'nTitle' | 'nOther'>, other: string[]) =>
    items.push({ ...x, nTitle: norm(x.title), nOther: norm(other.join(' ')) })
  const teamCals = new Map<string, string[]>()
  for (const c of calendars) teamCals.set(c.team, [...(teamCals.get(c.team) ?? []), c.id])
  for (const p of people) for (const t of p.teams) if (!teamCals.has(t)) teamCals.set(t, [])
  for (const c of calendars) item({ kind: 'calendar', id: c.id, title: c.name, sub: c.product, href: `#/calendars/${c.id}`, calendarIds: [c.id] }, [c.team, c.product, c.orgUnit ?? ''])
  const calName = new Map(calendars.map((c) => [c.id, c.name]))
  for (const [t, ids] of teamCals) {
    // команда с единственным одноимённым календарём — не дублируем строку в выдаче
    if (ids.length === 1 && calName.get(ids[0]) === t) continue
    const org = calendars.find((c) => c.team === t)?.orgUnit ?? ''
    item({ kind: 'team', id: 'team:' + t, title: t, sub: `Дежурства команды · ${ids.length ? `${ids.length} календар${ids.length === 1 ? 'ь' : ids.length < 5 ? 'я' : 'ей'}` : 'без календаря'}${org ? ' · ' + org : ''}`, href: `#/teams/${encodeURIComponent(t)}`, calendarIds: ids }, [org])
  }
  const products = new Map<string, string[]>()
  for (const c of calendars) products.set(c.product, [...(products.get(c.product) ?? []), c.id])
  for (const [prod, ids] of products) {
    const single = ids.length === 1
    item({ kind: 'product', id: 'product:' + prod, title: prod, sub: single ? 'Система · 1 календарь' : `Система · ${ids.length} календар${ids.length < 5 ? 'я' : 'ей'}`, href: single ? `#/calendars/${ids[0]}` : `#/calendars/q/${encodeURIComponent(prod)}`, calendarIds: ids }, [])
  }
  for (const p of people) item({ kind: 'person', id: p.id, title: p.name, sub: `${p.title} · ${p.orgUnit}`, href: `#/people/${p.id}`, calendarIds: [] }, [p.telegram, p.title, p.orgUnit, p.phone.replace(/\D/g, ''), p.email])
  return items
}

/** Оценка совпадения: 0 — не подходит. Выше — лучше. */
export function scoreItem(it: SearchItem, q: string | string[]): number {
  const toks = typeof q === 'string' ? tokens(q) : q
  if (!toks.length) return 0
  const full = toks.join(' ')
  const t = ' ' + it.nTitle
  const o = ' ' + it.nOther
  for (const tok of toks) if (!t.includes(tok) && !o.includes(tok)) return 0
  let s: number
  if (it.nTitle === full) s = 100
  else if (it.nTitle.startsWith(full)) s = 80
  else if (t.includes(' ' + full)) s = 65
  else if (toks.every((tok) => t.includes(' ' + tok))) s = 55
  else if (it.nTitle.includes(full)) s = 40
  else if (toks.every((tok) => t.includes(tok))) s = 35
  else if (toks.every((tok) => t.includes(' ' + tok) || o.includes(' ' + tok))) s = 25
  else s = 15
  // точное совпадение с полем целиком (telegram, телефон) — почти как совпадение по названию
  if (s < 60 && (o + ' ').includes(' ' + full + ' ')) s = 60
  return s + KIND_BONUS[it.kind]
}

const collator = new Intl.Collator('ru')
export interface Hit { item: SearchItem; score: number }
export function search(index: SearchItem[], q: string, limit = 40): Hit[] {
  const out: Hit[] = []
  const toks = tokens(q)
  if (!toks.length) return out
  for (const item of index) {
    const score = scoreItem(item, toks)
    if (score > 0) out.push({ item, score })
  }
  out.sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length || collator.compare(a.item.title, b.item.title))
  return out.slice(0, limit)
}

export const KIND_ORDER: HitKind[] = ['team', 'calendar', 'person', 'product']
export const KIND_LABEL: Record<HitKind, string> = { team: 'Дежурства команд', calendar: 'Календари', person: 'Люди', product: 'Системы' }

/** Группы для показа: порядок групп — по лучшему результату, в группе не больше perGroup. */
export function groupHits(hits: Hit[], perGroup = 6) {
  const groups = new Map<HitKind, Hit[]>()
  for (const h of hits) groups.set(h.item.kind, [...(groups.get(h.item.kind) ?? []), h])
  return [...groups.entries()]
    .sort((a, b) => b[1][0].score - a[1][0].score || KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
    .map(([kind, list]) => ({ kind, hits: list.slice(0, perGroup), more: Math.max(0, list.length - perGroup) }))
}

/* ---------- выбор сотрудника ---------- */

export interface PeopleMatch { team: Person[]; rest: Person[]; total: number }
/**
 * Поиск сотрудника по имени, telegram, подразделению и должности. Все слова запроса должны совпасть.
 * Сначала люди команды (teamFirst, в их порядке), затем остальные; внутри — по качеству совпадения и имени.
 */
export function filterPeople(people: Person[], q: string, teamFirst: string[] = [], limit = 50): PeopleMatch {
  const toks = tokens(q)
  const prefer = new Map(teamFirst.map((id, i) => [id, i]))
  const scored: { p: Person; s: number }[] = []
  for (const p of people) {
    if (!toks.length) { scored.push({ p, s: 0 }); continue }
    const name = ' ' + norm(p.name)
    const other = ' ' + norm([p.telegram, p.orgUnit, p.title].join(' '))
    if (!toks.every((t) => name.includes(t) || other.includes(t))) continue
    const s = toks.every((t) => name.includes(' ' + t)) ? 3 : toks.every((t) => name.includes(t)) ? 2 : 1
    scored.push({ p, s })
  }
  const team = scored.filter((x) => prefer.has(x.p.id)).sort((a, b) => b.s - a.s || prefer.get(a.p.id)! - prefer.get(b.p.id)!)
  const rest = scored.filter((x) => !prefer.has(x.p.id)).sort((a, b) => b.s - a.s || collator.compare(a.p.name, b.p.name))
  const teamOut = team.slice(0, limit).map((x) => x.p)
  return { team: teamOut, rest: rest.slice(0, Math.max(0, limit - teamOut.length)).map((x) => x.p), total: scored.length }
}

/* ---------- фильтры календарей (дашборд и раздел «Календари») ---------- */

export type Coverage = 'all' | 'now' | 'week'
export interface CalFilter { q: string; coverage: Coverage; org: string }
export const EMPTY_FILTER: CalFilter = { q: '', coverage: 'all', org: '' }

export function calendarOrgUnit(c: Calendar, people: Map<string, Person> | Person[]): string {
  if (c.orgUnit) return c.orgUnit
  const lead = Array.isArray(people) ? people.find((p) => p.id === c.leadId) : people.get(c.leadId)
  return lead?.orgUnit ?? ''
}

export function filterCalendars(cals: Calendar[], f: CalFilter, now: number, orgOf: (c: Calendar) => string): Calendar[] {
  const toks = tokens(f.q)
  return cals.filter((c) => {
    if (f.org && orgOf(c) !== f.org) return false
    if (toks.length) {
      const hay = ' ' + norm([c.name, c.product, c.team, orgOf(c)].join(' '))
      if (!toks.every((t) => hay.includes(t))) return false
    }
    if (f.coverage === 'now' && (onCallAt(c, now).length > 0 || now < calendarLaunch(c))) return false
    if (f.coverage === 'week' && !hasWeekGap(c, now)) return false
    return true
  })
}
