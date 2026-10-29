import { useState } from 'react'
import { calendarOnCall, isoDate, uid } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, Btn, Card, Empty, Field, inputCls, Modal, teamHref, TYPE_META } from '../ui'
import type { Calendar, CalendarType } from '../types'

export function Calendars() {
  const { state } = useStore()
  const now = useNow()
  const [create, setCreate] = useState(false)
  const [mode, setMode] = useState<'calendars' | 'teams'>('calendars')
  const [q, setQ] = useState('')
  const byId = (id: string) => state.people.find((p) => p.id === id)
  const list = state.calendars.filter((c) => (c.name + c.product + c.team).toLowerCase().includes(q.toLowerCase()))
  const teams = [...new Set(state.calendars.map((c) => c.team))]

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{mode === 'calendars' ? 'Календари' : 'Команды'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'calendars' ? 'Один календарь — один продукт. Внутри слои ротации.' : 'Таймлайн команды: люди, смены и покрытие.'}</p>
        </div>
        {mode === 'calendars' && <Btn onClick={() => setCreate(true)}>Новый календарь</Btn>}
      </header>

      <div className="flex gap-5 text-sm">
        <button className={mode === 'calendars' ? 'font-medium text-ink' : 'text-muted hover:text-ink'} onClick={() => setMode('calendars')}>Календари</button>
        <button className={mode === 'teams' ? 'font-medium text-ink' : 'text-muted hover:text-ink'} onClick={() => setMode('teams')}>Команды</button>
      </div>

      {mode === 'teams' ? (
        <div className="divide-y divide-line">
          {teams.map((t) => {
            const members = state.people.filter((p) => p.team === t)
            const lead = byId(state.calendars.find((c) => c.team === t)?.leadId ?? '')
            return (
              <a key={t} href={teamHref(t)} className="flex items-center justify-between gap-4 py-4 hover:bg-surface-2/60">
                <div>
                  <div className="font-medium">{t}</div>
                  <div className="mt-0.5 text-sm text-muted">Лид {lead?.name ?? '—'} · {members.length} в составе</div>
                </div>
                <span className="text-sm text-faint">Открыть</span>
              </a>
            )
          })}
        </div>
      ) : (
        <>
          <input className={`${inputCls} max-w-sm`} placeholder="Поиск по названию, продукту, команде" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.length === 0 ? <Empty title="Ничего не нашлось" text="Попробуйте другое название или создайте календарь." /> : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {list.map((c) => {
                const on = calendarOnCall(c, now)
                return (
                  <a key={c.id} href={`#/calendars/${c.id}`} className="block">
                    <Card className="h-full p-5 hover:border-line-strong">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[c.type].color }} />
                        <h3 className="font-medium">{c.name}</h3>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted">{c.description || c.product}</p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="flex -space-x-1.5">{on.slice(0, 5).map((e) => <span key={e.personId} className="rounded-full ring-2 ring-surface"><Avatar p={byId(e.personId)} size={26} /></span>)}{!on.length && <span className="text-xs text-danger">никто не дежурит</span>}</div>
                        <span className="text-xs text-faint">{c.team}</span>
                      </div>
                    </Card>
                  </a>
                )
              })}
            </div>
          )}
        </>
      )}
      {create && <CreateCalendar onClose={() => setCreate(false)} />}
    </div>
  )
}

function CreateCalendar({ onClose }: { onClose: () => void }) {
  const { state, update, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const [name, setName] = useState('')
  const [product, setProduct] = useState('')
  const [type, setType] = useState<CalendarType>('product')
  const [leadId, setLeadId] = useState(me.managerId ?? me.id)
  const [mode, setMode] = useState<'parallel' | 'priority'>('parallel')
  const [addMe, setAddMe] = useState(true)
  const submit = () => {
    const id = 'cal-' + uid()
    const c: Calendar = {
      id, name: name.trim(), product: product.trim() || name.trim(), description: '', type, team: me.team, ownerId: me.id, leadId, timezone: 'Europe/Moscow', layerMode: mode, repeat: 1,
      layers: addMe ? [{ id: uid(), name: 'Основная ротация', kind: 'primary', startsAt: isoDate(new Date()), handoffTime: '10:00', rotation: { unit: 'week', count: 1 }, participants: [me.id], parallel: 1, restriction: { type: 'none', from: '00:00', to: '00:00', days: [] } }] : [],
      shifts: [],
      escalation: [{ id: uid(), target: 'oncall', delayMin: 0 }, { id: uid(), target: 'next', delayMin: 5 }, { id: uid(), target: 'lead', delayMin: 10 }, { id: uid(), target: 'manager', delayMin: 15 }],
    }
    update((s) => ({ ...s, calendars: [...s.calendars, c] }))
    toast(`Календарь «${c.name}» создан`)
    location.hash = `#/calendars/${id}`
  }
  return (
    <Modal title="Новый календарь" onClose={onClose}>
      <div className="space-y-5">
        <Field label="Название" hint="Так календарь виден на дашборде и в уведомлениях"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Кредитный конвейер" /></Field>
        <Field label="Продукт"><input className={inputCls} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Сервисы скоринга и выдачи кредитов" /></Field>
        <Field label="Тип">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_META) as CalendarType[]).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`rounded-lg border px-3 py-2 text-left text-sm ${type === t ? 'border-accent bg-accent-soft' : 'border-line'}`}>{TYPE_META[t].label}</button>
            ))}
          </div>
        </Field>
        <Field label="Лид группы">
          <select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select>
        </Field>
        <Field label="Слои" hint="Параллельно — дежурят все слои. По приоритету верхний перекрывает нижние.">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as 'parallel' | 'priority')}><option value="parallel">Параллельно</option><option value="priority">По приоритету</option></select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addMe} onChange={(e) => setAddMe(e.target.checked)} /> Сразу добавить меня в недельную ротацию</label>
        <div className="flex justify-end gap-2 pt-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn disabled={!name.trim()} onClick={submit}>Создать</Btn></div>
      </div>
    </Modal>
  )
}
