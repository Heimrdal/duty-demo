import { useState } from 'react'
import { calendarOnCall, uid } from '../engine'
import { useNow, useStore } from '../store'
import { DEFAULT_TZ, TZ_OPTIONS } from '../tz'
import { Avatar, Btn, Card, Empty, Field, inputCls, LeadSelect, Modal, TYPE_META } from '../ui'
import type { Calendar, CalendarType } from '../types'

export function Calendars() {
  const { state } = useStore()
  const now = useNow()
  const [create, setCreate] = useState(false)
  const [q, setQ] = useState('')
  const byId = (id: string) => state.people.find((p) => p.id === id)
  const list = state.calendars.filter((c) => (c.name + c.product + c.team).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Календари</h1>
          <p className="mt-1 text-sm text-muted">Один календарь — один продукт. Команды и их таймлайн — в разделе «Команды».</p>
        </div>
        <Btn onClick={() => setCreate(true)}>Новый календарь</Btn>
      </header>
      <input aria-label="Поиск календарей" type="search" className={`${inputCls} max-w-sm`} placeholder="Поиск по названию, продукту, команде" value={q} onChange={(e) => setQ(e.target.value)} />
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
      {create && <CreateCalendar onClose={() => setCreate(false)} />}
    </div>
  )
}

function CreateCalendar({ onClose }: { onClose: () => void }) {
  const { state, update, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const teams = [...new Set([...state.people.flatMap((p) => p.teams), ...state.calendars.map((c) => c.team)])].sort((a, b) => a.localeCompare(b, 'ru'))
  const [name, setName] = useState('')
  const [product, setProduct] = useState('')
  const [type, setType] = useState<CalendarType>('product')
  const [teamChoice, setTeamChoice] = useState('')
  const [newTeam, setNewTeam] = useState('')
  const [join, setJoin] = useState(false)
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [leadId, setLeadId] = useState('')
  const [mode, setMode] = useState<'parallel' | 'priority'>('parallel')
  const creating = teamChoice === '__new'
  const teamName = creating ? newTeam.trim() : teamChoice
  const alreadyMember = !creating && !!teamName && me.teams.includes(teamName)
  // Членство в команде дежурств — отдельно от оргструктуры (orgUnit). По умолчанию не добавляем.
  const willJoin = !!teamName && !alreadyMember && join
  const teamPeople = creating ? [] : state.people.filter((p) => p.teams.includes(teamName)).map((p) => p.id)
  const ready = name.trim().length > 0 && teamName.length > 0 && leadId.length > 0
  const submit = () => {
    if (!ready) return
    const id = 'cal-' + uid()
    const c: Calendar = {
      id, name: name.trim(), product: product.trim() || name.trim(), description: '', type, team: teamName, ownerId: me.id, leadId, timezone, layerMode: mode, repeat: 1,
      layers: [],
      shifts: [],
      escalation: [{ id: uid(), target: 'oncall', delayMin: 0 }, { id: uid(), target: 'next', delayMin: 5 }, { id: uid(), target: 'lead', delayMin: 10 }, { id: uid(), target: 'manager', delayMin: 15 }],
    }
    update((s) => ({
      ...s,
      people: willJoin ? s.people.map((p) => (p.id === me.id && !p.teams.includes(teamName) ? { ...p, teams: [...p.teams, teamName] } : p)) : s.people,
      calendars: [...s.calendars, c],
    }))
    try { sessionStorage.setItem('oncall-open-rotation', id) } catch { /* ignore */ }
    toast(`Календарь «${c.name}» создан. Дальше — ротация.`)
    onClose()
    location.hash = `#/calendars/${id}`
  }
  return (
    <Modal title="Новый календарь" onClose={onClose}>
      <div className="space-y-5">
        <Field label="Название" hint="Так календарь виден на дашборде и в уведомлениях"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Кредитный конвейер" /></Field>
        <Field label="Команда" hint="Существующая или новая. Календарь больше не прикрепляется молча.">
          <select data-testid="team-select" className={inputCls} value={teamChoice} onChange={(e) => { setTeamChoice(e.target.value); setLeadId('') }}>
            <option value="">Выберите</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__new">Новая команда…</option>
          </select>
          {creating && <input aria-label="Название новой команды" className={`${inputCls} mt-2`} value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Название новой команды" />}
        </Field>
        <div data-testid="chosen-team" className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {teamName
            ? <>Календарь будет в команде <span className="font-medium text-ink">«{teamName}»</span>{willJoin ? '. Вы станете участником команды дежурств; ваше подразделение не изменится.' : alreadyMember ? '. Вы уже участник этой команды.' : '.'}</>
            : 'Команда пока не выбрана.'}
        </div>
        {teamName && !alreadyMember && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="join-team" checked={join} onChange={(e) => setJoin(e.target.checked)} /> Добавить меня в эту команду</label>
        )}
        <Field label="Продукт"><input className={inputCls} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Сервисы скоринга и выдачи кредитов" /></Field>
        <Field label="Тип">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_META) as CalendarType[]).map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={`rounded-lg border px-3 py-2 text-left text-sm ${type === t ? 'border-accent bg-accent-soft' : 'border-line'}`}>{TYPE_META[t].label}</button>
            ))}
          </div>
        </Field>
        <Field label="Лид группы" hint="Обязательное поле. Сверху — люди выбранной команды.">
          <LeadSelect testId="lead-select" people={state.people} teamFirst={willJoin ? [...new Set([me.id, ...teamPeople])] : teamPeople} value={leadId} onChange={setLeadId} />
        </Field>
        <Field label="Слои" hint="Параллельно — дежурят все слои. По приоритету верхний перекрывает нижние.">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as 'parallel' | 'priority')}><option value="parallel">Параллельно</option><option value="priority">По приоритету</option></select>
        </Field>
        <Field label="Часовой пояс" hint="В нём считаются передачи смен и дни недели">
          <select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>{TZ_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        <div className="flex justify-end gap-2 pt-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn disabled={!ready} onClick={submit}>Создать</Btn></div>
      </div>
    </Modal>
  )
}
