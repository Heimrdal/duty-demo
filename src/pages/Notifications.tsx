import { useMemo, useState } from 'react'
import { calendarOnCall, DAY, fmtDT, HOUR, sampleSegments } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, Btn, Card, Field, inputCls } from '../ui'
import type { NotifySettings, TgKind } from '../types'

const KIND_LABEL: Record<TgKind, string> = { shift_start: 'Начало смены', reminder: 'Напоминание', handover: 'Передача смены', escalation: 'Эскалация', test: 'Тест', signup: 'Запись на дежурство' }

export function Notifications() {
  const { state, update, sendTg, toast } = useStore()
  const now = useNow()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const [who, setWho] = useState<string>(me.id)
  const ns = state.notify[me.id]
  const setNs = (patch: Partial<NotifySettings>) => update((s) => ({ ...s, notify: { ...s.notify, [me.id]: { ...s.notify[me.id], ...patch } } }))
  const msgs = state.messages.filter((m) => who === 'all' || m.toPersonId === who).slice().sort((a, b) => +new Date(a.ts) - +new Date(b.ts))
  const byId = (id: string) => state.people.find((p) => p.id === id)

  const planned = useMemo(() => state.calendars.flatMap((c) =>
    sampleSegments(Math.floor(now / HOUR) * HOUR, now + 3 * DAY, (t) => (calendarOnCall(c, t).some((e) => e.personId === me.id) ? me.id : null), HOUR)
      .filter((s) => s.start > now).map((s) => ({ c, s }))), [state.calendars, me.id, Math.floor(now / 600000)]) // eslint-disable-line

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">Уведомления в Telegram <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">МОК</span></h1>
        <p className="text-sm text-slate-500">Бот <b>@bank_oncall_bot</b> присылает дежурным начало смены, напоминания, передачу смены и эскалации. В демо сообщения никуда не отправляются — они пишутся в журнал ниже.</p></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="space-y-4 p-4 lg:col-span-2">
          <h3 className="font-semibold">Мои настройки</h3>
          <Field label="Telegram"><input className={inputCls} value={ns.telegram} onChange={(e) => setNs({ telegram: e.target.value })} /></Field>
          <div className="rounded-lg bg-sky-50 p-3 text-sm">
            {ns.chatLinked ? <>✅ Чат с ботом привязан. <button className="text-sky-700 underline" onClick={() => setNs({ chatLinked: false })}>Отвязать</button></> :
              <>Откройте <b>@bank_oncall_bot</b> и отправьте <code className="rounded bg-white px-1">/start {me.id.slice(-4)}-7731</code>. <Btn variant="soft" className="ml-1" onClick={() => { setNs({ chatLinked: true }); toast('Чат привязан (демо)') }}>Я отправил</Btn></>}
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onShiftStart} onChange={(e) => setNs({ onShiftStart: e.target.checked })} /> Начало моей смены</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onHandover} onChange={(e) => setNs({ onHandover: e.target.checked })} /> Передача смены / подмены</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.onEscalation} onChange={(e) => setNs({ onEscalation: e.target.checked })} /> Эскалации (рекомендуем не отключать)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ns.quietHours} onChange={(e) => setNs({ quietHours: e.target.checked })} /> Тихий режим вне смены (кроме эскалаций)</label>
            <div className="flex items-center gap-2">Напоминать до смены:
              <select className={`${inputCls} w-36`} value={ns.beforeShift} onChange={(e) => setNs({ beforeShift: e.target.value as NotifySettings['beforeShift'] })}><option value="off">не напоминать</option><option value="1h">за 1 час</option><option value="1d">за сутки</option></select>
            </div>
          </div>
          <Btn onClick={() => { sendTg({ toPersonId: me.id, kind: 'test', text: `🔔 Тестовое уведомление\nПривет, ${me.name.split(' ')[0]}! Уведомления о дежурствах будут приходить сюда.` }); setWho(me.id); toast(`Тест отправлен в ${ns.telegram} (демо)`) }}>✈️ Отправить тест</Btn>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Запланировано на 3 дня</h4>
            {planned.length === 0 ? <div className="text-xs text-slate-500">У вас нет смен в ближайшие 3 дня.</div> : planned.map(({ c, s }, i) => (
              <div key={i} className="text-xs text-slate-600">⏰ {fmtDT(s.start - HOUR)} — напоминание «{c.name}» · 🟢 {fmtDT(s.start)} — начало · 🔁 {fmtDT(s.end)} — передача</div>
            ))}
          </div>
        </Card>
        <Card className="overflow-hidden lg:col-span-3">
          <div className="flex items-center gap-3 bg-[#517da2] px-4 py-2 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg">📟</span>
            <div className="flex-1"><div className="font-semibold">Дежурства банка · бот</div><div className="text-xs text-white/70">журнал отправок (демо)</div></div>
            <select className="rounded bg-white/15 px-2 py-1 text-sm text-white" value={who} onChange={(e) => setWho(e.target.value)}>
              <option className="text-black" value="all">Все получатели</option>
              {state.people.map((p) => <option className="text-black" key={p.id} value={p.id}>{p.name}{p.id === me.id ? ' (вы)' : ''}</option>)}
            </select>
          </div>
          <div className="h-[560px] space-y-2 overflow-y-auto bg-[#e6ebee] p-4 scroll-thin" style={{ backgroundImage: 'radial-gradient(#d5dde3 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            {msgs.length === 0 && <div className="mt-20 text-center text-sm text-slate-500">Сообщений пока нет</div>}
            {msgs.map((m) => {
              const p = byId(m.toPersonId)
              return (
                <div key={m.id} className="max-w-[85%]">
                  {who === 'all' && <div className="mb-0.5 flex items-center gap-1 text-xs text-slate-500"><Avatar p={p} size={16} />→ {p?.name} {p?.telegram}</div>}
                  <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm whitespace-pre-line shadow-sm">
                    <div className="mb-0.5 text-xs font-semibold text-[#517da2]">{KIND_LABEL[m.kind]}</div>
                    {m.text}
                    <div className="mt-1 text-right text-[10px] text-slate-400">{fmtDT(m.ts)} ✓✓</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
