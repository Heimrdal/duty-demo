import { calendarOnCall, managerOf } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, Card } from '../ui'

export function People() {
  const { state } = useStore()
  const now = useNow()
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold">Сотрудники</h1><p className="text-sm text-slate-500">Оргструктура (в проде — из AD/HR через SSO). Руководитель используется как запасной уровень эскалации.</p></div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Сотрудник</th><th>Команда</th><th>Руководитель</th><th>Телефон</th><th>Telegram</th><th>Сейчас дежурит</th></tr></thead>
          <tbody>
            {state.people.map((p) => {
              const on = state.calendars.filter((c) => calendarOnCall(c, now).some((e) => e.personId === p.id))
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="flex items-center gap-2 p-2"><Avatar p={p} size={28} /><div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.title}</div></div></td>
                  <td>{p.team}</td><td>{managerOf(state.people, p.id)?.name ?? '—'}</td><td>{p.phone}</td><td className="text-sky-600">{p.telegram}</td>
                  <td>{on.map((c) => <a key={c.id} href={`#/calendars/${c.id}`} className="mr-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{c.name}</a>)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
