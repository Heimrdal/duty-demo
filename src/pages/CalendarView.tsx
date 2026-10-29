import { useState } from 'react'
import { addDays, fmtDT, fmtDur, layerOnCall, rotationLabel, startOfDay, uid } from '../engine'
import { LayerWizard, TakeDutyModal } from '../forms'
import { useNow, useStore } from '../store'
import { MonthGrid, Timeline } from '../Timeline'
import { Avatar, Btn, Card, ESC_LABEL, EscalationChain, Field, inputCls, KindBadge, Legend, TYPE_META, TypeBadge } from '../ui'
import type { Calendar, CalendarType, EscTarget, Layer } from '../types'

const TABS = [['schedule', '📅 Расписание'], ['layers', '🧱 Слои и ротации'], ['escalation', '📣 Эскалация'], ['shifts', '✋ Взятые дежурства'], ['settings', '⚙️ Настройки']] as const
type Tab = (typeof TABS)[number][0]

export function CalendarView({ id }: { id: string }) {
  const { state } = useStore()
  const c = state.calendars.find((x) => x.id === id)
  const [tab, setTab] = useState<Tab>('schedule')
  const [take, setTake] = useState(false)
  if (!c) return <div>Календарь не найден. <a className="text-blue-600" href="#/calendars">К списку</a></div>
  const owner = state.people.find((p) => p.id === c.ownerId)
  const lead = state.people.find((p) => p.id === c.leadId)
  return (
    <div className="space-y-4">
      <a href="#/calendars" className="text-sm text-slate-500 hover:text-slate-800">← Все календари</a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3"><span className="text-3xl">{TYPE_META[c.type].icon}</span><h1 className="text-2xl font-bold">{c.name}</h1><TypeBadge t={c.type} /></div>
          <p className="mt-1 text-sm text-slate-500">{c.product} · владелец: {owner?.name} · лид группы: <b>{lead?.name}</b> · {c.layerMode === 'parallel' ? 'слои дежурят параллельно' : 'слои по приоритету (верхний перекрывает)'}</p>
        </div>
        <Btn onClick={() => setTake(true)}>✋ Взять дежурство здесь</Btn>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
      </div>
      {tab === 'schedule' && <ScheduleTab c={c} />}
      {tab === 'layers' && <LayersTab c={c} />}
      {tab === 'escalation' && <EscalationTab c={c} />}
      {tab === 'shifts' && <ShiftsTab c={c} onTake={() => setTake(true)} />}
      {tab === 'settings' && <SettingsTab c={c} />}
      {take && <TakeDutyModal calendarId={c.id} onClose={() => setTake(false)} />}
    </div>
  )
}

function ScheduleTab({ c }: { c: Calendar }) {
  const now = useNow()
  const [view, setView] = useState<'7' | '14' | '28' | 'month'>('14')
  const [offset, setOffset] = useState(0)
  const days = view === 'month' ? 0 : +view
  const from = addDays(startOfDay(now), (view === 'month' ? 0 : -1) + offset * (days || 0))
  const month = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + offset, 1)
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {([['7', 'Неделя'], ['14', '2 недели'], ['28', '4 недели'], ['month', 'Месяц']] as const).map(([v, l]) => <button key={v} onClick={() => { setView(v); setOffset(0) }} className={`rounded-lg px-3 py-1 text-sm ${view === v ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{l}</button>)}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Btn variant="ghost" onClick={() => setOffset(offset - 1)}>←</Btn><Btn variant="ghost" onClick={() => setOffset(0)}>Сегодня</Btn><Btn variant="ghost" onClick={() => setOffset(offset + 1)}>→</Btn>
          <span className="w-40 text-center font-medium">{view === 'month' ? month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : `${from.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${addDays(from, days - 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}</span>
        </div>
      </div>
      {view === 'month' ? <MonthGrid c={c} month={month} now={now} /> : <Timeline c={c} from={from} days={days} now={now} />}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>Цвет полосы = человек (один цвет везде, как в OneUptime)</span><span>▨ штриховка = взял сам / подмена</span><span className="text-red-500">| красная линия = сейчас</span><span>Наведите на полосу — увидите точное время смены</span>
      </div>
      {c.layers.length === 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">В календаре пока нет слоёв. Перейдите во вкладку «Слои и ротации» и добавьте первый.</div>}
    </Card>
  )
}

function LayersTab({ c }: { c: Calendar }) {
  const { state, updateCalendar, toast } = useStore()
  const now = useNow()
  const [edit, setEdit] = useState<Layer | 'new' | null>(null)
  const move = (i: number, d: number) => updateCalendar(c.id, (cal) => { const a = [...cal.layers]; const j = i + d; if (j < 0 || j >= a.length) return cal; [a[i], a[j]] = [a[j], a[i]]; return { ...cal, layers: a } })
  const del = (l: Layer) => { if (confirm(`Удалить слой «${l.name}»?`)) { updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.filter((x) => x.id !== l.id) })); toast('Слой удалён') } }
  const restr = (l: Layer) => l.restriction.type === 'none' ? '24×7' : l.restriction.type === 'daily' ? `ежедневно ${l.restriction.from}–${l.restriction.to}` : `${l.restriction.days.map((d) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][d]).join(', ')} ${l.restriction.from === l.restriction.to ? 'весь день' : `${l.restriction.from}–${l.restriction.to}`}`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{c.layerMode === 'parallel' ? 'Все слои дежурят одновременно: так можно держать, например, 3 разработчиков по суткам и параллельно 2 SRE по неделе.' : 'Порядок важен: алерт получает верхний слой, где кто-то дежурит; нижние закрывают дыры (как в OneUptime).'}</p>
        <Btn onClick={() => setEdit('new')}>＋ Добавить слой</Btn>
      </div>
      {c.layers.map((l, i) => {
        const on = layerOnCall(l, now)
        return (
          <Card key={l.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-slate-100 px-1.5 text-xs font-bold text-slate-500">#{i + 1}</span><b className="text-lg">{l.name}</b><KindBadge k={l.kind} /></div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-slate-600">
                  <span>🔁 {rotationLabel(l)}</span><span>🕙 передача в {l.handoffTime}</span><span>👥 {Math.min(l.parallel, l.participants.length)} одновременно</span><span>⏱ {restr(l)}</span><span>с {new Date(l.startsAt).toLocaleDateString('ru-RU')}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Btn variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="Выше приоритет">↑</Btn>
                <Btn variant="ghost" onClick={() => move(i, 1)} disabled={i === c.layers.length - 1} title="Ниже приоритет">↓</Btn>
                <Btn variant="ghost" onClick={() => setEdit(l)}>✏️ Изменить</Btn>
                <Btn variant="danger" onClick={() => del(l)}>🗑</Btn>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {l.participants.map((id, k) => {
                const p = state.people.find((x) => x.id === id)!
                const active = on.includes(id)
                return <span key={id} className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-sm ${active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}><Avatar p={p} size={22} />{k + 1}. {p.name}{active && <span className="text-xs font-semibold text-emerald-600">● сейчас</span>}</span>
              })}
            </div>
          </Card>
        )
      })}
      {edit && <LayerWizard c={c} layer={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function EscalationTab({ c }: { c: Calendar }) {
  const { state, updateCalendar } = useStore()
  const now = useNow()
  const setSteps = (fn: (s: Calendar['escalation']) => Calendar['escalation']) => updateCalendar(c.id, (cal) => ({ ...cal, escalation: fn(cal.escalation) }))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">Правила эскалации</h3>
        <p className="mb-3 text-xs text-slate-500">Уровень 1 получает алерт сразу. Если никто не подтвердил (ack) — через N минут зовём следующий уровень.</p>
        <div className="space-y-2">
          {c.escalation.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
              <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
              <select className={`${inputCls} w-56`} value={s.target} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, target: e.target.value as EscTarget } : x)))}>
                {Object.entries(ESC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {s.target === 'person' && (
                <select className={`${inputCls} w-48`} value={s.personId ?? ''} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, personId: e.target.value } : x)))}>
                  <option value="">— кто —</option>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {i > 0 && <span className="flex items-center gap-1 text-sm">через <input type="number" min={1} className={`${inputCls} w-16`} value={s.delayMin} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, delayMin: Math.max(1, +e.target.value) } : x)))} /> мин</span>}
              <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => setSteps((a) => a.filter((x) => x.id !== s.id))}>✕</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Btn variant="soft" onClick={() => setSteps((a) => [...a, { id: uid(), target: 'manager', delayMin: 15 }])}>＋ Уровень</Btn>
          <label className="flex items-center gap-2 text-sm">Повторить цепочку <input type="number" min={0} max={5} className={`${inputCls} w-16`} value={c.repeat} onChange={(e) => updateCalendar(c.id, (cal) => ({ ...cal, repeat: +e.target.value }))} /> раз</label>
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Кому звонить прямо сейчас ({fmtDT(now)} МСК)</h3>
        <EscalationChain c={c} people={state.people} t={now} />
        <a href="#/escalation" className="mt-3 inline-block text-sm text-blue-600">▶ Запустить симуляцию инцидента →</a>
      </Card>
    </div>
  )
}

function ShiftsTab({ c, onTake }: { c: Calendar; onTake: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const byId = (id?: string) => state.people.find((p) => p.id === id)
  const list = [...c.shifts].sort((a, b) => +new Date(a.start) - +new Date(b.start))
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Взятые дежурства и подмены (overrides)</h3><Btn onClick={onTake}>✋ Взять дежурство</Btn></div>
      {list.length === 0 && <div className="text-sm text-slate-500">Пока нет. Любой сотрудник может записаться сам — кнопка выше.</div>}
      <div className="space-y-2">
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-2 text-sm">
            <Avatar p={byId(s.personId)} /><b>{byId(s.personId)?.name}</b><KindBadge k="override" />
            {s.replacesPersonId && <span className="text-slate-500">вместо {byId(s.replacesPersonId)?.name}</span>}
            <span>{fmtDT(s.start)} → {fmtDT(s.end)} ({fmtDur(+new Date(s.end) - +new Date(s.start))})</span>
            {s.note && <span className="text-slate-400">«{s.note}»</span>}
            <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => { updateCalendar(c.id, (cal) => ({ ...cal, shifts: cal.shifts.filter((x) => x.id !== s.id) })); toast('Смена отменена') }}>Отменить</button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SettingsTab({ c }: { c: Calendar }) {
  const { state, updateCalendar, update, toast } = useStore()
  const set = (patch: Partial<Calendar>) => updateCalendar(c.id, (cal) => ({ ...cal, ...patch }))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-4">
        <Field label="Название календаря"><input className={inputCls} value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Продукт / функционал"><input className={inputCls} value={c.product} onChange={(e) => set({ product: e.target.value })} /></Field>
        <Field label="Описание"><textarea className={inputCls} rows={3} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Тип"><select className={inputCls} value={c.type} onChange={(e) => set({ type: e.target.value as CalendarType })}>{(Object.keys(TYPE_META) as CalendarType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select></Field>
      </Card>
      <Card className="space-y-4 p-4">
        <Field label="Лид группы (уровень эскалации «Лид группы»)"><select className={inputCls} value={c.leadId} onChange={(e) => set({ leadId: e.target.value })}>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select></Field>
        <Field label="Сочетание слоёв"><select className={inputCls} value={c.layerMode} onChange={(e) => set({ layerMode: e.target.value as Calendar['layerMode'] })}><option value="parallel">Параллельно</option><option value="priority">По приоритету (OneUptime)</option></select></Field>
        <Field label="Часовой пояс"><input className={inputCls} value="Europe/Moscow (МСК)" disabled /></Field>
        <Btn variant="danger" onClick={() => { if (confirm(`Удалить календарь «${c.name}»?`)) { update((s) => ({ ...s, calendars: s.calendars.filter((x) => x.id !== c.id) })); toast('Календарь удалён'); location.hash = '#/calendars' } }}>🗑 Удалить календарь</Btn>
      </Card>
      <div className="lg:col-span-2"><Legend /></div>
    </div>
  )
}
