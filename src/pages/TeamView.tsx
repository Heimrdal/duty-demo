import { useMemo, useState } from 'react'
import { onCallIndex } from '../cache'
import { managerOf } from '../engine'
import { Group, useOpenGroups } from '../Groups'
import { calendarOrgUnit, norm } from '../search'
import { peopleById, useNow, useStore } from '../store'
import { TeamTimeline } from '../TeamTimeline'
import type { Calendar, Person } from '../types'
import { Empty, inputCls, teamHref } from '../ui'

interface TeamInfo { name: string; org: string; members: number; cals: Calendar[] }

/** Список команд: поиск и группировка по подразделению (оргструктура из LDAP). */
function TeamList() {
  const { state } = useStore()
  const now = useNow()
  const [q, setQ] = useState('')
  const byId = peopleById(state.people)
  const me = byId.get(state.currentUserId ?? '')
  const idx = onCallIndex(state.calendars, now)
  const teams = useMemo(() => {
    const members = new Map<string, Person[]>()
    for (const p of state.people) for (const t of p.teams) members.set(t, [...(members.get(t) ?? []), p])
    const cals = new Map<string, Calendar[]>()
    for (const c of state.calendars) cals.set(c.team, [...(cals.get(c.team) ?? []), c])
    const names = [...new Set([...members.keys(), ...cals.keys()])].sort((a, b) => a.localeCompare(b, 'ru'))
    return names.map((name): TeamInfo => {
      const cs = cals.get(name) ?? []
      const ms = members.get(name) ?? []
      let org = cs.map((c) => calendarOrgUnit(c, byId)).find(Boolean)
      if (!org) {
        const cnt = new Map<string, number>()
        for (const p of ms) cnt.set(p.orgUnit, (cnt.get(p.orgUnit) ?? 0) + 1)
        org = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      }
      return { name, org: org || 'Без подразделения', members: ms.length, cals: cs }
    })
  }, [state.people, state.calendars, byId])
  const groups = useMemo(() => {
    const m = new Map<string, TeamInfo[]>()
    for (const t of teams) m.set(t.org, [...(m.get(t.org) ?? []), t])
    return [...m.entries()].sort((a, b) => (a[0] === me?.orgUnit ? -1 : b[0] === me?.orgUnit ? 1 : a[0].localeCompare(b[0], 'ru')))
  }, [teams, me?.orgUnit])
  const small = teams.length <= 12
  const g = useOpenGroups(small ? groups.map(([o]) => o) : [...new Set([me?.orgUnit ?? '', ...teams.filter((t) => me?.teams.includes(t.name)).map((t) => t.org)])])
  const toks = norm(q).split(' ').filter(Boolean)
  const match = (t: TeamInfo) => { const h = ' ' + norm([t.name, t.org, ...t.cals.map((c) => c.name)].join(' ')); return toks.every((x) => h.includes(x)) }
  const shown = toks.length ? groups.map(([o, l]) => [o, l.filter(match)] as const).filter(([, l]) => l.length) : groups
  const found = shown.reduce((n, [, l]) => n + l.length, 0)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Дежурства команд</h1>
        <p className="mt-1 text-sm text-muted">Выберите команду: кто когда дежурит, смены и дыры в покрытии.</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Поиск команд" data-testid="teams-search" className={`${inputCls} max-w-sm`} placeholder="Команда, календарь или подразделение" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted" data-testid="teams-count">{toks.length ? `Найдено ${found} из ${teams.length}` : `${teams.length} команд · ${groups.length} подразделений`}</span>
        {!toks.length && !small && (
          <span className="ml-auto flex gap-3 text-sm">
            <button type="button" className="text-muted hover:text-ink" onClick={() => g.setAll(groups.map(([o]) => o))}>Развернуть все</button>
            <button type="button" className="text-muted hover:text-ink" onClick={() => g.setAll([])}>Свернуть</button>
          </span>
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">Команд не нашли.</p>}
      <div className="border-t border-line">
        {shown.map(([org, list]) => {
          const gaps = list.filter((t) => t.cals.some((c) => !idx.byCalendar.get(c.id)?.length)).length
          return (
            <Group key={org} id={'t-' + norm(org).replace(/ /g, '-')} title={org} count={list.length} open={!!toks.length || g.isOpen(org)} onToggle={() => g.toggle(org)}
              extra={gaps ? <span className="text-danger">{gaps} без покрытия</span> : undefined}>
              <div className="divide-y divide-line">
                {list.map((t) => {
                  const on = t.cals.flatMap((c) => idx.byCalendar.get(c.id) ?? [])
                  const first = on[0] ? byId.get(on[0].personId) : undefined
                  return (
                    <a key={t.name} href={teamHref(t.name)} className="flex items-baseline justify-between gap-4 py-3 pl-7" data-testid="team-row">
                      <span className="min-w-0">
                        <span className="font-medium">{t.name}</span>
                        <span className="mt-0.5 block text-sm text-muted">{t.members} в составе · {t.cals.length ? t.cals.map((c) => c.name).join(', ') : 'без календаря'}</span>
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        {t.cals.length > 0 && (first ? <span className="text-muted">Сейчас: <span className="text-ink">{first.name}</span>{on.length > 1 ? ` +${on.length - 1}` : ''}</span> : <span className="text-danger">никто не дежурит</span>)}
                        <span className="ml-4 text-accent">Дежурства команды</span>
                      </span>
                    </a>
                  )
                })}
              </div>
            </Group>
          )
        })}
      </div>
    </div>
  )
}

export function TeamView({ name }: { name: string }) {
  const { state } = useStore()
  if (!name) return <TeamList />
  const people = state.people
  const known = people.some((p) => p.teams.includes(name)) || state.calendars.some((c) => c.team === name)
  if (!known) {
    return <Empty title="Команда не найдена" text="Откройте «Дежурства команд» и выберите команду." action={<a className="text-sm text-accent" href="#/teams">К дежурствам команд</a>} />
  }
  const cals = state.calendars.filter((c) => c.team === name)
  const leads = [...new Set(cals.map((c) => c.leadId))].map((id) => people.find((p) => p.id === id)).filter((p) => !!p)
  const managers = [...new Map(leads.map((l) => managerOf(people, l.id)).filter((p) => !!p).map((p) => [p.id, p])).values()]
  const members = people.filter((p) => p.teams.includes(name)).length

  return (
    <div className="space-y-8">
      <header>
        <a href="#/teams" className="text-sm text-muted hover:text-ink">Дежурства команд</a>
        <h1 className="mt-3 text-2xl font-semibold" data-testid="team-title">Дежурства команды «{name}»</h1>
        <div className="mt-3 space-y-1 text-sm text-muted">
          <p>Лид календаря · <span className="text-ink">{leads.length ? leads.map((p) => p.name).join(', ') : '—'}</span></p>
          <p>Руководитель лида · <span className="text-ink">{managers.length ? managers.map((p) => p.name).join(', ') : '—'}</span></p>
        </div>
        <p className="mt-2 text-sm text-faint">В эскалации уровень «руководитель» — это руководитель того, кто сейчас дежурит.</p>
        <p className="mt-3 text-sm text-faint">{members} в составе · {cals.length ? cals.map((c) => c.name).join(', ') : 'без календаря'}</p>
      </header>
      {members === 0 && cals.length === 0 ? (
        <Empty title="В команде пока никого нет" text="Состав подтягивается из справочника сотрудников." />
      ) : (
        <TeamTimeline team={name} />
      )}
    </div>
  )
}
