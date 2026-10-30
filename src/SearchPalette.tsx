import { useMemo, useState, type KeyboardEvent } from 'react'
import { onCallIndex } from './cache'
import type { OnCallEntry } from './engine'
import { loadFavorites } from './favorites'
import { buildIndex, groupHits, KIND_LABEL, search, type Hit, type SearchItem } from './search'
import { peopleById, useNow, useStore } from './store'
import type { Calendar, Person, State } from './types'
import { Avatar, ContactActions, copyText, Modal } from './ui'

let cached: { people: State['people']; calendars: State['calendars']; index: SearchItem[] } | null = null
/** Индекс поиска строится один раз на версию данных. */
export function searchIndex(state: State) {
  if (!cached || cached.people !== state.people || cached.calendars !== state.calendars) {
    cached = { people: state.people, calendars: state.calendars, index: buildIndex(state.people, state.calendars) }
  }
  return cached.index
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const hotkeyLabel = () => (isMac() ? '⌘K' : 'Ctrl K')

interface Row { hit: Hit; onDuty: { p: Person; e?: OnCallEntry }[]; contact?: Person; dutyIn?: Calendar[] }

/** Глобальный поиск: команды, календари, люди, системы. Ctrl/Cmd+K. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { state, toast } = useStore()
  const now = useNow()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const index = searchIndex(state)
  const idx = onCallIndex(state.calendars, now)
  const byId = peopleById(state.people)
  const me = state.currentUserId ? byId.get(state.currentUserId) : undefined

  const groups = useMemo(() => {
    if (q.trim()) return groupHits(search(index, q, 60), 6)
    // пустой запрос — быстрый доступ: избранное и свои команды
    const fav = me ? loadFavorites(me.id) : []
    const ids = [...new Set([...fav, ...state.calendars.filter((c) => me && (me.teams.includes(c.team) || c.leadId === me.id)).map((c) => c.id)])].slice(0, 6)
    const hits = ids.map((id) => index.find((x) => x.kind === 'calendar' && x.id === id)).filter((x) => !!x).map((item) => ({ item, score: 1 }))
    return hits.length ? [{ kind: 'calendar' as const, hits, more: 0, label: 'Избранное и мои команды' }] : []
  }, [q, index, me, state.calendars])

  const rows: Row[][] = groups.map((g) => g.hits.map((hit) => {
    const it = hit.item
    if (it.kind === 'person') {
      const p = byId.get(it.id)
      return { hit, onDuty: [], contact: p, dutyIn: idx.byPerson.get(it.id) ?? [] }
    }
    const entries = it.calendarIds.flatMap((id) => idx.byCalendar.get(id) ?? [])
    const seen = new Set<string>()
    const onDuty = entries.filter((e) => (seen.has(e.personId) ? false : (seen.add(e.personId), true))).map((e) => ({ p: byId.get(e.personId)!, e })).filter((x) => x.p)
    return { hit, onDuty, contact: onDuty[0]?.p }
  }))
  const flat = rows.flat()
  const cur = Math.min(active, Math.max(0, flat.length - 1))

  const open = (r: Row) => { location.hash = r.hit.item.href; onClose() }
  const copy = async (r: Row) => {
    if (!r.contact) { toast('Сейчас никто не дежурит — номер не скопирован'); return }
    toast((await copyText(r.contact.phone)) ? `Номер ${r.contact.phone} (${r.contact.name}) скопирован` : `Номер: ${r.contact.phone}`)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0) }
    else if (e.key === 'Enter' && flat[cur]) { e.preventDefault(); if (e.shiftKey) copy(flat[cur]); else open(flat[cur]) }
  }
  const move = (d: number) => {
    if (!flat.length) return
    const n = (cur + d + flat.length) % flat.length
    setActive(n)
    document.getElementById(`sr-${n}`)?.scrollIntoView({ block: 'nearest' })
  }

  let i = -1
  return (
    <Modal title="Поиск" onClose={onClose} wide>
      <div className="-mx-6 -mt-1">
        <div className="px-6">
          <input autoFocus data-testid="global-search-input" role="combobox" aria-expanded={flat.length > 0} aria-controls="search-results" aria-autocomplete="list"
            aria-activedescendant={flat.length ? `sr-${cur}` : undefined} aria-label="Команда, календарь, сотрудник или система"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            placeholder="Команда, календарь, сотрудник, @telegram или система" value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} spellCheck={false} autoComplete="off" />
        </div>
        <div id="search-results" role="listbox" aria-label="Результаты поиска" className="mt-3 max-h-[60vh] overflow-y-auto px-3 scroll-thin">
          {q.trim() && flat.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Ничего не нашлось. Попробуйте фамилию, @telegram, название системы или подразделения.</p>}
          {!q.trim() && flat.length === 0 && <p className="px-3 py-6 text-sm text-muted">Начните вводить: «Way4», «Kafka», фамилию или @telegram.</p>}
          {groups.map((g, gi) => (
            <div key={g.kind + gi} role="group" aria-labelledby={`sg-${gi}`} className="pb-2">
              <div id={`sg-${gi}`} role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">
                {'label' in g ? (g as { label: string }).label : KIND_LABEL[g.kind]}{g.more > 0 && <span className="normal-case"> · ещё {g.more}, уточните запрос</span>}
              </div>
              {rows[gi].map((r) => {
                i++
                const n = i
                const it = r.hit.item
                const sel = n === cur
                return (
                  <div key={it.kind + it.id} role="presentation" className={`flex items-center gap-2 rounded-lg pr-2 ${sel ? 'bg-surface-2' : ''}`} onMouseEnter={() => setActive(n)}>
                    <div id={`sr-${n}`} role="option" aria-selected={sel} data-testid="search-option" onMouseDown={(e) => e.preventDefault()} onClick={() => open(r)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
                      {it.kind === 'person' ? <Avatar p={r.contact} size={28} /> : <KindIcon kind={it.kind} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{it.title}</span>
                        <span className="block truncate text-xs text-muted">{it.kind === 'person' && r.contact ? `${r.contact.title} · ${r.contact.orgUnit} · ${r.contact.telegram}` : it.sub}</span>
                        <span className="block truncate text-xs" data-testid="search-duty">
                          {it.kind === 'person'
                            ? (r.dutyIn!.length ? <span className="text-ok">Дежурит сейчас: {r.dutyIn!.slice(0, 3).map((c) => c.name).join(', ')}{r.dutyIn!.length > 3 ? ` и ещё ${r.dutyIn!.length - 3}` : ''}</span> : <span className="text-faint">сейчас не на смене</span>)
                            : it.calendarIds.length === 0 ? <span className="text-faint">без календаря</span>
                            : r.onDuty.length ? <span className="text-ink">Дежурит: {r.onDuty[0].p.name}{r.onDuty.length > 1 ? <span className="text-muted"> +{r.onDuty.length - 1}</span> : ''} <span className="text-muted">· {r.onDuty[0].p.phone}</span></span>
                            : <span className="text-danger">никто не дежурит</span>}
                        </span>
                      </span>
                    </div>
                    {r.contact && <ContactActions p={r.contact} />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-6 pt-3 text-xs text-faint">
          <span>↑↓ выбор</span><span>Enter — открыть</span><span>Shift+Enter — скопировать номер дежурного</span><span>Esc — закрыть</span>
        </div>
      </div>
    </Modal>
  )
}

function KindIcon({ kind }: { kind: SearchItem['kind'] }) {
  const d = kind === 'team'
    ? 'M8 20v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1 M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'
    : kind === 'product' ? 'M4 7h16v10H4z M8 21h8 M12 17v4' : 'M5 5h14v14H5z M5 10h14'
  return (
    <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
      <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </span>
  )
}
