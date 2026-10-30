/** Общие блоки для списков календарей: карточка «кто дежурит», компактные строки, фильтры, звёздочка. */
import { useState } from 'react'
import { onCallAt } from './cache'
import { fmtDT, nextHandoff } from './engine'
import type { CalFilter, Coverage } from './search'
import { peopleById, useStore } from './store'
import { tzLabel } from './tz'
import type { Calendar, CalendarType } from './types'
import { Avatar, Card, ContactActions, EscalationChain, inputCls, TYPE_META } from './ui'

export function StarButton({ on, name, onToggle, className = '' }: { on: boolean; name: string; onToggle: () => void; className?: string }) {
  return (
    <button type="button" data-testid="fav-toggle" aria-pressed={on} aria-label={on ? `Убрать «${name}» из избранного` : `Добавить «${name}» в избранное`} title={on ? 'В избранном' : 'В избранное'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 ${on ? 'text-warn' : 'text-faint hover:text-ink'} ${className}`}>
      <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    </button>
  )
}

/** Карточка календаря на дашборде: кто дежурит, контакты, эскалация. */
export function OnCallCard({ c, now, fav, onFav }: { c: Calendar; now: number; fav: boolean; onFav: () => void }) {
  const { state } = useStore()
  const [chain, setChain] = useState(false)
  const byId = peopleById(state.people)
  const entries = onCallAt(c, now)
  const lead = byId.get(c.leadId)
  const handoffs = c.layers.map((l) => nextHandoff(l, now, c.timezone))
  const nextH = handoffs.length ? Math.min(...handoffs) : null
  const me = state.currentUserId
  return (
    <Card className="flex flex-col" >
      <div className="flex items-start gap-3 px-5 pt-5" data-testid="oncall-card">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[c.type].color }} />
        <div className="min-w-0 flex-1">
          <a href={`#/calendars/${c.id}`} className="text-base font-medium hover:text-accent">{c.name}</a>
          <div className="mt-0.5 truncate text-sm text-muted">{c.product}</div>
        </div>
        <StarButton on={fav} name={c.name} onToggle={onFav} className="-mt-1 -mr-2" />
      </div>
      <div className="flex-1 space-y-3 px-5 py-4">
        {entries.length === 0 && <p className="text-sm text-danger">Сейчас никто не дежурит. Алерт уйдёт лиду.</p>}
        {entries.map((e) => {
          const p = byId.get(e.personId)
          if (!p) return null
          return (
            <div key={e.personId} className="flex items-center gap-3">
              <Avatar p={p} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}{p.id === me && <span className="font-normal text-muted"> · вы</span>}</div>
                <div className="truncate text-xs text-muted">{e.layerName}{e.replaced && ` · вместо ${byId.get(e.replaced)?.name}`} · {p.phone}</div>
              </div>
              <ContactActions p={p} />
            </div>
          )
        })}
        <p className="text-xs text-faint">Лид {lead?.name}{nextH ? ` · передача ${fmtDT(nextH, c.timezone)} ${tzLabel(c.timezone)}` : ''}</p>
        <button className="text-sm text-muted hover:text-ink" aria-expanded={chain} onClick={() => setChain(!chain)}>{chain ? 'Скрыть эскалацию' : 'Эскалация'}</button>
        {chain && <EscalationChain c={c} people={state.people} t={now} calendars={state.calendars} compact />}
      </div>
    </Card>
  )
}

/** Компактная строка календаря: для длинных списков. */
export function CalendarRow({ c, now, org, fav, onFav }: { c: Calendar; now: number; org: string; fav: boolean; onFav: () => void }) {
  const { state } = useStore()
  const byId = peopleById(state.people)
  const entries = onCallAt(c, now)
  const first = entries[0] ? byId.get(entries[0].personId) : undefined
  return (
    <li className="flex items-center gap-3 px-1 py-2.5" data-testid="calendar-row">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[c.type].color }} title={TYPE_META[c.type].label} />
      <div className="min-w-0 flex-1 sm:w-[38%] sm:flex-none">
        <a href={`#/calendars/${c.id}`} className="block truncate text-sm font-medium hover:text-accent">{c.name}</a>
        <div className="truncate text-xs text-faint">{org}</div>
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
        {first ? (
          <>
            <Avatar p={first} size={24} />
            <span className="min-w-0 truncate text-sm">{first.name}{entries.length > 1 && <span className="text-muted"> +{entries.length - 1}</span>}<span className="text-muted"> · {entries[0].layerName}</span></span>
          </>
        ) : <span className="text-sm text-danger">никто не дежурит</span>}
      </div>
      {first && <span className="hidden text-xs text-muted md:inline">{first.phone}</span>}
      {first ? <ContactActions p={first} /> : <span className="w-12" />}
      <StarButton on={fav} name={c.name} onToggle={onFav} />
    </li>
  )
}

const COVERAGE: [Coverage, string][] = [['all', 'Любое покрытие'], ['now', 'Без дежурного сейчас'], ['week', 'С дырами за 7 дней']]
const selCls = 'rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent'

export function CalendarFilters({ f, set, orgs, label = 'Поиск календарей' }: { f: CalFilter; set: (f: CalFilter) => void; orgs: string[]; label?: string }) {
  const active = f.q || f.coverage !== 'all' || f.org || f.type !== 'all'
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Фильтры календарей">
      <input aria-label={label} type="search" data-testid="cal-search" className={`${inputCls} w-full sm:w-64`} placeholder="Название, система, команда" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} />
      <select aria-label="Покрытие" data-testid="cal-coverage" className={`${selCls} ${f.coverage !== 'all' ? 'border-accent text-accent' : ''}`} value={f.coverage} onChange={(e) => set({ ...f, coverage: e.target.value as Coverage })}>
        {COVERAGE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select aria-label="Подразделение" data-testid="cal-org" className={`${selCls} max-w-56`} value={f.org} onChange={(e) => set({ ...f, org: e.target.value })}>
        <option value="">Все подразделения</option>
        {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <select aria-label="Тип" data-testid="cal-type" className={selCls} value={f.type} onChange={(e) => set({ ...f, type: e.target.value as CalendarType | 'all' })}>
        <option value="all">Все типы</option>
        {(Object.keys(TYPE_META) as CalendarType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
      </select>
      {active && <button type="button" className="px-1 text-sm text-muted hover:text-ink" onClick={() => set({ q: '', coverage: 'all', org: '', type: 'all' })}>Сбросить</button>}
    </div>
  )
}

/** Постраничный вывод: показывает «1–20 из 300» и стрелки. */
export function Pager({ page, total, size, set }: { page: number; total: number; size: number; set: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (total <= size) return null
  const from = page * size + 1
  const to = Math.min(total, from + size - 1)
  const btn = 'rounded-md px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <nav aria-label="Страницы" className="flex items-center justify-between gap-3 pt-3 text-sm text-muted">
      <span data-testid="pager-range">{from}–{to} из {total}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn} disabled={page === 0} onClick={() => set(page - 1)} aria-label="Предыдущая страница">‹ Назад</button>
        <span className="px-1 tabular-nums">{page + 1} / {pages}</span>
        <button type="button" className={btn} disabled={page >= pages - 1} onClick={() => set(page + 1)} aria-label="Следующая страница">Вперёд ›</button>
      </span>
    </nav>
  )
}
