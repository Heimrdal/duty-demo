import { useEffect, useRef, useState } from 'react'
import { fmtT } from '../engine'
import { useNow, useStore } from '../store'
import { Btn, Card, EscalationChain, inputCls, resolveChain } from '../ui'

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
      setEvents((e) => [...e, { t: lv.delayMin, level: lv.level, kind: 'page', text: `${round > 1 ? `[повтор ${round}] ` : ''}Уровень ${lv.level} — ${lv.label}: ${lv.people.map((p) => p.name).join(', ') || 'никого'} (звонок и Telegram)` }])
      lv.people.forEach((p) => sendTg({ toPersonId: p.id, calendarId: c.id, kind: 'escalation', text: `🚨 ${inc} · уровень ${lv.level} (${lv.label})\nКалендарь: «${c.name}»\n${title}\n${lv.level > 1 ? 'Предыдущий уровень не подтвердил.\n' : ''}[Принять] [Эскалировать]` }))
      i++
      timer.current = window.setTimeout(tick, 1600)
    }
    timer.current = window.setTimeout(tick, 600)
  }
  const ack = () => { stop(); setEvents((e) => [...e, { t: 0, kind: 'ack', text: 'Инцидент подтверждён — эскалация остановлена' }]) }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Эскалации</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">Дежурный, следующий по ротации, лид, руководитель, ситуационный центр. Правила задаются в календаре.</p>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h3 className="font-medium">Симуляция инцидента</h3>
          <select className={inputCls} value={calId} onChange={(e) => { setCalId(e.target.value); stop(); setEvents([]) }}>{state.calendars.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2"><Btn onClick={run}>Запустить</Btn><Btn variant="ghost" onClick={ack} disabled={!running}>Подтвердить</Btn></div>
          <p className="text-xs text-muted">Время ускорено. Сообщения появятся в уведомлениях.</p>
          <div className="space-y-2">
            {events.map((e, i) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-sm ${e.kind === 'ack' ? 'tint-ok' : e.kind === 'end' ? 'tint-danger' : 'tint-neutral'}`}>
                <span className="mr-2 text-xs text-faint">{e.level ? `+${e.t} мин` : fmtT(Date.now())}</span>{e.text}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 font-medium">{c.name}</h3>
          <EscalationChain c={c} people={state.people} t={now} />
        </Card>
      </div>
      <div>
        <h3 className="mb-2 font-medium">Все календари</h3>
        <div className="divide-y divide-line">
          {state.calendars.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
              <a href={`#/calendars/${x.id}`} className="w-48 text-sm font-medium hover:text-accent">{x.name}</a>
              <div className="min-w-0 flex-1"><EscalationChain c={x} people={state.people} t={now} compact /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
