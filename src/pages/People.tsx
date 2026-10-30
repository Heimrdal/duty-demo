import { useEffect, useMemo, useState } from 'react'
import { onCallIndex } from '../cache'
import { managerOf } from '../engine'
import { Group, useOpenGroups } from '../Groups'
import { norm } from '../search'
import { peopleById, useNow, useStore } from '../store'
import type { Person } from '../types'
import { Avatar, ContactActions, inputCls, teamHref } from '../ui'

const GROUP_ROWS = 50

export function People({ focus }: { focus?: string }) {
  const { state } = useStore()
  const now = useNow()
  const [q, setQ] = useState('')
  const byId = peopleById(state.people)
  const me = byId.get(state.currentUserId ?? '')
  const focused = focus ? byId.get(focus) : undefined
  const idx = onCallIndex(state.calendars, now)
  const small = state.people.length <= 40

  const groups = useMemo(() => {
    const m = new Map<string, Person[]>()
    for (const p of state.people) m.set(p.orgUnit, [...(m.get(p.orgUnit) ?? []), p])
    return [...m.entries()].sort((a, b) => (a[0] === me?.orgUnit ? -1 : b[0] === me?.orgUnit ? 1 : a[0].localeCompare(b[0], 'ru')))
  }, [state.people, me?.orgUnit])
  const hay = useMemo(() => new Map(state.people.map((p) => [p.id, ' ' + norm([p.name, p.title, p.telegram, p.phone, p.orgUnit, ...p.teams].join(' '))])), [state.people])
  const toks = norm(q).split(' ').filter(Boolean)
  const shown = toks.length ? groups.map(([org, list]) => [org, list.filter((p) => toks.every((t) => hay.get(p.id)!.includes(t)))] as const).filter(([, l]) => l.length) : groups
  const found = shown.reduce((n, [, l]) => n + l.length, 0)

  const g = useOpenGroups(small ? groups.map(([o]) => o) : [focused?.orgUnit ?? me?.orgUnit ?? ''])
  const [more, setMore] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!focused) return
    requestAnimationFrame(() => document.getElementById(`person-${focused.id}`)?.scrollIntoView({ block: 'center' }))
  }, [focused])
  const searching = toks.length > 0

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <p className="mt-1 text-sm text-muted">Состав и оргструктура приходят из LDAP. Руководитель — запасной уровень эскалации.</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Поиск сотрудников" data-testid="people-search" className={`${inputCls} max-w-sm`} placeholder="Имя, @telegram, должность, команда" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted" data-testid="people-count">{searching ? `Найдено ${found} из ${state.people.length}` : `${state.people.length} сотрудников · ${groups.length} подразделений`}</span>
        {!searching && !small && (
          <span className="ml-auto flex gap-3 text-sm">
            <button type="button" className="text-muted hover:text-ink" onClick={() => g.setAll(groups.map(([o]) => o))}>Развернуть все</button>
            <button type="button" className="text-muted hover:text-ink" onClick={() => g.setAll([])}>Свернуть</button>
          </span>
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">Никого не нашли. Попробуйте фамилию или @telegram.</p>}
      <div className="border-t border-line">
        {shown.map(([org, list]) => {
          const onDuty = list.filter((p) => idx.byPerson.has(p.id)).length
          const open = searching || g.isOpen(org)
          const all = more.has(org) || searching
          return (
            <Group key={org} id={norm(org).replace(/ /g, '-')} title={org} count={list.length} extra={onDuty ? <span className="text-ok">{onDuty} на смене</span> : undefined} open={open} onToggle={() => g.toggle(org)}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-faint"><tr><th className="py-2 pr-3 font-medium">Сотрудник</th><th className="pr-3 font-medium">Команды дежурств</th><th className="pr-3 font-medium">Руководитель</th><th className="pr-3 font-medium">Телефон</th><th className="font-medium">Сейчас</th></tr></thead>
                  <tbody>
                    {(all ? list.slice(0, 300) : list.slice(0, GROUP_ROWS)).map((p) => {
                      const on = idx.byPerson.get(p.id) ?? []
                      return (
                        <tr key={p.id} id={`person-${p.id}`} className={`border-t border-line ${p.id === focused?.id ? 'bg-accent-soft' : ''}`} data-testid="person-row">
                          <td className="py-2.5 pr-3"><div className="flex items-center gap-2.5"><Avatar p={p} size={28} /><div className="min-w-0"><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.title} · {p.telegram}</div></div></div></td>
                          <td className="pr-3">{p.teams.map((t, i) => <span key={t}>{i > 0 && ', '}<a className="hover:text-accent" href={teamHref(t)}>{t}</a></span>)}</td>
                          <td className="pr-3 text-muted">{managerOf(state.people, p.id)?.name ?? '—'}</td>
                          <td className="pr-3 whitespace-nowrap text-muted">{p.phone} <ContactActions p={p} /></td>
                          <td>{on.map((c) => <a key={c.id} href={`#/calendars/${c.id}`} className="mr-3 text-ok">{c.name}</a>)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {!all && list.length > GROUP_ROWS && <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={() => setMore((s) => new Set(s).add(org))}>Показать всех {list.length}</button>}
            </Group>
          )
        })}
      </div>
    </div>
  )
}
