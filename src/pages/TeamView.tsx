import { managerOf } from '../engine'
import { useStore } from '../store'
import { TeamTimeline } from '../TeamTimeline'
import { Empty } from '../ui'

export function TeamView({ name }: { name: string }) {
  const { state } = useStore()
  const people = state.people
  const known = people.some((p) => p.team === name) || state.calendars.some((c) => c.team === name)
  if (!name || !known) {
    return <Empty title="Команда не найдена" text="Вернитесь к списку календарей и откройте команду оттуда." action={<a className="text-sm text-accent" href="#/calendars">К календарям</a>} />
  }
  const cals = state.calendars.filter((c) => c.team === name)
  const leads = [...new Set(cals.map((c) => c.leadId))].map((id) => people.find((p) => p.id === id)).filter((p) => !!p)
  const managers = [...new Map(leads.map((l) => managerOf(people, l.id)).filter((p) => !!p).map((p) => [p.id, p])).values()]
  const members = people.filter((p) => p.team === name).length

  return (
    <div className="space-y-8">
      <header>
        <a href="#/calendars" className="text-sm text-muted hover:text-ink">Календари</a>
        <h1 className="mt-3 text-2xl font-semibold">{name}</h1>
        <div className="mt-3 space-y-1 text-sm text-muted">
          <p>Лид · <span className="text-ink">{leads.length ? leads.map((p) => p.name).join(', ') : '—'}</span></p>
          <p>Руководитель · <span className="text-ink">{managers.length ? managers.map((p) => p.name).join(', ') : '—'}</span></p>
        </div>
        <p className="mt-3 text-sm text-faint">{members} в составе · {cals.length ? cals.map((c) => c.name).join(', ') : 'без календаря'}</p>
      </header>
      {members === 0 ? (
        <Empty title="В команде пока никого нет" text="Состав подтягивается из справочника сотрудников." />
      ) : (
        <TeamTimeline team={name} />
      )}
    </div>
  )
}
