import { useMemo, useState } from 'react'
import { calendarOnCall, DAY, fmtDT, fmtDur, HOUR, nextHandoff, sampleSegments } from '../engine'
import { TakeDutyModal } from '../forms'
import { useNow, useStore } from '../store'
import { Avatar, Card, EscalationChain, TYPE_META } from '../ui'
import type { CalendarType } from '../types'

export function Dashboard() {
  const { state } = useStore()
  const now = useNow()
  const [filter, setFilter] = useState<CalendarType | 'all'>('all')
  const [take, setTake] = useState<string | null>(null)
  const [openChain, setOpenChain] = useState<string | null>(null)
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const byId = (id: string) => state.people.find((p) => p.id === id)

  const rows = state.calendars.filter((c) => filter === 'all' || c.type === filter).map((c) => ({ c, entries: calendarOnCall(c, now) }))
  const totalOnCall = new Set(state.calendars.flatMap((c) => calendarOnCall(c, now).map((e) => e.personId))).size
  const gaps = state.calendars.filter((c) => calendarOnCall(c, now).length === 0)

  const mine = useMemo(() => state.calendars.flatMap((c) =>
    sampleSegments(Math.floor((now - DAY) / HOUR) * HOUR, now + 21 * DAY, (t) => (calendarOnCall(c, t).some((e) => e.personId === me.id) ? me.id : null), HOUR)
      .filter((s) => s.end > now).map((s) => ({ ...s, c }))).sort((a, b) => a.start - b.start).slice(0, 6), [state.calendars, me.id, Math.floor(now / 600000)]) // eslint-disable-line

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Кто дежурит сейчас</h1>
        <p className="mt-1 text-sm text-muted">{new Date(now).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} МСК</p>
      </header>

      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat k="Календари" v={String(state.calendars.length)} />
        <Stat k="Сейчас на смене" v={String(totalOnCall)} />
        <Stat k="Без покрытия" v={String(gaps.length)} danger={gaps.length > 0} hint={gaps.map((g) => g.name).join(', ')} />
        <Stat k="Моя смена" v={mine[0] ? (mine[0].start <= now ? 'Сейчас' : fmtDT(mine[0].start)) : 'Нет'} hint={mine[0]?.c.name} />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(['all', 'sitcenter', 'monitoring', 'product', 'infra'] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={filter === t ? 'font-medium text-ink' : 'text-muted hover:text-ink'}>
            {t === 'all' ? 'Все' : TYPE_META[t].label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map(({ c, entries }) => {
          const lead = byId(c.leadId)
          const handoffs = c.layers.map((l) => nextHandoff(l, now))
          const nextH = handoffs.length ? Math.min(...handoffs) : null
          return (
            <Card key={c.id} className="flex flex-col">
              <div className="flex items-start gap-3 px-5 pt-5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[c.type].color }} />
                <div className="min-w-0 flex-1">
                  <a href={`#/calendars/${c.id}`} className="text-base font-medium hover:text-accent">{c.name}</a>
                  <div className="mt-0.5 truncate text-sm text-muted">{c.product}</div>
                </div>
              </div>
              <div className="flex-1 space-y-3 px-5 py-4">
                {entries.length === 0 && <p className="text-sm text-danger">Сейчас никто не дежурит. Алерт уйдёт лиду.</p>}
                {entries.map((e) => {
                  const p = byId(e.personId)!
                  return (
                    <div key={e.personId} className="flex items-center gap-3">
                      <Avatar p={p} size={32} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{p.name}{p.id === me.id && <span className="font-normal text-muted"> · вы</span>}</div>
                        <div className="truncate text-xs text-muted">{e.layerName}{e.replaced && ` · вместо ${byId(e.replaced)?.name}`} · {p.phone}</div>
                      </div>
                    </div>
                  )
                })}
                <p className="text-xs text-faint">Лид {lead?.name}{nextH ? ` · передача ${fmtDT(nextH)}` : ''}</p>
                <button className="text-sm text-muted hover:text-ink" onClick={() => setOpenChain(openChain === c.id ? null : c.id)}>
                  {openChain === c.id ? 'Скрыть эскалацию' : 'Эскалация'}
                </button>
                {openChain === c.id && <EscalationChain c={c} people={state.people} t={now} compact />}
              </div>
              <div className="px-5 pb-4">
                <button className="text-sm text-muted hover:text-ink" onClick={() => setTake(c.id)}>Взять дежурство</button>
              </div>
            </Card>
          )
        })}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium">Мои дежурства</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">На ближайшие три недели пусто.</p>
        ) : (
          <div className="divide-y divide-line">
            {mine.map((s, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="w-44 font-medium">{s.c.name}</span>
                <span className="text-muted">{fmtDT(s.start)} — {fmtDT(s.end)}</span>
                <span className="text-faint">{fmtDur(s.end - s.start)}</span>
                {s.start <= now && <span className="text-ok">сейчас</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {take !== null && <TakeDutyModal calendarId={take || undefined} onClose={() => setTake(null)} />}
    </div>
  )
}

function Stat({ k, v, hint, danger }: { k: string; v: string; hint?: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${danger ? 'text-danger' : ''}`}>{v}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-faint">{hint}</div>}
    </div>
  )
}
