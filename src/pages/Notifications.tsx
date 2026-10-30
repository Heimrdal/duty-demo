import { useMemo, useState } from 'react'
import { calendarOnCall, DAY, fmtDT, HOUR, sampleSegments } from '../engine'
import { tzLabel } from '../tz'
import { useNow, useStore } from '../store'
import { Btn, Field, inputCls } from '../ui'
import type { NotifySettings, TgKind } from '../types'

const KIND_LABEL: Record<TgKind, string> = { shift_start: 'Начало смены', reminder: 'Напоминание', handover: 'Передача смены', escalation: 'Эскалация', test: 'Тест', signup: 'Запись на дежурство' }

export function Notifications({ incident }: { incident?: string }) {
  const { state, update, sendTg, toast } = useStore()
  const now = useNow()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const [who, setWho] = useState<string>(incident ? 'all' : me.id)
  const [inc, setInc] = useState<string | undefined>(incident)
  const ns = state.notify[me.id]
  const setNs = (patch: Partial<NotifySettings>) => update((s) => ({ ...s, notify: { ...s.notify, [me.id]: { ...s.notify[me.id], ...patch } } }))
  const pool = inc ? state.messages.filter((m) => m.incidentId === inc) : state.messages
  const msgs = pool.filter((m) => who === 'all' || m.toPersonId === who).slice().sort((a, b) => +new Date(a.ts) - +new Date(b.ts))
  const byId = (id: string) => state.people.find((p) => p.id === id)

  const planned = useMemo(() => state.calendars.flatMap((c) =>
    sampleSegments(Math.floor(now / HOUR) * HOUR, now + 3 * DAY, (t) => (calendarOnCall(c, t).some((e) => e.personId === me.id) ? me.id : null), HOUR)
      .filter((s) => s.start > now).map((s) => ({ c, s }))), [state.calendars, me.id, Math.floor(now / 600000)]) // eslint-disable-line

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Уведомления</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">Бот @bank_oncall_bot — имитация. Сообщения не уходят наружу, они остаются в журнале.</p>
      </header>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <Field label="Telegram"><input className={inputCls} value={ns.telegram} onChange={(e) => setNs({ telegram: e.target.value })} /></Field>
          <p className="text-sm text-muted">
            {ns.chatLinked
              ? <>Чат привязан. <button className="text-ink underline decoration-line underline-offset-2" onClick={() => setNs({ chatLinked: false })}>Отвязать</button></>
              : <>Отправьте боту <span className="text-ink">/start {me.id.slice(-4)}-7731</span>. <button className="text-ink underline decoration-line underline-offset-2" onClick={() => { setNs({ chatLinked: true }); toast('Чат привязан (демо)') }}>Готово</button></>}
          </p>
          <div className="space-y-2.5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onShiftStart} onChange={(e) => setNs({ onShiftStart: e.target.checked })} /> Начало смены</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onHandover} onChange={(e) => setNs({ onHandover: e.target.checked })} /> Передача и подмена</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onEscalation} onChange={(e) => setNs({ onEscalation: e.target.checked })} /> Эскалации</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.quietHours} onChange={(e) => setNs({ quietHours: e.target.checked })} /> Тихий режим вне смены</label>
            <div className="flex items-center gap-2 text-muted">Напоминать
              <select aria-label="Напоминать о смене" className={`${inputCls} w-36`} value={ns.beforeShift} onChange={(e) => setNs({ beforeShift: e.target.value as NotifySettings['beforeShift'] })}><option value="off">не нужно</option><option value="1h">за час</option><option value="1d">за сутки</option></select>
            </div>
          </div>
          <Btn onClick={() => { sendTg({ toPersonId: me.id, kind: 'test', text: `🔔 Тестовое уведомление\nПривет, ${me.name.split(' ')[0]}! Уведомления о дежурствах будут приходить сюда.` }); setWho(me.id); toast(`Тест отправлен в ${ns.telegram} (демо)`) }}>Отправить тест</Btn>
          <div>
            <h4 className="mb-1 text-sm font-medium">Ближайшие три дня</h4>
            {planned.length === 0 ? <p className="text-sm text-muted">Смен нет.</p> : planned.map(({ c, s }, i) => (
              <p key={i} className="text-sm text-muted">{fmtDT(s.start, c.timezone)} {tzLabel(c.timezone)} — {c.name}</p>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface lg:col-span-3">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="flex-1"><div className="text-sm font-medium">Журнал Telegram</div><div className="text-xs text-faint">только на этом стенде</div></div>
            {inc && (
              <span data-testid="incident-filter" className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-ink">
                {inc}
                <button type="button" aria-label={`Сбросить фильтр по инциденту ${inc}`} title="Сбросить фильтр" className="text-muted hover:text-ink" onClick={() => { setInc(undefined); if (location.hash !== '#/notifications') history.replaceState(null, '', '#/notifications') }}>×</button>
              </span>
            )}
            <select aria-label="Чьи сообщения показать" className={`${inputCls} w-56`} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Все</option>
              {state.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me.id ? ' (вы)' : ''}</option>)}
            </select>
          </div>
          <div className="h-[520px] space-y-3 overflow-y-auto bg-surface-2 p-4 scroll-thin">
            {msgs.length === 0 && (
              <div data-testid="empty-log" className="pt-16 text-center text-sm text-muted">
                {who !== 'all' && pool.length > 0 ? (
                  <>
                    <p>{who === me.id ? 'Вам' : `${byId(who)?.name ?? 'Сотруднику'}:`} сообщений нет; всего в журнале {pool.length}</p>
                    <button type="button" className="mt-2 font-medium text-accent hover:underline" onClick={() => setWho('all')}>Показать все</button>
                  </>
                ) : <p>{inc ? `По инциденту ${inc} сообщений нет` : 'Сообщений пока нет'}</p>}
              </div>
            )}
            {msgs.map((m) => {
              const p = byId(m.toPersonId)
              return (
                <div key={m.id} className="max-w-[88%]">
                  {who === 'all' && <div className="mb-1 text-xs text-faint">→ {p?.name} {p?.telegram}</div>}
                  <div className="rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2 text-sm whitespace-pre-line">
                    <div className="mb-1 text-xs font-medium text-accent">{KIND_LABEL[m.kind]}</div>
                    {m.text}
                    <div className="mt-1 text-right text-[10px] text-faint">{fmtDT(m.ts)} МСК</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
