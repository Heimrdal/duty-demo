import { useState } from 'react'
import { calendarOnCall, isoDate, uid } from '../engine'
import { useNow, useStore } from '../store'
import { Avatar, Btn, Card, Field, inputCls, Legend, Modal, TYPE_META, TypeBadge } from '../ui'
import type { Calendar, CalendarType } from '../types'

export function Calendars() {
  const { state } = useStore()
  const now = useNow()
  const [create, setCreate] = useState(false)
  const [q, setQ] = useState('')
  const byId = (id: string) => state.people.find((p) => p.id === id)
  const list = state.calendars.filter((c) => (c.name + c.product + c.team).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Календари дежурств</h1><p className="text-sm text-slate-500">Один календарь = один продукт или функционал. Внутри — слои ротаций.</p></div>
        <div className="flex gap-2"><input className={`${inputCls} w-64`} placeholder="Поиск по названию, продукту, команде" value={q} onChange={(e) => setQ(e.target.value)} /><Btn onClick={() => setCreate(true)}>＋ Новый календарь</Btn></div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const on = calendarOnCall(c, now)
          const peopleCount = new Set(c.layers.flatMap((l) => l.participants)).size
          return (
            <a key={c.id} href={`#/calendars/${c.id}`} className="block">
              <Card className="h-full p-4 transition hover:-translate-y-0.5 hover:shadow-md" >
                <div className="mb-2 h-1.5 rounded-full" style={{ background: TYPE_META[c.type].color }} />
                <div className="flex items-start justify-between gap-2"><h3 className="text-lg font-semibold">{c.name}</h3><TypeBadge t={c.type} /></div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{c.description || c.product}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                  <span>{c.layers.length} сл.</span><span>{peopleCount} чел.</span><span>{c.layerMode === 'parallel' ? 'слои параллельно' : 'слои по приоритету'}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex -space-x-2">{on.map((e) => <span key={e.personId} className="rounded-full ring-2 ring-white"><Avatar p={byId(e.personId)} size={28} /></span>)}{!on.length && <span className="text-xs text-red-500">никто не дежурит</span>}</div>
                  <span className="text-xs text-slate-500">лид: {byId(c.leadId)?.name}</span>
                </div>
              </Card>
            </a>
          )
        })}
      </div>
      <Legend />
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
    <Modal title="Новый календарь дежурств" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Название (по продукту / функционалу)" hint="Так календарь будет виден в «Кто дежурит сейчас» и в Telegram-уведомлениях"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Кредитный конвейер" /></Field>
        <Field label="Продукт / описание"><input className={inputCls} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Сервисы скоринга и выдачи кредитов" /></Field>
        <Field label="Тип">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_META) as CalendarType[]).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`rounded-lg border p-2 text-left text-sm ${type === t ? 'ring-2' : 'border-slate-200'}`} style={{ borderColor: type === t ? TYPE_META[t].color : undefined, background: type === t ? TYPE_META[t].bg : undefined }}>{TYPE_META[t].icon} {TYPE_META[t].label}</button>
            ))}
          </div>
        </Field>
        <Field label="Лид группы (кому звонить при эскалации)">
          <select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select>
        </Field>
        <Field label="Как сочетаются слои" hint="OneUptime: верхний слой перекрывает нижние. Для параллельных дежурств выберите «параллельно».">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as 'parallel' | 'priority')}><option value="parallel">Параллельно — дежурят все слои одновременно</option><option value="priority">По приоритету — алерт получает верхний слой (как в OneUptime)</option></select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addMe} onChange={(e) => setAddMe(e.target.checked)} /> Сразу создать недельную ротацию и добавить меня</label>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn disabled={!name.trim()} onClick={submit}>Создать</Btn></div>
      </div>
    </Modal>
  )
}
