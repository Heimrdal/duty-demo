import { useEffect, useRef, useState } from 'react'
import { fmtT } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, Btn, Card, EscalationChain, inputCls, resolveChain, TypeBadge } from '../ui'

interface Ev { t: number; text: string; level?: number; kind: 'page' | 'wait' | 'ack' | 'end' }

export function Escalation() {
  const { state, sendTg } = useStore()
  const now = useNow()
  const [calId, setCalId] = useState(state.calendars[0]?.id)
  const [title, setTitle] = useState('Недоступен /api/payments: 5xx > 20%')
  const [events, setEvents] = useState<Ev[]>([])
  const [running, setRunning] = useState(false)
  const timer = useRef<number | null>(null)
  const c = state.calendars.find((x) => x.id === calId)!
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setRunning(false) }
  useEffect(() => () => stop(), [])

  const run = () => {
    stop()
    const chain = resolveChain(c, state.people, Date.now())
    const inc = 'INC-' + Math.floor(48000 + Math.random() * 999)
    setEvents([{ t: 0, text: `Создан инцидент ${inc}: «${title}» → политика «${c.name}»`, kind: 'page' }])
    setRunning(true)
    let i = 0
    const total = chain.length * (c.repeat + 1)
    const tick = () => {
      if (i >= total) { setEvents((e) => [...e, { t: 0, text: 'Цепочка исчерпана — инцидент остался без подтверждения. Оповещение руководству СЦ.', kind: 'end' }]); setRunning(false); return }
      const lv = chain[i % chain.length]
      const round = Math.floor(i / chain.length) + 1
      setEvents((e) => [...e, { t: lv.delayMin, level: lv.level, kind: 'page', text: `${round > 1 ? `[повтор ${round}] ` : ''}Уровень ${lv.level} — ${lv.label}: ${lv.people.map((p) => p.name).join(', ') || 'никого'} (📞 звонок + ✈️ Telegram)` }])
      lv.people.forEach((p) => sendTg({ toPersonId: p.id, calendarId: c.id, kind: 'escalation', text: `🚨 ${inc} · уровень ${lv.level} (${lv.label})\nКалендарь: «${c.name}»\n${title}\n${lv.level > 1 ? 'Предыдущий уровень не подтвердил.\n' : ''}[✅ Принять] [⏫ Эскалировать] [🔕 Не могу]` }))
      i++
      timer.current = window.setTimeout(tick, 1600)
    }
    timer.current = window.setTimeout(tick, 600)
  }
  const ack = () => { stop(); setEvents((e) => [...e, { t: 0, kind: 'ack', text: '✅ Инцидент подтверждён (ack) — эскалация остановлена' }]) }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">Эскалации</h1><p className="text-sm text-slate-500">Цепочка: дежурный → следующий по ротации → лид группы → руководитель дежурного → СЦ. Настраивается в каждом календаре.</p></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">▶ Симуляция инцидента</h3>
          <select className={inputCls} value={calId} onChange={(e) => { setCalId(e.target.value); stop(); setEvents([]) }}>{state.calendars.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2"><Btn onClick={run}>🚨 Запустить</Btn><Btn variant="ghost" onClick={ack} disabled={!running}>✅ Подтвердить (ack)</Btn></div>
          <p className="text-xs text-slate-500">Время ускорено: 1 «минута» ожидания ≈ доля секунды. Сообщения появятся в разделе «Уведомления (Telegram)».</p>
          <div className="space-y-1.5">
            {events.map((e, i) => (
              <div key={i} className={`rounded-lg px-3 py-1.5 text-sm ${e.kind === 'ack' ? 'bg-emerald-50 text-emerald-800' : e.kind === 'end' ? 'bg-red-50 text-red-700' : 'bg-slate-50'}`}>
                <span className="mr-2 font-mono text-xs text-slate-400">{e.level ? `T+${e.t}м` : fmtT(Date.now())}</span>{e.text}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Цепочка «{c.name}» сейчас</h3><TypeBadge t={c.type} /></div>
          <EscalationChain c={c} people={state.people} t={now} />
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Все календари: кому звонить</h3>
        <div className="divide-y divide-slate-100">
          {state.calendars.map((x) => {
            const lead = state.people.find((p) => p.id === x.leadId)
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-3 py-2">
                <a href={`#/calendars/${x.id}`} className="w-48 font-medium hover:text-blue-700">{x.name}</a>
                <div className="flex-1"><EscalationChain c={x} people={state.people} t={now} compact /></div>
                <span className="flex items-center gap-1 text-xs text-slate-500">лид: <Avatar p={lead} size={20} /> {lead?.phone}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
