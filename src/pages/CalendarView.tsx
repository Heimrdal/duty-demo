import { useState } from 'react'
import { addDays, fmtDT, fmtDur, layerOnCall, rotationLabel, startOfDay, uid } from '../engine'
import { LayerWizard, TakeDutyModal } from '../forms'
import { useNow, useStore } from '../store'
import { MonthGrid, Timeline } from '../Timeline'
import { Btn, Card, Empty, ESC_LABEL, EscalationChain, Field, inputCls, KindMark, Menu, teamHref, TYPE_META } from '../ui'
import type { Calendar, CalendarType, EscTarget, Layer } from '../types'

const TABS = [['schedule', 'Расписание'], ['layers', 'Слои'], ['escalation', 'Эскалация'], ['shifts', 'Дежурства'], ['settings', 'Настройки']] as const
type Tab = (typeof TABS)[number][0]

export function CalendarView({ id }: { id: string }) {
  const { state } = useStore()
  const c = state.calendars.find((x) => x.id === id)
  const [tab, setTab] = useState<Tab>('schedule')
  const [take, setTake] = useState(false)
  if (!c) return <Empty title="Календарь не найден" action={<a className="text-sm text-accent" href="#/calendars">К списку</a>} />
  const owner = state.people.find((p) => p.id === c.ownerId)
  const lead = state.people.find((p) => p.id === c.leadId)
  return (
    <div className="space-y-6">
      <header>
        <a href="#/calendars" className="text-sm text-muted hover:text-ink">Календари</a>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{c.name}</h1>
            <p className="mt-2 text-sm text-muted">
              {c.product} · <a className="hover:text-ink" href={teamHref(c.team)}>{c.team}</a>
              {' · '}лид {lead?.name} · {owner?.name}
              {' · '}{c.layerMode === 'parallel' ? 'слои параллельно' : 'слои по приоритету'}
            </p>
          </div>
          <Btn onClick={() => setTake(true)}>Взять дежурство</Btn>
        </div>
      </header>
      <div className="flex gap-5 border-b border-line text-sm">
        {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b pb-2 ${tab === k ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>)}
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {([['7', 'Неделя'], ['14', '2 недели'], ['28', '4 недели'], ['month', 'Месяц']] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setView(v); setOffset(0) }} className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-surface font-medium shadow-card' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" onClick={() => setOffset(offset - 1)} aria-label="Назад">‹</button>
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" onClick={() => setOffset(0)}>Сегодня</button>
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" onClick={() => setOffset(offset + 1)} aria-label="Вперёд">›</button>
          <span className="min-w-36 px-2 text-center text-muted">{view === 'month' ? month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : `${from.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${addDays(from, days - 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}</span>
        </div>
      </div>
      <Card className="overflow-hidden p-2">
        {view === 'month' ? <MonthGrid c={c} month={month} now={now} /> : <Timeline c={c} from={from} days={days} now={now} />}
      </Card>
      <p className="text-xs text-muted">Цвет полосы — человек. Штриховка — подмена. Линия — текущее время.</p>
      {c.layers.length === 0 && <p className="text-sm text-muted">Слоёв пока нет. Добавьте первый на вкладке «Слои».</p>}
    </div>
  )
}

function LayersTab({ c }: { c: Calendar }) {
  const { state, updateCalendar, toast } = useStore()
  const now = useNow()
  const [edit, setEdit] = useState<Layer | 'new' | null>(null)
  const move = (i: number, d: number) => updateCalendar(c.id, (cal) => { const a = [...cal.layers]; const j = i + d; if (j < 0 || j >= a.length) return cal; [a[i], a[j]] = [a[j], a[i]]; return { ...cal, layers: a } })
  const del = (l: Layer) => { if (confirm(`Удалить слой «${l.name}»?`)) { updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.filter((x) => x.id !== l.id) })); toast('Слой удалён') } }
  const restr = (l: Layer) => l.restriction.type === 'none' ? 'круглосуточно' : l.restriction.type === 'daily' ? `${l.restriction.from}–${l.restriction.to}` : `${l.restriction.days.map((d) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][d]).join(' ')}`
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{c.layerMode === 'parallel' ? 'Все слои дежурят сразу.' : 'Алерт получает верхний слой, где кто-то есть.'}</p>
        <Btn onClick={() => setEdit('new')}>Добавить слой</Btn>
      </div>
      {c.layers.length === 0 && <Empty title="Слоёв пока нет" text="Шаблон в мастере заполнит ротацию за один клик." />}
      {c.layers.map((l, i) => {
        const on = layerOnCall(l, now)
        return (
          <div key={l.id} className="group rounded-xl border border-line bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{l.name}</span><KindMark k={l.kind} /></div>
                <p className="mt-1 text-sm text-muted">{rotationLabel(l)} · передача {l.handoffTime} · {Math.min(l.parallel, l.participants.length)} одновременно · {restr(l)}</p>
              </div>
              <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <button className="px-2 text-sm text-muted hover:text-ink" onClick={() => setEdit(l)}>Изменить</button>
                <Menu items={[
                  { label: 'Выше', onClick: () => move(i, -1), disabled: i === 0 },
                  { label: 'Ниже', onClick: () => move(i, 1), disabled: i === c.layers.length - 1 },
                  { label: 'Удалить', danger: true, onClick: () => del(l) },
                ]} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {l.participants.map((id) => {
                const p = state.people.find((x) => x.id === id)!
                const active = on.includes(id)
                return <span key={id} className="inline-flex items-center gap-2 text-sm"><span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? 'var(--c-ok)' : 'var(--c-line-strong)' }} />{p.name}</span>
              })}
            </div>
          </div>
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
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div>
        <h3 className="font-medium">Правила</h3>
        <p className="mt-1 mb-4 text-sm text-muted">Если уровень не подтвердил алерт, через несколько минут зовём следующий.</p>
        <div className="space-y-2">
          {c.escalation.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-sm text-faint">{i + 1}</span>
              <select className={`${inputCls} w-56`} value={s.target} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, target: e.target.value as EscTarget } : x)))}>
                {Object.entries(ESC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {s.target === 'person' && (
                <select className={`${inputCls} w-48`} value={s.personId ?? ''} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, personId: e.target.value } : x)))}>
                  <option value="">Кто</option>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {i > 0 && <span className="flex items-center gap-1 text-sm text-muted">через <input type="number" min={1} className={`${inputCls} w-16`} value={s.delayMin} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, delayMin: Math.max(1, +e.target.value) } : x)))} /> мин</span>}
              <button className="ml-auto text-faint hover:text-danger" aria-label="Удалить уровень" onClick={() => setSteps((a) => a.filter((x) => x.id !== s.id))}>×</button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button className="text-sm text-muted hover:text-ink" onClick={() => setSteps((a) => [...a, { id: uid(), target: 'manager', delayMin: 15 }])}>Добавить уровень</button>
          <label className="flex items-center gap-2 text-sm text-muted">Повторить <input type="number" min={0} max={5} className={`${inputCls} w-16`} value={c.repeat} onChange={(e) => updateCalendar(c.id, (cal) => ({ ...cal, repeat: +e.target.value }))} /> раз</label>
        </div>
      </div>
      <div>
        <h3 className="mb-4 font-medium">Сейчас, {fmtDT(now)}</h3>
        <EscalationChain c={c} people={state.people} t={now} />
        <a href="#/escalation" className="mt-4 inline-block text-sm text-muted hover:text-ink">Симуляция инцидента</a>
      </div>
    </div>
  )
}

function ShiftsTab({ c, onTake }: { c: Calendar; onTake: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const byId = (id?: string) => state.people.find((p) => p.id === id)
  const list = [...c.shifts].sort((a, b) => +new Date(a.start) - +new Date(b.start))
  return (
    <div>
      <div className="mb-4 flex items-center justify-between"><h3 className="font-medium">Взятые дежурства и подмены</h3><Btn onClick={onTake}>Взять дежурство</Btn></div>
      {list.length === 0 && <Empty title="Пока пусто" text="Запишитесь сами — из кнопки выше или с таймлайна команды." />}
      <div className="divide-y divide-line">
        {list.map((s) => (
          <div key={s.id} className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
            <span className="font-medium">{byId(s.personId)?.name}</span>
            <KindMark k="override" />
            {s.replacesPersonId && <span className="text-muted">вместо {byId(s.replacesPersonId)?.name}</span>}
            <span className="text-muted">{fmtDT(s.start)} — {fmtDT(s.end)}</span>
            <span className="text-faint">{fmtDur(+new Date(s.end) - +new Date(s.start))}</span>
            {s.note && <span className="text-faint">{s.note}</span>}
            <button className="ml-auto text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100" onClick={() => { updateCalendar(c.id, (cal) => ({ ...cal, shifts: cal.shifts.filter((x) => x.id !== s.id) })); toast('Смена отменена') }}>Отменить</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab({ c }: { c: Calendar }) {
  const { state, updateCalendar, update, toast } = useStore()
  const set = (patch: Partial<Calendar>) => updateCalendar(c.id, (cal) => ({ ...cal, ...patch }))
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Название"><input className={inputCls} value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Продукт"><input className={inputCls} value={c.product} onChange={(e) => set({ product: e.target.value })} /></Field>
        <Field label="Описание"><textarea className={inputCls} rows={3} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Тип"><select className={inputCls} value={c.type} onChange={(e) => set({ type: e.target.value as CalendarType })}>{(Object.keys(TYPE_META) as CalendarType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select></Field>
      </div>
      <div className="space-y-4">
        <Field label="Лид группы"><select className={inputCls} value={c.leadId} onChange={(e) => set({ leadId: e.target.value })}>{state.people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select></Field>
        <Field label="Сочетание слоёв"><select className={inputCls} value={c.layerMode} onChange={(e) => set({ layerMode: e.target.value as Calendar['layerMode'] })}><option value="parallel">Параллельно</option><option value="priority">По приоритету</option></select></Field>
        <Field label="Часовой пояс"><input className={inputCls} value="Europe/Moscow (МСК)" disabled /></Field>
        <Btn variant="danger" onClick={() => { if (confirm(`Удалить календарь «${c.name}»?`)) { update((s) => ({ ...s, calendars: s.calendars.filter((x) => x.id !== c.id) })); toast('Календарь удалён'); location.hash = '#/calendars' } }}>Удалить календарь</Btn>
      </div>
    </div>
  )
}
