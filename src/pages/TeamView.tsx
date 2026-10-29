import { managerOf } from '../engine'
import { useStore } from '../store'
import { TeamTimeline } from '../TeamTimeline'
import { Empty, teamHref } from '../ui'

function TeamList() {
  const { state } = useStore()
  const names = [...new Set([...state.people.map((p) => p.team), ...state.calendars.map((c) => c.team)])].sort((a, b) => a.localeCompare(b, 'ru'))
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Команды</h1>
        <p className="mt-1 text-sm text-muted">Таймлайн людей, смен и покрытия.</p>
      </header>
      <div className="divide-y divide-line">
        {names.map((t) => {
          const members = state.people.filter((p) => p.team === t).length
          const cals = state.calendars.filter((c) => c.team === t)
          return (
            <a key={t} href={teamHref(t)} className="flex items-baseline justify-between gap-4 py-4">
              <span>
                <span className="font-medium">{t}</span>
                <span className="mt-0.5 block text-sm text-muted">{members} в составе · {cals.length ? cals.map((c) => c.name).join(', ') : 'без календаря'}</span>
              </span>
              <span className="text-sm text-accent">Таймлайн</span>
            </a>
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
  const known = people.some((p) => p.team === name) || state.calendars.some((c) => c.team === name)
  if (!known) {
    return <Empty title="Команда не найдена" text="Откройте список команд и выберите таймлайн." action={<a className="text-sm text-accent" href="#/teams">К командам</a>} />
  }
  const cals = state.calendars.filter((c) => c.team === name)
  const leads = [...new Set(cals.map((c) => c.leadId))].map((id) => people.find((p) => p.id === id)).filter((p) => !!p)
  const managers = [...new Map(leads.map((l) => managerOf(people, l.id)).filter((p) => !!p).map((p) => [p.id, p])).values()]
  const members = people.filter((p) => p.team === name).length

  return (
    <div className="space-y-8">
      <header>
        <a href="#/teams" className="text-sm text-muted hover:text-ink">Команды</a>
        <h1 className="mt-3 text-2xl font-semibold">{name}</h1>
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
