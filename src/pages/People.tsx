import { calendarOnCall, managerOf } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, teamHref } from '../ui'

export function People() {
  const { state } = useStore()
  const now = useNow()
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <p className="mt-1 text-sm text-muted">Руководитель — запасной уровень эскалации. В проде состав приходит из каталога.</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-faint"><tr><th className="py-2 pr-3 font-medium">Сотрудник</th><th className="pr-3 font-medium">Команда</th><th className="pr-3 font-medium">Руководитель</th><th className="pr-3 font-medium">Телефон</th><th className="font-medium">Сейчас</th></tr></thead>
          <tbody>
            {state.people.map((p) => {
              const on = state.calendars.filter((c) => calendarOnCall(c, now).some((e) => e.personId === p.id))
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-3 pr-3"><div className="flex items-center gap-2.5"><Avatar p={p} size={28} /><div><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.title}</div></div></div></td>
                  <td className="pr-3"><a className="hover:text-accent" href={teamHref(p.team)}>{p.team}</a></td>
                  <td className="pr-3 text-muted">{managerOf(state.people, p.id)?.name ?? '—'}</td>
                  <td className="pr-3 text-muted">{p.phone}</td>
                  <td>{on.map((c) => <a key={c.id} href={`#/calendars/${c.id}`} className="mr-3 text-ok">{c.name}</a>)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
