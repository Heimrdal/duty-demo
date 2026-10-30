import { useState } from 'react'
import { addDays, fmtDT, fmtDur, layerOnCall, rotationLabel, shiftGap, startOfDay, uid } from '../engine'
import { fmtTz, startOfMonthTz, TZ_OPTIONS, tzLabel } from '../tz'
import { AssignDutyModal, LayerWizard, RemoveDutyModal, TakeDutyModal, type AssignInit, type RemoveInit } from '../forms'
import { canCancelShift, teamFirstIds } from '../perm'
import { useNow, useScheduleAccess, useStore } from '../store'
import { MonthGrid, Timeline, type BarTarget } from '../Timeline'
import { PersonPicker } from '../PersonPicker'
import { Btn, Card, type BarAction, Empty, ESC_LABEL, EscalationChain, Field, inputCls, KindMark, Menu, Modal, ScheduleLegend, teamHref, TYPE_META } from '../ui'
import type { Calendar, CalendarType, EscTarget, Layer, Shift } from '../types'

const TABS = [['schedule', 'Расписание'], ['layers', 'Слои'], ['escalation', 'Эскалация'], ['shifts', 'Дежурства'], ['settings', 'Настройки']] as const
type Tab = (typeof TABS)[number][0]

function wantsRotation(id: string) {
  try { return sessionStorage.getItem('oncall-open-rotation') === id } catch { return false }
}

export function CalendarView({ id }: { id: string }) {
  const { state } = useStore()
  const c = state.calendars.find((x) => x.id === id)
  const [tab, setTab] = useState<Tab>(() => (wantsRotation(id) ? 'layers' : 'schedule'))
  const [take, setTake] = useState(false)
  const [draft, setDraft] = useState<Layer | 'new' | null>(() => (wantsRotation(id) ? 'new' : null))
  const [assign, setAssign] = useState<AssignInit | null>(null)
  const [remove, setRemove] = useState<RemoveInit | null>(null)
  const access = useScheduleAccess(c)
  const cancel = useShiftCancel(c)
  if (!c) return <Empty title="Календарь не найден" action={<a className="text-sm text-accent" href="#/calendars">К списку</a>} />
  const owner = state.people.find((p) => p.id === c.ownerId)
  const lead = state.people.find((p) => p.id === c.leadId)
  const closeDraft = () => {
    setDraft(null)
    try {
      if (sessionStorage.getItem('oncall-open-rotation') === id) sessionStorage.removeItem('oncall-open-rotation')
    } catch { /* ignore */ }
  }
  return (
    <div className="space-y-6">
      <header>
        <a href="#/calendars" className="text-sm text-muted hover:text-ink">Календари</a>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{c.name}</h1>
            <p className="mt-2 text-sm text-muted">
              {c.product} · {c.team}
              {' · '}лид {lead?.name ?? 'не назначен'} · {owner?.name}
              {' · '}{c.layerMode === 'parallel' ? 'слои параллельно' : 'слои по приоритету'}
              {' · '}{tzLabel(c.timezone)}
            </p>
            <a href={teamHref(c.team)} className="mt-2 inline-block text-sm font-medium text-accent">Таймлайн команды</a>
          </div>
          <Btn onClick={() => setTake(true)}>Взять дежурство</Btn>
        </div>
      </header>
      {c.layers.length === 0 && access.canEdit && (
        <div data-testid="setup-banner" className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <div className="text-sm font-medium">Следующий шаг — добавить ротацию</div>
          <p className="mt-1 max-w-xl text-sm text-muted">Календарь «{c.name}» пока пустой. Откройте мастер, выберите шаблон и отметьте, сколько человек дежурят одновременно.</p>
          <Btn className="mt-3" onClick={() => { setTab('layers'); setDraft('new') }}>Добавить ротацию</Btn>
        </div>
      )}
      <div className="flex gap-5 border-b border-line text-sm">
        {TABS.map(([k, label]) => <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)} className={`-mb-px border-b pb-2 ${tab === k ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>)}
      </div>
      {tab === 'schedule' && <ScheduleTab c={c} access={access} onAssign={setAssign} onRemove={setRemove} onRotation={() => setTab('layers')} onCancel={cancel.request} />}
      {tab === 'layers' && <LayersTab c={c} access={access} onAdd={() => setDraft('new')} onEdit={setDraft} />}
      {tab === 'escalation' && <EscalationTab c={c} access={access} />}
      {tab === 'shifts' && <ShiftsTab c={c} access={access} onTake={() => setTake(true)} onAssign={setAssign} onCancel={cancel.request} />}
      {tab === 'settings' && <SettingsTab c={c} access={access} />}
      {cancel.dialog}
      {take && <TakeDutyModal calendarId={c.id} onClose={() => setTake(false)} />}
      {assign && <AssignDutyModal key={JSON.stringify(assign)} c={c} init={assign} onClose={() => setAssign(null)} />}
      {remove && <RemoveDutyModal c={c} init={remove} onClose={() => setRemove(null)} onReplace={setAssign} onFill={setAssign} />}
      {draft && <LayerWizard c={c} layer={draft === 'new' ? undefined : draft} onClose={closeDraft} />}
    </div>
  )
}

type Access = ReturnType<typeof useScheduleAccess>

/** Подсказка для тех, кто видит расписание только на просмотр. */
function ReadOnlyNote({ access, what = 'Расписание' }: { access: Access; what?: string }) {
  if (access.canEdit) return null
  return <p data-testid="readonly-note" className="text-sm text-muted">{what} меняет {access.editorsLabel || 'лид группы'}. Вы можете взять дежурство на себя.</p>
}

/** Отмена смены: без дыры — сразу с «Вернуть», с дырой — подтверждение. */
function useShiftCancel(c: Calendar | undefined) {
  const { state, updateCalendar, toast } = useStore()
  const [ask, setAsk] = useState<{ s: Shift; gap: { start: number; end: number } } | null>(null)
  const byId = (id?: string) => state.people.find((p) => p.id === id)
  const doCancel = (s: Shift) => {
    if (!c) return
    updateCalendar(c.id, (cal) => ({ ...cal, shifts: cal.shifts.filter((x) => x.id !== s.id) }))
    toast(s.removesPersonId ? `Снятие отменено: ${byId(s.removesPersonId)?.name ?? ''} снова дежурит` : `Смена отменена: ${byId(s.personId)?.name ?? ''}`, {
      label: 'Вернуть',
      onClick: () => updateCalendar(c.id, (cal) => (cal.shifts.some((x) => x.id === s.id) ? cal : { ...cal, shifts: [...cal.shifts, s] })),
    })
  }
  const request = (s: Shift) => {
    if (!c) return
    const gap = shiftGap(c, s, Date.now())
    if (gap) setAsk({ s, gap })
    else doCancel(s)
  }
  const tz = c?.timezone ?? 'Europe/Moscow'
  const zl = tzLabel(tz)
  const dialog = ask && c ? (
    <Modal title="Отменить смену?" describedBy="gap-warning" onClose={() => setAsk(null)}>
      <div id="gap-warning" data-testid="gap-warning">
        <p className="text-sm leading-relaxed">
          Смена: <b>{byId(ask.s.personId)?.name}</b>, {fmtDT(ask.s.start, tz)} — {fmtDT(ask.s.end, tz)} {zl}.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-danger">
          После отмены в календаре «{c.name}» появится дыра в покрытии: {fmtDT(ask.gap.start, tz)} — {fmtDT(ask.gap.end, tz)} {zl} никто не дежурит.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" onClick={() => setAsk(null)}>Оставить смену</Btn>
        <Btn variant="danger" onClick={() => { doCancel(ask.s); setAsk(null) }}>Всё равно отменить</Btn>
      </div>
    </Modal>
  ) : null
  return { request, dialog }
}

function ScheduleTab({ c, access, onAssign, onRemove, onRotation, onCancel }: { c: Calendar; access: Access; onAssign: (x: AssignInit) => void; onRemove: (x: RemoveInit) => void; onRotation: () => void; onCancel: (s: Shift) => void }) {
  const { state } = useStore()
  const now = useNow()
  const [view, setView] = useState<'7' | '14' | '28' | 'month'>('14')
  const [offset, setOffset] = useState(0)
  const days = view === 'month' ? 0 : +view
  const tz = c.timezone
  const from = addDays(startOfDay(now, tz), (view === 'month' ? 0 : -1) + offset * (days || 0), tz)
  const month = startOfMonthTz(now, offset, tz)
  const actions = (t: BarTarget): BarAction[] => {
    const out: BarAction[] = []
    const ended = (t.shift ? +new Date(t.shift.end) : t.end) <= Date.now()
    if (t.removal) {
      // снят с дежурства: поставить другого в этот слот или вернуть человека
      if (access.canEdit && !ended) out.push({ label: 'Поставить другого', onClick: () => onAssign({ start: t.start, end: t.end, fill: true }) })
      if (access.canEdit) out.push({ label: 'Вернуть дежурного', onClick: () => onCancel(t.removal!) })
      return out
    }
    if (access.canEdit && !ended) {
      out.push({ label: 'Заменить дежурного', onClick: () => onAssign({ replacesPersonId: t.personId, start: t.shift ? +new Date(t.shift.start) : t.start, end: t.shift ? +new Date(t.shift.end) : t.end }) })
      if (t.shift) out.push({ label: 'Изменить', onClick: () => onAssign({ shift: t.shift }) })
      else out.push({ label: 'Снять с дежурства', danger: true, onClick: () => onRemove({ personId: t.personId, layerId: t.layerId, start: t.start, end: t.end }) })
    }
    if (t.shift && canCancelShift(c, state.people, access.me, t.shift)) out.push({ label: access.canEdit ? 'Удалить' : 'Отменить мою смену', danger: true, onClick: () => onCancel(t.shift!) })
    return out
  }
  return (
    <div className="space-y-4">
      {access.canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Btn onClick={() => onAssign({})}>Назначить дежурство</Btn>
          <button className="text-sm text-muted hover:text-ink" onClick={onRotation}>Изменить ротацию</button>
          <span className="text-xs text-faint">Нажмите на смену, чтобы заменить или снять дежурного, на розовую дыру — чтобы поставить</span>
        </div>
      ) : <ReadOnlyNote access={access} />}
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
          <span className="min-w-36 px-2 text-center text-muted">{view === 'month' ? fmtTz(month, tz, { month: 'long', year: 'numeric' }) : `${fmtTz(from, tz, { day: 'numeric', month: 'short' })} – ${fmtTz(addDays(from, days - 1, tz), tz, { day: 'numeric', month: 'short' })}`} <span className="text-faint">· {tzLabel(tz)}</span></span>
        </div>
      </div>
      <Card className="overflow-hidden p-2">
        {view === 'month' ? <MonthGrid c={c} month={month} now={now} /> : <Timeline c={c} from={from} days={days} now={now} actions={actions} onFill={access.canEdit ? (start, end) => onAssign({ start, end, fill: true }) : undefined} />}
      </Card>
      <ScheduleLegend />
      <p className="text-xs text-faint">Линия — текущее время. Розовые интервалы на шкале — дыры во всём окне, счётчик на главной считает только текущий момент.</p>
    </div>
  )
}

function LayersTab({ c, access, onAdd, onEdit }: { c: Calendar; access: Access; onAdd: () => void; onEdit: (l: Layer) => void }) {
  const { state, updateCalendar, toast } = useStore()
  const now = useNow()
  const move = (i: number, d: number) => updateCalendar(c.id, (cal) => { const a = [...cal.layers]; const j = i + d; if (j < 0 || j >= a.length) return cal; [a[i], a[j]] = [a[j], a[i]]; return { ...cal, layers: a } })
  const del = (l: Layer) => { if (confirm(`Удалить слой «${l.name}»?`)) { updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.filter((x) => x.id !== l.id) })); toast('Слой удалён') } }
  const restr = (l: Layer) => l.restriction.type === 'none' ? 'круглосуточно' : l.restriction.type === 'daily' ? `${l.restriction.from}–${l.restriction.to}` : `${l.restriction.days.map((d) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][d]).join(' ')}`
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{c.layerMode === 'parallel' ? 'Все слои дежурят сразу.' : 'Алерт получает верхний слой, где кто-то есть.'}</p>
        {access.canEdit && <Btn onClick={onAdd}>Добавить ротацию</Btn>}
      </div>
      <ReadOnlyNote access={access} what="Ротации" />
      {c.layers.length === 0 && <Empty title="Слоёв пока нет" text="Шаблон в мастере заполнит ротацию за один клик." />}
      {c.layers.map((l, i) => {
        const on = layerOnCall(l, now, c.timezone)
        return (
          <div key={l.id} className="group rounded-xl border border-line bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{l.name}</span><KindMark k={l.kind} /></div>
                <p className="mt-1 text-sm text-muted">{rotationLabel(l)} · передача {l.handoffTime} {tzLabel(c.timezone)} · {Math.min(l.parallel, l.participants.length)} одновременно · {restr(l)}</p>
              </div>
              {access.canEdit && <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <button className="px-2 text-sm text-muted hover:text-ink" onClick={() => onEdit(l)}>Изменить</button>
                <Menu items={[
                  { label: 'Выше', onClick: () => move(i, -1), disabled: i === 0 },
                  { label: 'Ниже', onClick: () => move(i, 1), disabled: i === c.layers.length - 1 },
                  { label: 'Удалить', danger: true, onClick: () => del(l) },
                ]} />
              </div>}
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
    </div>
  )
}

function EscalationTab({ c, access }: { c: Calendar; access: Access }) {
  const { state, updateCalendar } = useStore()
  const now = useNow()
  const setSteps = (fn: (s: Calendar['escalation']) => Calendar['escalation']) => updateCalendar(c.id, (cal) => ({ ...cal, escalation: fn(cal.escalation) }))
  const teamIds = teamFirstIds(c, state.people)
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div>
        <h3 className="font-medium">Правила</h3>
        <p className="mt-1 mb-4 text-sm text-muted">Если уровень не подтвердил алерт, через несколько минут зовём следующий.</p>
        {!access.canEdit && <div className="mb-4"><ReadOnlyNote access={access} what="Правила" /></div>}
        <fieldset disabled={!access.canEdit} className="min-w-0">
        <div className="space-y-2">
          {c.escalation.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-sm text-faint">{i + 1}</span>
              {i === 0 ? (
                <span className="w-56 text-sm" title="Первый уровень всегда — текущие дежурные календаря">{ESC_LABEL.oncall} <span className="text-faint">· сразу</span></span>
              ) : (
                <select aria-label={`Уровень ${i + 1}: кого звать`} className={`${inputCls} w-56`} value={s.target} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, target: e.target.value as EscTarget } : x)))}>
                  {Object.entries(ESC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
              {s.target === 'person' && i > 0 && (
                <PersonPicker className="w-56" aria-label={`Уровень ${i + 1}: сотрудник`} people={state.people} teamFirst={teamIds} emptyLabel="Кто" value={s.personId ?? ''} onChange={(id) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, personId: id } : x)))} />
              )}
              {i > 0 && <span className="flex items-center gap-1 text-sm text-muted">через <input type="number" aria-label={`Уровень ${i + 1}: задержка, минут`} min={1} className={`${inputCls} w-16`} value={s.delayMin} onChange={(e) => setSteps((a) => a.map((x) => (x.id === s.id ? { ...x, delayMin: Math.max(1, +e.target.value) } : x)))} /> мин</span>}
              {i > 0 && access.canEdit && <button className="ml-auto text-faint hover:text-danger" aria-label={`Удалить уровень ${i + 1}`} onClick={() => setSteps((a) => a.filter((x) => x.id !== s.id))}>×</button>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {access.canEdit ? <button className="text-sm text-muted hover:text-ink" onClick={() => setSteps((a) => [...a, { id: uid(), target: 'manager', delayMin: 15 }])}>Добавить уровень</button> : <span />}
          <label className="flex items-center gap-2 text-sm text-muted">Повторить <input type="number" aria-label="Повторить цепочку, раз" min={0} max={5} className={`${inputCls} w-16`} value={c.repeat} onChange={(e) => updateCalendar(c.id, (cal) => ({ ...cal, repeat: +e.target.value }))} /> раз</label>
        </div>
        </fieldset>
      </div>
      <div>
        <h3 className="mb-4 font-medium">Сейчас, {fmtDT(now, c.timezone)} {tzLabel(c.timezone)}</h3>
        <EscalationChain c={c} people={state.people} t={now} calendars={state.calendars} />
        <a href="#/escalation" className="mt-4 inline-block text-sm text-muted hover:text-ink">Симуляция инцидента</a>
      </div>
    </div>
  )
}

function ShiftsTab({ c, access, onTake, onAssign, onCancel }: { c: Calendar; access: Access; onTake: () => void; onAssign: (x: AssignInit) => void; onCancel: (s: Shift) => void }) {
  const { state } = useStore()
  const byId = (id?: string) => state.people.find((p) => p.id === id)
  const list = [...c.shifts].sort((a, b) => +new Date(a.start) - +new Date(b.start))
  const tz = c.timezone
  const zl = tzLabel(tz)
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="font-medium">Разовые дежурства, подмены и снятия</h3>
        <div className="flex gap-2">
          {access.canEdit && <Btn variant="ghost" onClick={() => onAssign({})}>Назначить</Btn>}
          <Btn onClick={onTake}>Взять дежурство</Btn>
        </div>
      </div>
      {list.length === 0 && <Empty title="Пока пусто" text={access.canEdit ? 'Назначьте дежурного или запишитесь сами.' : 'Запишитесь сами — из кнопки выше или с таймлайна команды.'} />}
      <div className="divide-y divide-line">
        {list.map((s) => s.removesPersonId ? (
          <div key={s.id} data-testid="removal-entry" className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
            <span className="font-medium text-muted line-through">{byId(s.removesPersonId)?.name}</span>
            <span className="rounded bg-surface-2 px-1.5 text-xs text-muted">снят(а) с дежурства</span>
            {s.layerId && <span className="text-muted">{c.layers.find((l) => l.id === s.layerId)?.name}</span>}
            <span className="text-muted">{fmtDT(s.start, tz)} — {fmtDT(s.end, tz)} {zl}</span>
            <span className="text-faint">{fmtDur(+new Date(s.end) - +new Date(s.start))}</span>
            {s.note && <span className="text-faint">{s.note}</span>}
            {access.canEdit && (
              <span className="ml-auto flex gap-3">
                {+new Date(s.end) > Date.now() && <button className="text-muted hover:text-ink" aria-label={`Поставить другого вместо ${byId(s.removesPersonId)?.name}, ${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)}`} onClick={() => onAssign({ start: +new Date(s.start), end: +new Date(s.end), fill: true })}>Поставить другого</button>}
                <button className="text-muted hover:text-danger" aria-label={`Отменить снятие: ${byId(s.removesPersonId)?.name}, ${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)}`} onClick={() => onCancel(s)}>Отменить снятие</button>
              </span>
            )}
          </div>
        ) : (
          <div key={s.id} className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
            <span className="font-medium">{byId(s.personId)?.name}</span>
            <KindMark k={s.replacesPersonId ? 'override' : 'oneoff'} />
            {s.replacesPersonId && <span className="text-muted">вместо {byId(s.replacesPersonId)?.name}</span>}
            <span className="text-muted">{fmtDT(s.start, tz)} — {fmtDT(s.end, tz)} {zl}</span>
            <span className="text-faint">{fmtDur(+new Date(s.end) - +new Date(s.start))}</span>
            {s.note && <span className="text-faint">{s.note}</span>}
            <span className="ml-auto flex gap-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              {access.canEdit && <button className="text-muted hover:text-ink" aria-label={`Изменить смену: ${byId(s.personId)?.name}, ${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)}`} onClick={() => onAssign({ shift: s })}>Изменить</button>}
              {canCancelShift(c, state.people, access.me, s) && <button className="text-muted hover:text-danger" aria-label={`Отменить смену: ${byId(s.personId)?.name}, ${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)}`} onClick={() => onCancel(s)}>Отменить</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab({ c, access }: { c: Calendar; access: Access }) {
  const { state, updateCalendar, update, toast } = useStore()
  const set = (patch: Partial<Calendar>) => updateCalendar(c.id, (cal) => ({ ...cal, ...patch }))
  return (
    <fieldset disabled={!access.canEdit} className="max-w-3xl min-w-0 space-y-4">
    {!access.canEdit && <ReadOnlyNote access={access} what="Настройки" />}
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Название"><input className={inputCls} value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Продукт"><input className={inputCls} value={c.product} onChange={(e) => set({ product: e.target.value })} /></Field>
        <Field label="Описание"><textarea className={inputCls} rows={3} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Тип"><select className={inputCls} value={c.type} onChange={(e) => set({ type: e.target.value as CalendarType })}>{(Object.keys(TYPE_META) as CalendarType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</select></Field>
      </div>
      <div className="space-y-4">
        <Field label="Лид группы"><PersonPicker testId="settings-lead" allowEmpty={false} people={state.people} teamFirst={state.people.filter((p) => p.teams.includes(c.team)).map((p) => p.id)} value={c.leadId} onChange={(leadId) => leadId && set({ leadId })} /></Field>
        <Field label="Сочетание слоёв"><select className={inputCls} value={c.layerMode} onChange={(e) => set({ layerMode: e.target.value as Calendar['layerMode'] })}><option value="parallel">Параллельно</option><option value="priority">По приоритету</option></select></Field>
        <Field label="Часовой пояс" hint="В этом поясе считаются передачи смен, дни недели и часы ограничений">
          <select className={inputCls} value={c.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            {!TZ_OPTIONS.some((o) => o.id === c.timezone) && <option value={c.timezone}>{c.timezone}</option>}
            {TZ_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        {access.canEdit && <Btn variant="danger" onClick={() => { if (confirm(`Удалить календарь «${c.name}»?`)) { update((s) => ({ ...s, calendars: s.calendars.filter((x) => x.id !== c.id) })); toast('Календарь удалён'); location.hash = '#/calendars' } }}>Удалить календарь</Btn>}
      </div>
    </div>
    </fieldset>
  )
}
