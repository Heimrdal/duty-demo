import { useMemo, useState } from 'react'
import { calendarOnCall, DAY, fmtDT, fmtDur, HOUR, managerOf, nextHandoff, sampleSegments } from '../engine'
import { TakeDutyModal } from '../forms'
import { useNow, useStore } from '../store'
import { Avatar, Btn, Card, EscalationChain, KindBadge, Legend, TYPE_META, TypeBadge } from '../ui'
import type { CalendarType } from '../types'

export function Dashboard() {
  const { state } = useStore()
  const now = useNow()
  const [filter, setFilter] = useState<CalendarType | 'all'>('all')
  const [take, setTake] = useState<string | null>(null)
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const byId = (id: string) => state.people.find((p) => p.id === id)

  const rows = state.calendars.filter((c) => filter === 'all' || c.type === filter).map((c) => ({ c, entries: calendarOnCall(c, now) }))
  const totalOnCall = new Set(state.calendars.flatMap((c) => calendarOnCall(c, now).map((e) => e.personId))).size
  const gaps = state.calendars.filter((c) => calendarOnCall(c, now).length === 0)

  const mine = useMemo(() => state.calendars.flatMap((c) =>
    sampleSegments(Math.floor((now - DAY) / HOUR) * HOUR, now + 21 * DAY, (t) => (calendarOnCall(c, t).some((e) => e.personId === me.id) ? me.id : null), HOUR)
      .filter((s) => s.end > now).map((s) => ({ ...s, c }))).sort((a, b) => a.start - b.start).slice(0, 6), [state.calendars, me.id, Math.floor(now / 600000)]) // eslint-disable-line

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Кто дежурит сейчас</h1>
          <p className="text-sm text-slate-500">{new Date(now).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} МСК · все календари банка</p>
        </div>
        <Btn onClick={() => setTake('')} className="px-4 py-2 text-base">✋ Взять дежурство</Btn>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-slate-500">Календарей</div><div className="text-3xl font-bold">{state.calendars.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Дежурят сейчас</div><div className="text-3xl font-bold text-emerald-600">{totalOnCall}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Дыры в покрытии</div><div className={`text-3xl font-bold ${gaps.length ? 'text-red-600' : 'text-slate-300'}`}>{gaps.length}</div>{gaps.length > 0 && <div className="truncate text-xs text-red-500">{gaps.map((g) => g.name).join(', ')}</div>}</Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Моё ближайшее дежурство</div>
          {mine[0] ? <div className="text-sm"><b>{mine[0].start <= now ? 'Сейчас!' : fmtDT(mine[0].start)}</b><div className="truncate text-xs text-slate-500">{mine[0].c.name}</div></div> : <div className="text-sm text-slate-400">нет в ближайшие 3 недели</div>}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'sitcenter', 'monitoring', 'product', 'infra'] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-sm ${filter === t ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>
            {t === 'all' ? 'Все' : `${TYPE_META[t].icon} ${TYPE_META[t].label}`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map(({ c, entries }) => {
          const lead = byId(c.leadId)
          const handoffs = c.layers.map((l) => nextHandoff(l, now))
          const nextH = handoffs.length ? Math.min(...handoffs) : null
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3" style={{ borderLeft: `5px solid ${TYPE_META[c.type].color}` }}>
                <div className="min-w-0">
                  <a href={`#/calendars/${c.id}`} className="text-lg font-semibold hover:text-blue-700">{c.name}</a>
                  <div className="truncate text-xs text-slate-500">{c.product}</div>
                </div>
                <TypeBadge t={c.type} />
              </div>
              <div className="space-y-2 px-4 py-3">
                {entries.length === 0 && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠️ Сейчас никто не дежурит — алерт уйдёт сразу лиду группы</div>}
                {entries.map((e) => {
                  const p = byId(e.personId)!
                  const mgr = managerOf(state.people, p.id)
                  return (
                    <div key={e.personId} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <Avatar p={p} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><b>{p.name}</b>{p.id === me.id && <span className="text-xs text-blue-600">(вы)</span>}<KindBadge k={e.kind} /></div>
                        <div className="text-xs text-slate-500">{e.layerName}{e.replaced && ` · подменяет ${byId(e.replaced)?.name}`} · рук.: {mgr?.name ?? '—'}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div>📞 {p.phone}</div>
                        <div className="text-sky-600">✈️ {p.telegram}</div>
                      </div>
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-600">
                  <span>👤 Лид группы: <b>{lead?.name}</b> {lead?.phone}</span>
                  {nextH && <span>🔁 Ближайшая передача: <b>{fmtDT(nextH)}</b> (через {fmtDur(nextH - now)})</span>}
                </div>
                <div className="border-t border-dashed border-slate-200 pt-2">
                  <div className="mb-1 text-xs font-medium text-slate-500">Цепочка эскалации, если не берут трубку:</div>
                  <EscalationChain c={c} people={state.people} t={now} compact />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2">
                <Btn variant="ghost" onClick={() => (location.hash = `#/calendars/${c.id}`)}>Открыть календарь</Btn>
                <Btn variant="soft" onClick={() => setTake(c.id)}>✋ Взять дежурство</Btn>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold">Мои дежурства (3 недели вперёд)</h2>
        {mine.length === 0 ? <div className="text-sm text-slate-500">Пока пусто. Нажмите «Взять дежурство» — это два клика.</div> : (
          <div className="space-y-1 text-sm">
            {mine.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-1 hover:bg-slate-50">
                <TypeBadge t={s.c.type} /><b className="w-44">{s.c.name}</b>
                <span>{fmtDT(s.start)} → {fmtDT(s.end)}</span><span className="text-slate-400">({fmtDur(s.end - s.start)})</span>
                {s.start <= now && <span className="rounded bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-700">идёт сейчас</span>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Legend />
      {take !== null && <TakeDutyModal calendarId={take || undefined} onClose={() => setTake(null)} />}
    </div>
  )
}
