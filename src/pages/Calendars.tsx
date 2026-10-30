import { useMemo, useRef, useState } from 'react'
import { onCallAt } from '../cache'
import { CalendarFilters, Pager, StarButton } from '../CalendarList'
import { launchNote, uid } from '../engine'
import { defaultEscalation } from '../data'
import { calendarFormErrors } from '../validation'
import { useFavorites } from '../favorites'
import { calendarOrgUnit, EMPTY_FILTER, filterCalendars, type CalFilter } from '../search'
import { peopleById, useNow, useStore } from '../store'
import { DEFAULT_TZ, TZ_OPTIONS } from '../tz'
import { PersonPicker } from '../PersonPicker'
import { Avatar, Btn, Card, Empty, Field, focusFirstInvalid, FormErrors, inputCls, Modal } from '../ui'
import type { Calendar } from '../types'

const PAGE = 24

export function Calendars({ initialQuery = '' }: { initialQuery?: string }) {
  const { state } = useStore()
  const now = useNow()
  const me = state.currentUserId
  const { isFav, toggle } = useFavorites(me)
  const [create, setCreate] = useState(false)
  const [f, setF] = useState<CalFilter>({ ...EMPTY_FILTER, q: initialQuery })
  const [page, setPage] = useState(0)
  const byId = peopleById(state.people)
  const orgOf = useMemo(() => {
    const m = new Map(state.calendars.map((c) => [c.id, calendarOrgUnit(c, peopleById(state.people))]))
    return (c: Calendar) => m.get(c.id) ?? ''
  }, [state.calendars, state.people])
  const orgs = useMemo(() => [...new Set(state.calendars.map(orgOf))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru')), [state.calendars, orgOf])
  const list = useMemo(() => filterCalendars(state.calendars, f, now, orgOf), [state.calendars, f, Math.floor(now / 60000), orgOf]) // eslint-disable-line
  const cur = Math.min(page, Math.max(0, Math.ceil(list.length / PAGE) - 1))

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Календари</h1>
          <p className="mt-1 text-sm text-muted">Один календарь — один продукт. Кто когда дежурит по команде — в разделе «Дежурства команд». Поиск ищет и по названию команды.</p>
        </div>
        <Btn onClick={() => setCreate(true)}>Новый календарь</Btn>
      </header>
      <CalendarFilters f={f} set={(x) => { setF(x); setPage(0) }} orgs={orgs} />
      {list.length === 0 ? <Empty title="Ничего не нашлось" text="Попробуйте другое название, сбросьте фильтры или создайте календарь." /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.slice(cur * PAGE, cur * PAGE + PAGE).map((c) => {
            const on = onCallAt(c, now)
            return (
              <a key={c.id} href={`#/calendars/${c.id}`} className="block" data-testid="calendar-card">
                <Card className="h-full p-5 hover:border-line-strong">
                  <div className="flex items-center gap-2">
                    <h3 className="flex-1 font-medium">{c.name}</h3>
                    <StarButton on={isFav(c.id)} name={c.name} onToggle={() => toggle(c.id)} className="-my-1 -mr-2" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{c.description || c.product}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex -space-x-1.5">{on.slice(0, 5).map((e) => <span key={e.personId} className="rounded-full ring-2 ring-surface"><Avatar p={byId.get(e.personId)} size={26} /></span>)}{!on.length && (launchNote(c, now) ? <span className="text-xs text-muted">{launchNote(c, now)}</span> : <span className="text-xs text-danger">никто не дежурит</span>)}</div>
                    <span className="truncate text-xs text-faint">{c.team !== c.name ? c.team : orgOf(c)}</span>
                  </div>
                </Card>
              </a>
            )
          })}
        </div>
      )}
      <Pager page={cur} total={list.length} size={PAGE} set={setPage} />
      {create && <CreateCalendar onClose={() => setCreate(false)} />}
    </div>
  )
}

/** Новый календарь. preset — открыт с экрана команды: команда уже выбрана, лид — тот, кто настраивает. */
export function CreateCalendar({ onClose, preset }: { onClose: () => void; preset?: { team: string; name?: string } }) {
  const { state, update } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const teams = [...new Set([...state.people.flatMap((p) => p.teams), ...state.calendars.map((c) => c.team)])].sort((a, b) => a.localeCompare(b, 'ru'))
  const [name, setName] = useState(preset?.name ?? '')
  const [product, setProduct] = useState('')
  const [teamChoice, setTeamChoice] = useState(preset?.team ?? '')
  const [newTeam, setNewTeam] = useState('')
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [leadId, setLeadId] = useState(preset ? me.id : '')
  const creating = teamChoice === '__new'
  const teamName = creating ? newTeam.trim() : teamChoice
  // состав команды приходит из LDAP: календарь его не меняет
  const teamPeople = creating ? [] : state.people.filter((p) => p.teams.includes(teamName)).map((p) => p.id)
  // ошибки показываем после первой попытки создать; кнопка не блокируется молча
  const [tried, setTried] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = calendarFormErrors({ name, teamChoice, newTeam, leadId })
  const err = (k: keyof typeof errors) => (tried ? errors[k]?.message : undefined)
  const submit = () => {
    const missing = Object.keys(errors)
    if (missing.length) { setTried(true); focusFirstInvalid(formRef.current); return }
    const id = 'cal-' + uid()
    const c: Calendar = {
      id, name: name.trim(), product: product.trim() || name.trim(), description: '', team: teamName, ownerId: me.id, leadId, timezone, layerMode: 'parallel', repeat: 1,
      layers: [],
      shifts: [],
      escalation: defaultEscalation(),
    }
    update((s) => ({ ...s, calendars: [...s.calendars, c] }))
    // сразу открываем мастер графика; отдельный тост не нужен — мастер и есть следующий шаг
    try { sessionStorage.setItem('oncall-open-rotation', id) } catch { /* ignore */ }
    onClose()
    location.hash = `#/calendars/${id}`
  }
  return (
    <Modal title={preset ? `Дежурства команды «${preset.team}»` : 'Новый календарь'} onClose={onClose}>
      {preset && <p className="-mt-2 mb-5 text-sm text-muted">Создадим календарь команды и сразу откроем мастер графика дежурств.</p>}
      <form ref={formRef} noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="Название" hint="Так календарь виден на дашборде и в уведомлениях" error={err('name')}><input autoFocus data-testid="cal-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Кредитный конвейер" /></Field>
        {!preset && <Field label="Команда" hint="Существующая или новая. Состав команды приходит из LDAP." error={err('team')}>
          <select data-testid="team-select" className={inputCls} value={teamChoice} onChange={(e) => { setTeamChoice(e.target.value); setLeadId('') }}>
            <option value="">Выберите</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__new">Новая команда…</option>
          </select>
        </Field>}
        {creating && <Field label="Название новой команды" error={err('newTeam')}><input data-testid="new-team" className={inputCls} value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Например: Кредитный конвейер" /></Field>}
        <div data-testid="chosen-team" className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {teamName
            ? <>Календарь будет в команде <span className="font-medium text-ink">«{teamName}»</span>{creating ? '.' : ` · в команде (LDAP): ${teamPeople.length}.`} Кто дежурит — выберете в графике.</>
            : 'Команда пока не выбрана.'}
        </div>
        <Field label="Продукт"><input className={inputCls} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Сервисы скоринга и выдачи кредитов" /></Field>
        <Field label="Лид группы" hint="Обязательное поле. Сверху — люди выбранной команды." error={err('lead')}>
          <PersonPicker testId="lead-select" people={state.people} teamFirst={teamPeople} teamLabel="Выбранная команда" value={leadId} onChange={setLeadId} />
        </Field>
        <Field label="Часовой пояс" hint="В нём считаются передачи смен и дни недели">
          <select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>{TZ_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        {tried && <FormErrors missing={Object.values(errors).map((e) => e!.label)} />}
        <div className="flex justify-end gap-2 pt-2"><Btn variant="ghost" type="button" onClick={onClose}>Отмена</Btn><Btn type="submit" data-testid="create-calendar">{preset ? 'Создать и настроить график' : 'Создать'}</Btn></div>
      </form>
    </Modal>
  )
}
