import { useId, useMemo, useRef, useState } from 'react'
import { addDays, addGap, calendarOnCall, defaultStartDate, describePattern, layerAnchor, layerConflicts, layerLaunch, type Conflict, makeRemoval, makeSlot, manualSlots, fmtDT, fmtDur, HOUR, hm, layerBoundary, layerOnCall, overlapWarning, repeatSlots, rotationLabel, startOfDay, uid, weekday, withSlots } from './engine'
import { makeShift, teamFirstIds, upsertShift } from './perm'
import { atDay, dayNumber, DEFAULT_TZ, fromInputTz, toInputTz, tzLabel } from './tz'
import { PersonPicker } from './PersonPicker'
import { peopleById, useStore } from './store'
import { Avatar, Btn, Field, focusFirstInvalid, FormErrors, inlineCls, inputCls, KIND_META, KindMark, Modal } from './ui'
import { allTemplates, queueSize, templateHint, templatePatch, type TemplateItem } from './templates'
import { layerStepErrors } from './validation'
import type { Calendar, Layer, LayerKind, Shift } from './types'

const atHour = (dayStart: number, h: number, tz: string) => atDay(dayNumber(dayStart, tz), h * 60, tz)

/* ---------------- «Взять дежурство» ---------------- */
function preferredCalendars(calendars: Calendar[], userId: string, teams: string[], pinned?: string) {
  const mine = calendars.filter((c) => c.id === pinned || teams.includes(c.team) || c.ownerId === userId || c.layers.some((l) => l.participants.includes(userId)))
  const base = mine.length ? mine : calendars
  const newest = [...base].reverse()
  if (!pinned) return newest
  const hit = newest.find((c) => c.id === pinned)
  return hit ? [hit, ...newest.filter((c) => c.id !== pinned)] : newest
}

export function TakeDutyModal({ calendarId, onClose }: { calendarId?: string; onClose: () => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const ordered = preferredCalendars(state.calendars, me.id, me.teams, calendarId)
  const [calId, setCalId] = useState(ordered[0]?.id ?? '')
  const c = state.calendars.find((x) => x.id === calId)!
  const tz = c?.timezone ?? DEFAULT_TZ
  const zl = tzLabel(tz)
  const uidBase = useId()
  const errId = `${uidBase}-err`
  const todayKey = startOfDay(Date.now(), tz)
  const presets = useMemo(() => {
    const now = Date.now()
    const today = todayKey
    const wd = weekday(today, tz)
    const sat0 = addDays(today, (5 - wd + 7) % 7, tz)
    const sat = sat0 <= now ? addDays(sat0, 7, tz) : sat0
    const mon = addDays(today, 7 - wd, tz)
    const at = (d: number, h: number) => atHour(d, h, tz)
    const todayStart = at(today, 10)
    const list = [
      { label: 'Завтра (сутки)', s: at(addDays(today, 1, tz), 10), e: at(addDays(today, 2, tz), 10) },
      { label: 'Ближайшие выходные', s: at(sat, 0), e: at(addDays(sat, 2, tz), 0) },
      { label: 'Следующая неделя', s: at(mon, 10), e: at(addDays(mon, 7, tz), 10) },
      { label: '2 недели (для разработки)', s: at(mon, 10), e: at(addDays(mon, 14, tz), 10) },
    ]
    if (todayStart > now) list.unshift({ label: 'Сутки с сегодня 10:00', s: todayStart, e: at(addDays(today, 1, tz), 10) })
    return list.filter((p) => p.s > now)
  }, [todayKey, tz])
  const [start, setStart] = useState(toInputTz(presets[0].s, tz))
  const [end, setEnd] = useState(toInputTz(presets[0].e, tz))
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [replaces, setReplaces] = useState('')
  const [note, setNote] = useState('')
  const sT = fromInputTz(start, tz)
  const eT = fromInputTz(end, tz)
  const empty = Number.isNaN(sT) || Number.isNaN(eT)
  const inPast = !empty && sT < Date.now()
  const candidates = c && !empty ? calendarOnCall(c, Math.max(sT, Date.now()) + 1).filter((e) => e.personId !== me.id) : []
  const valid = c && !empty && eT > sT && !inPast && (mode === 'add' || replaces)
  const error = empty ? 'Укажите начало и окончание' : inPast ? 'Начало уже в прошлом — выберите будущий интервал' : eT <= sT ? 'Окончание раньше начала' : ''

  const submit = () => {
    if (!valid) return
    updateCalendar(c.id, (cal) => ({
      ...cal,
      shifts: [...cal.shifts, { id: uid(), personId: me.id, start: new Date(sT).toISOString(), end: new Date(eT).toISOString(), replacesPersonId: mode === 'replace' ? replaces : undefined, note: note || (mode === 'replace' ? 'Подмена' : 'Взял(а) дежурство сам(а)'), createdAt: new Date().toISOString() }],
    }))
    sendTg({ toPersonId: me.id, calendarId: c.id, kind: 'signup', text: `✅ Вы записаны на дежурство\nКалендарь: «${c.name}»\nС ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${zl} (${fmtDur(eT - sT)})\nЗа 1 час до начала пришлю напоминание.` })
    if (mode === 'replace' && replaces) {
      sendTg({ toPersonId: replaces, calendarId: c.id, kind: 'handover', text: `🔁 Вас подменяет ${me.name}\nКалендарь: «${c.name}»\nС ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${zl} — в это время алерты вам не придут.` })
    }
    toast(`Дежурство в «${c.name}» добавлено. Уведомление отправлено в Telegram (демо).`)
    onClose()
  }

  return (
    <Modal title="Взять дежурство" onClose={onClose} wide>
      <div className="space-y-6">
        <p className="text-sm text-muted"><span className="text-ink">{me.name}</span> записывается на себя. Календарь и время — остальное подставим.</p>
        <Field label="Календарь">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {ordered.slice(0, 6).map((x) => (
              <button key={x.id} type="button" aria-pressed={x.id === calId} onClick={() => setCalId(x.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${x.id === calId ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
                <div className="font-medium">{x.name}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Когда">
          <div className="mb-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={() => { setStart(toInputTz(p.s, tz)); setEnd(toInputTz(p.e, tz)) }} className="rounded-full px-3 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${uidBase}-start`} className="mb-1 block text-xs text-muted">Начало дежурства, {zl}</label>
              <input id={`${uidBase}-start`} type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!error && error !== 'Окончание раньше начала'} aria-describedby={error ? errId : undefined} />
            </div>
            <div>
              <label htmlFor={`${uidBase}-end`} className="mb-1 block text-xs text-muted">Окончание дежурства, {zl}</label>
              <input id={`${uidBase}-end`} type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!error && error !== 'Начало уже в прошлом — выберите будущий интервал'} aria-describedby={error ? errId : undefined} />
            </div>
          </div>
        </Field>
        <Field label="Как">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'add' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Дополнительно</span><div className="text-xs text-muted">параллельно с ротацией</div>
            </button>
            <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'replace' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Подменить коллегу</span><div className="text-xs text-muted">override поверх смены</div>
            </button>
          </div>
        </Field>
        {mode === 'replace' && (
          <Field label="Кого подменяю">
            <PersonPicker testId="take-replaces" people={candidates.map((e) => peopleById(state.people).get(e.personId)).filter((p) => !!p)} value={replaces} onChange={setReplaces}
              note={(p) => candidates.find((e) => e.personId === p.id)?.layerName} placeholder="Кто сейчас дежурит" />
          </Field>
        )}
        <Field label="Комментарий"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: релиз 2.14, ночное окно" /></Field>
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="text-sm text-muted">{error ? <span id={errId} role="alert" className="text-danger">{error}</span> : <>{mode === 'replace' ? 'Подмена' : 'Разовое'} · {fmtDur(eT - sT)} · {fmtDT(sT, tz)} {zl}</>}</div>
          <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn onClick={submit} disabled={!valid}>Взять дежурство</Btn></div>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Пересечения с другими дежурствами ---------------- */
/** Кто, когда и в каком календаре уже дежурит в те же часы. Предупреждение: сохранить всё равно можно. */
export function ConflictList({ items, tz, from, limit = 8, title = 'Пересечения с другими дежурствами' }: { items: Conflict[]; tz: string; from: number; limit?: number; title?: string }) {
  const { state } = useStore()
  const byId = peopleById(state.people)
  const people = new Set(items.map((x) => x.personId)).size
  return (
    <div data-testid="conflicts" data-count={items.length} className={`rounded-lg px-3 py-2.5 text-sm ${items.length ? 'bg-warn/10' : 'bg-surface-2'}`}>
      <div className="font-medium">{title} <span className="font-normal text-muted">· 4 недели с {fmtDT(from, tz)}</span></div>
      {!items.length ? <p className="mt-1 text-muted">Пересечений нет: в эти часы у участников нет других дежурств.</p> : (
        <>
          <p className="mt-1 text-muted">{items.length} {items.length === 1 ? 'пересечение' : items.length < 5 ? 'пересечения' : 'пересечений'} у {people} {people === 1 ? 'человека' : 'человек'}. Сохранить можно — убедитесь, что человек справится с двумя дежурствами сразу.</p>
          <ul className="mt-2 space-y-1">
            {items.slice(0, limit).map((x, i) => (
              <li key={i} data-testid="conflict-row" className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{byId.get(x.personId)?.name ?? x.personId}</span>
                <span className="text-muted">{fmtDT(x.start, tz)} — {fmtDT(x.end, tz)} ({fmtDur(x.end - x.start)})</span>
                <span>{x.same ? `этот календарь, «${x.layerName}»` : `«${x.calendarName}», ${x.layerName}`}</span>
              </li>
            ))}
          </ul>
          {items.length > limit && <p className="mt-1 text-xs text-muted">и ещё {items.length - limit}</p>}
        </>
      )}
    </div>
  )
}

/* ---------------- Мастер слоя ротации ---------------- */
export function LayerWizard({ c, layer, onClose, onSaved }: { c: Calendar; layer?: Layer; onClose: () => void; onSaved?: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const [opened] = useState(() => Date.now())
  // дату старта пересчитываем по времени передачи, пока человек не выбрал её сам
  const [startTouched, setStartTouched] = useState(!!layer)
  const tz = c.timezone || DEFAULT_TZ
  const [step, setStep] = useState(0)
  const [tpl, setTpl] = useState<string | null>(null)
  const [l, setL] = useState<Layer>(layer ?? {
    id: uid(), name: '', kind: 'primary', startsAt: defaultStartDate('10:00', Date.now(), tz), handoffTime: '10:00', rotation: { unit: 'week', count: 1 },
    participants: state.currentUserId ? [state.currentUserId] : [], parallel: 1, restriction: { type: 'none', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] },
  })
  const set = (patch: Partial<Layer>) => setL((x) => ({ ...x, ...patch, ...(patch.handoffTime && !startTouched && !patch.startsAt ? { startsAt: defaultStartDate(patch.handoffTime, opened, tz) } : {}) }))
  const steps = ['Название и тип', 'Ротация', 'Участники', 'Часы дежурства', 'Проверка']
  const teamIds = useMemo(() => teamFirstIds(c, state.people), [c, state.people])
  const byId = peopleById(state.people)
  const toggle = (id: string) => set({ participants: l.participants.includes(id) ? l.participants.filter((x) => x !== id) : [...l.participants, id] })
  const move = (i: number, d: number) => { const a = [...l.participants]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ participants: a }) }
  // ошибки шага показываем по нажатию «Далее», кнопка не блокируется молча
  const [tried, setTried] = useState(-1)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stepErrors = layerStepErrors(step, { ...l, startDate: l.startsAt })
  const err = (k: keyof typeof stepErrors) => (tried === step ? stepErrors[k]?.message : undefined)
  // «Ручной график»: без ротации, участников и часов — сразу к проверке
  const manual = l.mode === 'manual'
  const order = manual ? [0, 4] : [0, 1, 2, 3, 4]
  const pos = Math.max(0, order.indexOf(step))
  const next = () => {
    if (Object.keys(stepErrors).length) { setTried(step); focusFirstInvalid(bodyRef.current); return }
    setTried(-1)
    setStep(order[pos + 1] ?? step)
  }
  const back = () => { setTried(-1); if (pos) setStep(order[pos - 1]); else onClose() }
  const setMode = (m: 'rotation' | 'manual') => setL((x) => (m === 'manual'
    ? { ...x, mode: 'manual', slots: x.slots ?? [], participants: [...new Set((x.slots ?? []).map((s) => s.personId))] }
    : { ...x, mode: undefined, slots: undefined, participants: x.participants.length ? x.participants : state.currentUserId ? [state.currentUserId] : [] }))
  const templates = allTemplates()
  const applyTpl = (t: TemplateItem) => {
    const patch = templatePatch(t, Date.now(), tz)
    setL((x) => ({
      ...x,
      ...patch,
      startsAt: startTouched ? x.startsAt : patch.startsAt ?? x.startsAt,
      name: !x.name.trim() || templates.some((p) => p.name === x.name) ? t.name : x.name,
      rotation: patch.rotation ? { ...patch.rotation } : x.rotation,
      restriction: patch.restriction ? { ...patch.restriction, days: [...patch.restriction.days] } : x.restriction,
    }))
    setTpl(t.id)
  }
  const save = () => {
    const fixed = manual ? withSlots({ ...l, parallel: Math.max(1, l.parallel) }, l.slots ?? []) : { ...l, parallel: Math.max(1, Math.min(l.parallel, l.participants.length)) }
    updateCalendar(c.id, (cal) => ({ ...cal, layers: layer ? cal.layers.map((x) => (x.id === l.id ? fixed : x)) : [...cal.layers, fixed] }))
    // дальше — «Проверка перед запуском»; без неё просто сообщаем, что график сохранён
    if (onSaved) onSaved()
    else toast(`График «${l.name}» сохранён`)
    onClose()
  }
  const preview = useMemo(() => {
    const free = { ...l, restriction: { ...l.restriction, type: 'none' as const } }
    return Array.from({ length: 6 }, (_, i) => {
      const start = layerBoundary(l, i, tz)
      return { start, end: layerBoundary(l, i + 1, tz), ids: layerOnCall(free, start + 1, tz) }
    })
  }, [l, tz])
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const firstStart = layerAnchor(l, tz)
  const pastStart = !layer && firstStart < opened - HOUR
  const startField = (
    <Field label="С какой даты команда начинает дежурить?" error={err('start')}
      hint={manual ? 'До этой даты календарь «ещё не запущен»: это не считается дырой.' : `Первая смена: ${fmtDT(firstStart, tz)} ${tzLabel(tz)}. До неё календарь «ещё не запущен» — это не дыра.`}>
      <input type="date" data-testid="start-date" className={`${inputCls} max-w-56`} value={l.startsAt} onChange={(e) => { setStartTouched(true); set({ startsAt: e.target.value }) }} />
      {pastStart && (
        <p role="status" data-testid="start-past" className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-ink">
          Дата в прошлом: график будет считаться так, будто дежурства уже идут с {fmtDT(firstStart, tz)}.{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => { setStartTouched(false); set({ startsAt: defaultStartDate(l.handoffTime, Date.now(), tz) }) }}>Начать с ближайшей передачи</button>
        </p>
      )}
    </Field>
  )
  // пересечения с другими дежурствами тех же людей — на последнем шаге
  const conflictWindow = useMemo(() => {
    const from = Math.max(Math.floor(opened / HOUR) * HOUR, Math.floor(Math.min(layerLaunch(l, tz), opened + 365 * 24 * HOUR) / HOUR) * HOUR)
    return { from, to: from + 28 * 24 * HOUR }
  }, [l, tz, opened])
  const conflicts = useMemo(() => (step === 4 ? layerConflicts(l, c, state.calendars, conflictWindow.from, conflictWindow.to) : []), [step, l, c, state.calendars, conflictWindow])
  const active = templates.find((t) => t.id === tpl)
  const pattern = describePattern(l, (id) => state.people.find((p) => p.id === id)?.name ?? id)
  // ритм шаблона «N через M» получается только при нужной длине очереди
  const need = active && active.offCount && active.rotation.unit === l.rotation.unit && active.rotation.count === l.rotation.count
    ? queueSize({ ...active, parallel: Math.max(1, Math.min(l.parallel, Math.max(l.participants.length, 1))) }) : null
  const patternNote = (
    <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed">
      <div data-testid="pattern-line">{pattern.line}</div>
      {active && need && l.participants.length > 0 && l.participants.length !== need && (
        <div className="mt-1 text-muted">Чтобы вышло «{active.name.toLowerCase()}» при {Math.min(l.parallel, l.participants.length)} параллельно, в очереди нужно {need} человек (сейчас {l.participants.length}). Строка выше — фактический ритм.</div>
      )}
    </div>
  )

  return (
    <Modal title={layer ? l.name || 'График дежурств' : 'Добавить график дежурств'} onClose={onClose} wide>
      <div className="mb-6 flex items-center justify-between gap-4 text-sm">
        <div className="text-muted">Шаг {pos + 1} из {order.length} · {steps[step]}</div>
        <div className="flex gap-1">
          {order.map((i, k) => (
            <button key={steps[i]} aria-label={steps[i]} disabled={k > pos} onClick={() => k <= pos && setStep(i)} className={`h-1.5 w-6 rounded-full ${k === pos ? 'bg-accent' : k < pos ? 'bg-accent/40' : 'bg-surface-2'}`} />
          ))}
        </div>
      </div>
      <div ref={bodyRef}>
      {step === 0 && (
        <div className="space-y-6">
          <Field label="Как составляется график">
            {layer ? <p className="text-sm text-muted">{manual ? 'Ручной график — дежурства расставляются на вкладке «Расписание».' : 'Ротация — по очереди, автоматически.'}</p> : (
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Как составляется график">
                {([['rotation', 'Ротация', 'По очереди, автоматически: шаблон, участники, часы'], ['manual', 'Ручной график', 'Дежурства расставляете сами — по часам, на неделе']] as const).map(([m, t, d]) => (
                  <button key={m} type="button" data-testid={`mode-${m}`} aria-pressed={(m === 'manual') === manual} onClick={() => setMode(m)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm ${(m === 'manual') === manual ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
                    <span className="block font-medium">{t}</span><span className="block text-xs text-muted">{d}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          {!manual && <div data-testid="layer-templates">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Шаблоны</span>
            </div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {templates.map((t) => (
                <div key={t.id} data-testid="tpl-row" data-builtin={t.builtin ? 'true' : undefined} className={`flex items-center gap-2 pr-2 ${tpl === t.id ? 'bg-accent-soft ring-2 ring-inset ring-accent' : ''}`}>
                  <button type="button" aria-pressed={tpl === t.id} onClick={() => applyTpl(t)} className="flex min-w-0 flex-1 items-baseline justify-between gap-4 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                    <span className="font-medium">{t.name}{tpl === t.id ? <span className="ml-2 text-xs font-medium text-accent">Выбран</span> : null}</span>
                    <span className="text-right text-xs text-muted">{templateHint(t)}</span>
                  </button>
                </div>
              ))}
            </div>
            {active && <p className="mt-2 text-sm text-muted">Выбран шаблон «{active.name}».</p>}
          </div>}
          <Field label="Название графика" hint="Что покрывает график: основная смена, ночь, резерв. Если графиков в календаре несколько, это его слои." error={err('name')}>
            <input autoFocus data-testid="layer-name" className={inputCls} value={l.name} onChange={(e) => set({ name: e.target.value })} placeholder={manual ? 'Например: Вторая линия, смены 12 часов' : 'Например: Основная ротация разработки'} />
          </Field>
          <Field label="Тип дежурства">
            <div className="flex flex-wrap gap-1">
              {(['primary', 'secondary'] as LayerKind[]).map((k) => (
                <button key={k} type="button" aria-pressed={l.kind === k} onClick={() => set({ kind: k })} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${l.kind === k ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_META[k].color }} />{KIND_META[k].label}
                </button>
              ))}
            </div>
          </Field>
          {manual && (
            <Field label="Мест одновременно" hint="Сколько человек может дежурить в слое в одно и то же время. Пересечения сверх этого — с предупреждением.">
              <select data-testid="manual-parallel" className={`${inlineCls} w-28`} value={l.parallel} onChange={(e) => set({ parallel: +e.target.value })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </Field>
          )}
          {manual && startField}
        </div>
      )}
      {step === 1 && (
        <div className="space-y-6">
          {active && <p className="text-sm font-medium">Шаблон «{active.name}» выбран. Длительность можно поправить.</p>}
          {patternNote}
          <Field label="Длительность смены" error={err('count')}>
            <div className="mb-3 flex flex-wrap gap-2">
              {[['day', 1, 'Сутки'], ['day', 2, '2 суток'], ['day', 3, '3 суток'], ['week', 1, 'Неделя'], ['week', 2, '2 недели'], ['week', 4, '4 недели']].map(([u, n, lbl]) => (
                <button key={String(lbl)} type="button" aria-pressed={l.rotation.unit === u && l.rotation.count === n} onClick={() => set({ rotation: { unit: u as 'day' | 'week', count: n as number } })} className={`rounded-full px-3 py-1 text-sm ${l.rotation.unit === u && l.rotation.count === n ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">каждые
              <input type="number" aria-label="Длительность смены, число" aria-invalid={tried === step && !!stepErrors.count} min={1} max={52} className={`${inlineCls} w-20`} value={l.rotation.count} onChange={(e) => set({ rotation: { ...l.rotation, count: Math.max(1, +e.target.value) } })} />
              <select aria-label="Единица длительности" className={`${inlineCls} w-28`} value={l.rotation.unit} onChange={(e) => set({ rotation: { ...l.rotation, unit: e.target.value as 'day' | 'week' } })}><option value="day">сут.</option><option value="week">нед.</option></select>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={`Передача смены, ${tzLabel(tz)}`}><input type="time" className={inputCls} value={l.handoffTime} onChange={(e) => set({ handoffTime: e.target.value })} /></Field>
          </div>
          {startField}
        </div>
      )}
      {step === 2 && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium">Участники</div>
            {active && need && <p className="mb-2 text-xs text-muted">Для «{active.name.toLowerCase()}» на {Math.min(l.parallel, Math.max(l.participants.length, 1)) > 1 ? `${Math.min(l.parallel, l.participants.length)} места` : 'одно место'} нужно {need} человек.</p>}
            <PersonPicker testId="wizard-add" aria-invalid={tried === step && !!stepErrors.participants} addMode people={state.people} exclude={l.participants} teamFirst={teamIds} teamLabel={`Команда «${c.team}»`} value="" onChange={(id) => id && toggle(id)} aria-label="Добавить участника" />
            {teamIds.length > 0 && (
              <div className="mt-3 max-h-72 overflow-y-auto pr-1 scroll-thin">
                <div className="mb-1 text-xs text-faint">Команда «{c.team}»</div>
                {teamIds.slice(0, 30).map((id) => byId.get(id)).filter((p) => !!p).map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" checked={l.participants.includes(p.id)} onChange={() => toggle(p.id)} />
                    <Avatar p={p} size={22} /> {p.name}
                  </label>
                ))}
              </div>
            )}
            {err('participants') && <p role="alert" className="mt-2 text-xs text-danger">{err('participants')}</p>}
            <p className="mt-2 text-xs text-muted">Коллег из других команд найдите через поиск: имя, telegram или подразделение.</p>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Порядок очереди</div>
            <ol className="space-y-1">
              {l.participants.map((id, i) => {
                const p = byId.get(id)
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm">
                    <span className="w-4 text-faint">{i + 1}</span><Avatar p={p} size={22} /><span className="flex-1">{p?.name ?? id}</span>
                    <button onClick={() => move(i, -1)} className="px-1 text-faint hover:text-ink" aria-label={`Выше: ${p?.name ?? ''}`}>↑</button>
                    <button onClick={() => move(i, 1)} className="px-1 text-faint hover:text-ink" aria-label={`Ниже: ${p?.name ?? ''}`}>↓</button>
                    <button onClick={() => toggle(id)} className="px-1 text-faint hover:text-danger" aria-label={`Убрать: ${p?.name ?? ''}`}>×</button>
                  </li>
                )
              })}
            </ol>
            <div className="mt-6">
              <Field label="Сколько человек одновременно" hint="Для второй группы добавьте ещё один график дежурств.">
                <p className="mb-2 text-sm font-medium" data-testid="parallel-state">Выбрано: {l.parallel} одновременно</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => {
                    const blocked = n > Math.max(l.participants.length, 0)
                    return (
                      <button key={n} type="button" data-testid={`parallel-${n}`} aria-pressed={l.parallel === n} disabled={blocked} title={blocked ? `Отметьте минимум ${n} участников` : `Одновременно ${n}`} onClick={() => set({ parallel: n })} className={`h-9 w-9 rounded-lg text-sm font-medium ring-offset-2 ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 ${l.parallel === n ? 'bg-accent text-white ring-2 ring-accent' : 'bg-surface-2 text-ink'}`}>{n}</button>
                    )
                  })}
                </div>
                {[1, 2, 3, 4, 5].some((n) => n > l.participants.length) && (
                  <p className="mt-2 text-xs text-muted" data-testid="parallel-hint">
                    Кнопки {[1, 2, 3, 4, 5].filter((n) => n > l.participants.length).join(', ')} недоступны: отметьте минимум {[1, 2, 3, 4, 5].find((n) => n > l.participants.length)} участников.
                  </p>
                )}
              </Field>
              <div className="mt-4">{patternNote}</div>
            </div>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-6">
          {active && <p className="text-sm text-muted">Часы из шаблона «{active.name}».</p>}
          <Field label="Когда график активен" hint="Вне этих часов работают другие графики календаря." error={err('days')}>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {([['none', 'Круглосуточно', '24×7'], ['daily', 'Каждый день', 'в заданные часы'], ['weekly', 'По дням недели', 'например, выходные']] as const).map(([v, a, b]) => (
                <button key={v} type="button" aria-pressed={l.restriction.type === v} onClick={() => set({ restriction: { ...l.restriction, type: v } })} className={`rounded-lg border px-3 py-2 text-left ${l.restriction.type === v ? 'border-accent bg-accent-soft' : 'border-line'}`}><span className="font-medium">{a}</span><div className="text-xs text-muted">{b}</div></button>
              ))}
            </div>
          </Field>
          {l.restriction.type !== 'none' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="С"><input type="time" className={inputCls} value={l.restriction.from} onChange={(e) => set({ restriction: { ...l.restriction, from: e.target.value } })} /></Field>
              <Field label="До" hint="Если «до» раньше «с» — окно через полночь."><input type="time" className={inputCls} value={l.restriction.to} onChange={(e) => set({ restriction: { ...l.restriction, to: e.target.value } })} /></Field>
            </div>
          )}
          {l.restriction.type === 'weekly' && (
            <div className="flex gap-2">
              {dayNames.map((d, i) => (
                <button key={d} type="button" data-invalid={tried === step && !!stepErrors.days && i === 0 ? 'true' : undefined} aria-pressed={l.restriction.days.includes(i)} onClick={() => set({ restriction: { ...l.restriction, days: l.restriction.days.includes(i) ? l.restriction.days.filter((x) => x !== i) : [...l.restriction.days, i] } })}
                  className={`h-9 w-11 rounded-lg text-sm ${l.restriction.days.includes(i) ? 'bg-accent text-white' : 'bg-surface-2 text-muted'}`}>{d}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {step === 4 && manual && (
        <div className="space-y-3 text-sm" data-testid="manual-summary">
          <div className="flex flex-wrap items-center gap-3"><span className="text-base font-medium">{l.name}</span><KindMark k={l.kind} /></div>
          <p>Ручной график · мест одновременно: {l.parallel} · {tzLabel(tz)}</p>
          <p className="text-muted">Автоматической ротации нет. После сохранения откройте «Расписание»: протяните по строке слоя, чтобы выбрать часы, или нажмите на пустое место — и выберите дежурного. «Скопировать неделю» и «Повторить на N недель» — в меню слоя.</p>
          {!!l.slots?.length && <p className="text-muted">Дежурств в графике: {l.slots.length}</p>}
          <ConflictList items={conflicts} tz={tz} from={conflictWindow.from} />
        </div>
      )}
      {step === 4 && !manual && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3"><span className="text-base font-medium">{l.name}</span><KindMark k={l.kind} /></div>
          {active && <p className="font-medium">Шаблон «{active.name}» выбран · одновременно {l.parallel}</p>}
          <p className="text-muted">{rotationLabel(l)}, передача в {l.handoffTime} {tzLabel(tz)}</p>
          {patternNote}
          <div className="space-y-1">
            {preview.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg px-1 py-1.5">
                <span className="w-72 text-muted">{fmtDT(r.start, tz)} — {fmtDT(r.end, tz)}</span>
                <span className="flex flex-wrap gap-3">{r.ids.map((id) => { const p = byId.get(id)!; return <span key={id} className="flex items-center gap-1.5"><Avatar p={p} size={20} />{p.name}</span> })}</span>
              </div>
            ))}
          </div>
          <p className="text-muted">Старт: {fmtDT(firstStart, tz)} {tzLabel(tz)}{pastStart ? ' — дата в прошлом' : ''}</p>
          <ConflictList items={conflicts} tz={tz} from={conflictWindow.from} />
        </div>
      )}
      {tried === step && <div className="mt-4"><FormErrors missing={Object.values(stepErrors).map((e) => e!.label)} /></div>}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <Btn variant="ghost" onClick={back}>{pos ? 'Назад' : 'Отмена'}</Btn>
        <div className="flex gap-2">
          {pos < order.length - 1 ? <Btn data-testid="wizard-next" onClick={next}>Далее</Btn> : <Btn data-testid="wizard-save" onClick={save}>{conflicts.length ? 'Сохранить, несмотря на пересечения' : 'Сохранить график'}</Btn>}
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- «Назначить дежурство» (лид и руководитель) ---------------- */
export interface AssignInit {
  /** редактируем существующую смену */
  shift?: Shift
  personId?: string
  replacesPersonId?: string
  start?: number
  end?: number
  /** «Поставить дежурного» в пустой слот */
  fill?: boolean
}


export function AssignDutyModal({ c, init, onClose }: { c: Calendar; init?: AssignInit; onClose: () => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)
  const tz = c.timezone || DEFAULT_TZ
  const zl = tzLabel(tz)
  const uidBase = useId()
  const errId = `${uidBase}-err`
  const editing = init?.shift
  const defaults = useMemo(() => {
    const now = Date.now()
    if (editing) return { s: +new Date(editing.start), e: +new Date(editing.end) }
    if (init?.start != null && init?.end != null) {
      // уже идущий слот (дыра, замена) — с текущей минуты, чтобы дежурный появился сразу
      const s = Math.max(init.start, now - (now % 60_000))
      return { s, e: init.fill && init.end > s ? init.end : Math.max(init.end, s + HOUR) }
    }
    const tomorrow = addDays(startOfDay(now, tz), 1, tz)
    const h = Math.floor(hm(c.layers[0]?.handoffTime ?? '10:00') / 60)
    return { s: atHour(tomorrow, h, tz), e: atHour(addDays(tomorrow, 1, tz), h, tz) }
  }, [editing, init?.start, init?.end, init?.fill, tz, c.layers])
  const [personId, setPersonId] = useState(editing?.personId ?? init?.personId ?? '')
  const [start, setStart] = useState(toInputTz(defaults.s, tz))
  const [end, setEnd] = useState(toInputTz(defaults.e, tz))
  const initReplaces = editing ? editing.replacesPersonId ?? '' : init?.replacesPersonId ?? ''
  const [mode, setMode] = useState<'add' | 'replace'>(initReplaces ? 'replace' : 'add')
  const [replaces, setReplaces] = useState(initReplaces)
  const [note, setNote] = useState(editing?.note ?? '')
  // дыру можно закрыть записью в слой с ручным графиком, а не разовым дежурством
  const manualLayers = editing ? [] : c.layers.filter((l) => l.mode === 'manual')
  const [into, setInto] = useState(init?.fill && manualLayers.length ? manualLayers[0].id : '')
  const intoLayer = mode === 'add' ? manualLayers.find((l) => l.id === into) : undefined
  const sT = fromInputTz(start, tz)
  const eT = fromInputTz(end, tz)
  const empty = Number.isNaN(sT) || Number.isNaN(eT)
  // уже идущую смену можно править: проверяем только окончание
  const inPast = !empty && (editing ? eT <= Date.now() : sT < Date.now() - 5 * 60_000)
  const onCall = !empty ? calendarOnCall({ ...c, shifts: c.shifts.filter((x) => x.id !== editing?.id) }, Math.max(sT, Date.now()) + 1) : []
  const replaceOptions = [...new Set([...onCall.map((e) => e.personId), ...(initReplaces ? [initReplaces] : [])])].filter((id) => id !== personId)
  const name = (id?: string) => (id ? peopleById(state.people).get(id)?.name : '') ?? ''
  const teamFirst = useMemo(() => teamFirstIds(c, state.people), [c, state.people])
  // выбранный «кого заменить» мог выпасть из списка (например, выбрали его же дежурным) — тогда не отправляем
  const target = replaceOptions.includes(replaces) ? replaces : ''
  const error = !personId ? 'Выберите, кто дежурит' : empty ? 'Укажите начало и окончание' : eT <= sT ? 'Окончание раньше начала' : inPast ? 'Интервал уже прошёл — выберите будущее время'
    : mode === 'replace' && replaces && replaces === personId ? `${name(personId)} уже на этой смене — выберите другого дежурного`
    : mode === 'replace' && !target ? 'Выберите, кого заменить' : ''
  const valid = !error

  const submit = () => {
    if (!valid) return
    const replaces = target
    if (intoLayer) {
      const before = intoLayer.slots ?? []
      const slot = makeSlot({ personId, start: sT, end: eT, note: note || undefined })
      updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.map((l) => (l.id === intoLayer.id ? withSlots(l, [...(l.slots ?? []), slot]) : l)) }))
      sendTg({ toPersonId: personId, calendarId: c.id, kind: 'signup', text: `📅 Вас поставили на дежурство\nКалендарь: «${c.name}», слой «${intoLayer.name}»\nС ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${zl} (${fmtDur(eT - sT)})\nНазначил(а): ${me?.name ?? ''}` })
      toast(`${name(personId)} в графике «${intoLayer.name}»`, { label: 'Вернуть', onClick: () => updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.map((l) => (l.id === intoLayer.id ? withSlots(l, before) : l)) })) })
      onClose()
      return
    }
    let fresh: Shift
    try {
      fresh = makeShift({ personId, start: sT, end: eT, replacesPersonId: mode === 'replace' ? replaces : undefined, note: note || (mode === 'replace' ? `Замена: ${name(replaces)}` : 'Назначено лидом') })
    } catch (e) {
      toast(`Не удалось назначить: ${(e as Error).message}`)
      return
    }
    const shift = editing ? { ...fresh, id: editing.id, createdAt: editing.createdAt } : fresh
    updateCalendar(c.id, (cal) => upsertShift(cal, shift))
    const when = `С ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${zl} (${fmtDur(eT - sT)})`
    sendTg({ toPersonId: personId, calendarId: c.id, kind: 'signup', text: `📅 ${editing ? 'Ваше дежурство изменено' : 'Вас назначили на дежурство'}\nКалендарь: «${c.name}»\n${when}${mode === 'replace' ? `\nВместо: ${name(replaces)}` : ''}\nНазначил(а): ${me?.name ?? ''}` })
    if (mode === 'replace' && replaces) sendTg({ toPersonId: replaces, calendarId: c.id, kind: 'handover', text: `🔁 Вас заменяет ${name(personId)}\nКалендарь: «${c.name}»\n${when} — в это время алерты вам не придут.` })
    if (editing) {
      toast(`Смена обновлена: ${name(personId)}`, { label: 'Вернуть', onClick: () => updateCalendar(c.id, (cal) => upsertShift(cal, editing)) })
    } else {
      toast(`${name(personId)} ${mode === 'replace' ? `заменяет ${name(replaces)}` : 'назначен(а) на дежурство'}`, { label: 'Вернуть', onClick: () => updateCalendar(c.id, (cal) => ({ ...cal, shifts: cal.shifts.filter((x) => x.id !== shift.id) })) })
    }
    onClose()
  }

  return (
    <Modal title={editing ? 'Изменить смену' : mode === 'replace' && init?.replacesPersonId ? 'Заменить дежурного' : init?.fill ? 'Поставить дежурного' : 'Назначить дежурство'} onClose={onClose} wide>
      <div className="space-y-6">
        <p className="text-sm text-muted">Календарь «<span className="text-ink">{c.name}</span>». Человек получит уведомление в Telegram.</p>
        <Field label="Кто дежурит">
          <PersonPicker testId="assign-person" people={state.people} teamFirst={teamFirst} teamLabel="Команда календаря" value={personId} onChange={setPersonId} />
        </Field>
        <Field label="Как">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'add' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Разово</span><div className="text-xs text-muted">в дополнение к ротации</div>
            </button>
            <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'replace' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Вместо дежурного</span><div className="text-xs text-muted">замена поверх смены</div>
            </button>
          </div>
        </Field>
        {mode === 'add' && manualLayers.length > 0 && (
          <Field label="Куда записать">
            <select data-testid="assign-into" className={inputCls} value={into} onChange={(e) => setInto(e.target.value)}>
              {manualLayers.map((l) => <option key={l.id} value={l.id}>В ручной график «{l.name}»</option>)}
              <option value="">Разовым дежурством</option>
            </select>
          </Field>
        )}
        {mode === 'replace' && (
          <Field label="Кого заменить">
            <PersonPicker testId="assign-replaces" people={replaceOptions.map((id) => peopleById(state.people).get(id)).filter((p) => !!p)} value={target} onChange={setReplaces}
              note={(p) => onCall.find((e) => e.personId === p.id)?.layerName} placeholder="Кто дежурит в это время" />
          </Field>
        )}
        <Field label="Когда">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${uidBase}-start`} className="mb-1 block text-xs text-muted">Начало, {zl}</label>
              <input id={`${uidBase}-start`} type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} aria-describedby={error ? errId : undefined} />
            </div>
            <div>
              <label htmlFor={`${uidBase}-end`} className="mb-1 block text-xs text-muted">Окончание, {zl}</label>
              <input id={`${uidBase}-end`} type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby={error ? errId : undefined} />
            </div>
          </div>
        </Field>
        <Field label="Комментарий"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: отпуск, больничный, релиз" /></Field>
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="text-sm text-muted">{error ? <span id={errId} role="alert" className="text-danger">{error}</span> : <>{mode === 'replace' ? 'Замена' : intoLayer ? 'Ручной график' : 'Разовое'} · {fmtDur(eT - sT)} · с {fmtDT(sT, tz)} {zl}</>}</div>
          <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn onClick={submit} disabled={!valid}>{editing ? 'Сохранить' : init?.fill && mode === 'add' ? 'Поставить' : 'Назначить'}</Btn></div>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- «Снять с дежурства» (лид и руководитель) ---------------- */
export interface RemoveInit { personId: string; layerId?: string; start: number; end: number }

/**
 * Снять человека со смены ротации целиком или на часть времени. Замена не обязательна:
 * слот можно оставить пустым (с предупреждением о дыре) и поставить дежурного позже.
 */
export function RemoveDutyModal({ c, init, onClose, onReplace, onFill }: { c: Calendar; init: RemoveInit; onClose: () => void; onReplace: (x: AssignInit) => void; onFill: (x: AssignInit) => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const tz = c.timezone || DEFAULT_TZ
  const zl = tzLabel(tz)
  const uidBase = useId()
  const errId = `${uidBase}-err`
  const byId = peopleById(state.people)
  const name = (id?: string) => (id ? byId.get(id)?.name ?? '' : '')
  const me = byId.get(state.currentUserId ?? '')
  const layer = c.layers.find((l) => l.id === init.layerId)
  const [opened] = useState(() => Date.now())
  // уже идущую смену снимаем с текущей минуты
  const whole = { s: Math.max(init.start, opened - (opened % 60_000)), e: init.end }
  const [scope, setScope] = useState<'all' | 'part'>('all')
  const [start, setStart] = useState(toInputTz(whole.s, tz))
  const [end, setEnd] = useState(toInputTz(whole.e, tz))
  const [note, setNote] = useState('')
  const [fillId, setFillId] = useState('')
  const [everywhere, setEverywhere] = useState(true)
  const sT = scope === 'all' ? whole.s : fromInputTz(start, tz)
  const eT = scope === 'all' ? whole.e : fromInputTz(end, tz)
  const empty = Number.isNaN(sT) || Number.isNaN(eT)
  const error = empty ? 'Укажите начало и окончание' : eT <= sT ? 'Окончание раньше начала'
    : eT <= Date.now() ? 'Интервал уже прошёл' : (sT < whole.s - 60_000 || eT > whole.e) ? 'Интервал должен быть внутри смены'
    : fillId && fillId === init.personId ? 'Нельзя поставить того же человека' : ''
  const teamFirst = useMemo(() => teamFirstIds(c, state.people), [c, state.people])
  // человек может дежурить в этом интервале ещё и в других слоях календаря
  const otherLayers = useMemo(() => {
    if (!init.layerId || empty || eT <= sT) return []
    return c.layers.filter((l) => {
      if (l.id === init.layerId || !l.participants.includes(init.personId)) return false
      for (let t = sT; t < eT; t += HOUR / 4) if (layerOnCall(l, t + 1, tz).includes(init.personId)) return true
      return false
    })
  }, [c.layers, init.layerId, init.personId, sT, eT, empty, tz])
  const scopeLayer = otherLayers.length && everywhere ? undefined : init.layerId
  const planned = useMemo(() => {
    if (error) return null
    const removal = makeRemoval({ personId: init.personId, layerId: scopeLayer, start: sT, end: eT, note })
    const fill = fillId ? makeShift({ personId: fillId, start: sT, end: eT, note: `Вместо ${name(init.personId)} (снят)` }) : null
    return { removal, fill }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, init.personId, scopeLayer, sT, eT, note, fillId])
  const gap = useMemo(() => (planned ? addGap(c, [planned.removal, ...(planned.fill ? [planned.fill] : [])], Date.now()) : null), [c, planned])

  const submit = () => {
    if (!planned) return
    const { removal, fill } = planned
    updateCalendar(c.id, (cal) => ({ ...cal, shifts: [...cal.shifts, removal, ...(fill ? [fill] : [])] }))
    const when = `С ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${zl} (${fmtDur(eT - sT)})`
    sendTg({ toPersonId: init.personId, calendarId: c.id, kind: 'handover', text: `🚫 Вас сняли с дежурства\nКалендарь: «${c.name}»\n${when} — в это время алерты вам не придут.${note ? `\nПричина: ${note}` : ''}${fill ? `\nДежурит: ${name(fill.personId)}` : ''}\nСнял(а): ${me?.name ?? ''}` })
    if (fill) sendTg({ toPersonId: fill.personId, calendarId: c.id, kind: 'signup', text: `📅 Вас поставили на дежурство\nКалендарь: «${c.name}»\n${when}\nВместо: ${name(init.personId)}\nНазначил(а): ${me?.name ?? ''}` })
    const ids = [removal.id, fill?.id]
    const undo = { label: 'Вернуть', onClick: () => updateCalendar(c.id, (cal) => ({ ...cal, shifts: cal.shifts.filter((x) => !ids.includes(x.id)) })) }
    const text = `${name(init.personId)} снят(а) с дежурства${fill ? `, дежурит ${name(fill.personId)}` : gap ? ' — слот пустой' : ''}`
    toast(text, fill ? undo : [undo, { label: 'Поставить другого', onClick: () => onFill({ start: sT, end: eT, fill: true }) }])
    onClose()
  }

  const opt = (on: boolean) => `rounded-lg border px-3 py-2 text-left ${on ? 'border-accent bg-accent-soft' : 'border-line'}`
  return (
    <Modal title="Снять с дежурства" onClose={onClose} describedBy={gap && !fillId ? `${uidBase}-gap` : undefined}>
      <div className="space-y-5">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{name(init.personId)}</span> · {c.name}{layer ? ` · ${layer.name}` : ''}. Человек получит уведомление в Telegram.
        </p>
        <Field label="Когда">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button type="button" data-testid="remove-whole" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className={opt(scope === 'all')}>
                <span className="font-medium">Вся смена</span><div className="text-xs text-muted">{fmtDT(whole.s, tz)} — {fmtDT(whole.e, tz)}</div>
              </button>
              <button type="button" data-testid="remove-part" aria-pressed={scope === 'part'} onClick={() => setScope('part')} className={opt(scope === 'part')}>
                <span className="font-medium">Часть смены</span><div className="text-xs text-muted">выбрать время</div>
              </button>
            </div>
            {scope === 'part' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`${uidBase}-s`} className="mb-1 block text-xs text-muted">С, {zl}</label>
                  <input id={`${uidBase}-s`} data-testid="remove-start" type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} aria-describedby={error ? errId : undefined} />
                </div>
                <div>
                  <label htmlFor={`${uidBase}-e`} className="mb-1 block text-xs text-muted">По, {zl}</label>
                  <input id={`${uidBase}-e`} data-testid="remove-end" type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby={error ? errId : undefined} />
                </div>
              </div>
            )}
          </div>
        </Field>
        {otherLayers.length > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <input type="checkbox" data-testid="remove-everywhere" className="mt-0.5" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            <span>Снять и из других слоёв: {otherLayers.map((l) => `«${l.name}»`).join(', ')}<span className="block text-xs text-muted">в это время {name(init.personId)} дежурит и там</span></span>
          </label>
        )}
        <Field label="Причина (необязательно)"><input className={inputCls} data-testid="remove-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: больничный, отпуск" /></Field>
        <Field label="Сразу поставить (необязательно)" hint="Можно оставить пустым и поставить дежурного позже — кликом по дыре на таймлайне.">
          <PersonPicker testId="remove-fill" people={state.people} teamFirst={teamFirst} teamLabel="Команда календаря" value={fillId} onChange={setFillId}
            exclude={[init.personId]} emptyLabel="Никого — оставить слот пустым" placeholder="Никого — оставить слот пустым" />
        </Field>
        {gap && !fillId && (
          <div id={`${uidBase}-gap`} data-testid="gap-warning" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm">
            <p className="leading-relaxed text-danger">После снятия в календаре «{c.name}» никто не дежурит: {fmtDT(gap.start, tz)} — {fmtDT(gap.end, tz)} {zl}. Алерты уровня 1 в это время никому не придут.</p>
            <p className="mt-1.5 text-muted">
              Можно оставить слот пустым или{' '}
              <button type="button" className="font-medium text-accent hover:underline" data-testid="remove-to-replace" onClick={() => { onClose(); onReplace({ replacesPersonId: init.personId, start: sT, end: eT }) }}>заменить дежурного</button>.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="text-sm text-muted">{error ? <span id={errId} role="alert" className="text-danger">{error}</span> : <>{fmtDur(eT - sT)} · с {fmtDT(sT, tz)} {zl}</>}</div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
            <Btn variant={gap && !fillId ? 'danger' : 'primary'} onClick={submit} className="whitespace-nowrap" disabled={!!error}>{fillId ? 'Снять и поставить' : gap ? 'Снять и оставить пустым' : 'Снять с дежурства'}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Ручной график: дежурство в слое ---------------- */
export interface SlotInit { layerId: string; start?: number; end?: number; slotId?: string }

/** Ошибки формы дежурства ручного графика. */
export function slotErrors(x: { personId: string; start: number; end: number }) {
  const e: Partial<Record<'person' | 'start' | 'end', { label: string; message: string }>> = {}
  if (!x.personId) e.person = { label: 'кто дежурит', message: 'Выберите, кто дежурит' }
  if (Number.isNaN(x.start)) e.start = { label: 'начало', message: 'Укажите дату и время начала' }
  if (Number.isNaN(x.end)) e.end = { label: 'окончание', message: 'Укажите дату и время окончания' }
  else if (!Number.isNaN(x.start) && x.end <= x.start) e.end = { label: 'окончание', message: 'Окончание должно быть позже начала' }
  return e
}

export function SlotModal({ c, init, onClose }: { c: Calendar; init: SlotInit; onClose: () => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const tz = c.timezone || DEFAULT_TZ
  const layer = c.layers.find((l) => l.id === init.layerId)
  const editing = layer?.slots?.find((x) => x.id === init.slotId)
  const [personId, setPersonId] = useState(editing?.personId ?? '')
  const [start, setStart] = useState(() => toInputTz(editing ? +new Date(editing.start) : init.start ?? Date.now(), tz))
  const [end, setEnd] = useState(() => toInputTz(editing ? +new Date(editing.end) : init.end ?? Date.now() + HOUR, tz))
  const [note, setNote] = useState(editing?.note ?? '')
  const [tried, setTried] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const teamFirst = useMemo(() => teamFirstIds(c, state.people), [c, state.people])
  if (!layer) return null
  const sT = fromInputTz(start, tz), eT = fromInputTz(end, tz)
  const errs = slotErrors({ personId, start: sT, end: eT })
  const warn = !Object.keys(errs).length ? overlapWarning(layer, personId, sT, eT, editing?.id) : null
  const name = (id: string) => state.people.find((p) => p.id === id)?.name ?? ''
  const apply = (fn: (l: Layer) => Layer) => updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.map((l) => (l.id === layer.id ? fn(l) : l)) }))
  const before = layer.slots ?? []
  const undo = () => apply((l) => withSlots(l, before))
  const save = () => {
    if (Object.keys(errs).length) { setTried(true); focusFirstInvalid(bodyRef.current); return }
    const slot = makeSlot({ id: editing?.id, personId, start: sT, end: eT, note: note.trim() || undefined })
    apply((l) => withSlots(l, [...(l.slots ?? []).filter((x) => x.id !== slot.id), slot]))
    sendTg({ toPersonId: personId, calendarId: c.id, kind: 'signup', text: `📅 ${editing ? 'Ваше дежурство изменено' : 'Вас поставили на дежурство'}\nКалендарь: «${c.name}», слой «${layer.name}»\nС ${fmtDT(sT, tz)} по ${fmtDT(eT, tz)} ${tzLabel(tz)} (${fmtDur(eT - sT)})` })
    toast(`${editing ? 'Дежурство изменено' : 'Дежурство добавлено'}: ${name(personId)}`, { label: 'Вернуть', onClick: undo })
    onClose()
  }
  const del = () => {
    if (!editing) return
    apply((l) => withSlots(l, (l.slots ?? []).filter((x) => x.id !== editing.id)))
    toast(`Дежурство удалено: ${name(editing.personId)}`, { label: 'Вернуть', onClick: undo })
    onClose()
  }
  const err = (k: keyof typeof errs) => (tried ? errs[k]?.message : undefined)
  return (
    <Modal title={editing ? 'Дежурство' : 'Новое дежурство'} onClose={onClose} wide>
      <div ref={bodyRef} className="space-y-5" data-testid="slot-modal">
        <p className="text-sm text-muted">Слой «<span className="text-ink">{layer.name}</span>» — ручной график, {tzLabel(tz)}.</p>
        <Field label="Кто дежурит" error={err('person')}>
          <PersonPicker testId="slot-person" people={state.people} teamFirst={teamFirst} teamLabel="Команда календаря" value={personId} onChange={setPersonId} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="С" error={err('start')}>
            <input data-testid="slot-start" type="datetime-local" step={3600} className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="По" error={err('end')}>
            <input data-testid="slot-end" type="datetime-local" step={3600} className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {!Object.keys(errs).length && <p className="text-sm text-muted">Длительность: {fmtDur(eT - sT)}</p>}
        <Field label="Комментарий" hint="Необязательно">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: за Ивана, он в отпуске" />
        </Field>
        {warn && <p role="status" data-testid="slot-overlap" className="tint-warn rounded-lg px-3 py-2 text-sm">{warn}. Можно сохранить, если так и задумано.</p>}
        {tried && <FormErrors missing={Object.values(errs).map((e) => e!.label)} />}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div>{editing && <Btn variant="danger" data-testid="slot-delete" onClick={del}>Удалить</Btn>}</div>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
          <Btn data-testid="slot-save" onClick={save}>{editing ? 'Сохранить' : 'Добавить'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

/** «Повторить неделю на N недель» для слоя с ручным графиком. */
export function RepeatWeekModal({ c, layerId, ws, onClose }: { c: Calendar; layerId: string; ws: number; onClose: () => void }) {
  const { updateCalendar, toast } = useStore()
  const tz = c.timezone || DEFAULT_TZ
  const [n, setN] = useState(4)
  const layer = c.layers.find((l) => l.id === layerId)
  if (!layer) return null
  const we = addDays(ws, 7, tz)
  const count = manualSlots(layer).filter((x) => x.start >= ws && x.start < we).length
  const ok = n >= 1 && n <= 26
  const run = () => {
    if (!ok) return
    const before = layer.slots ?? []
    let added = 0
    updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.map((l) => { if (l.id !== layerId) return l; const r = repeatSlots(l, ws, we, n, tz); added = r.added; return r.layer }) }))
    toast(added ? `Неделя повторена на ${n} нед.: +${added} дежурств` : 'Всё уже есть — нечего добавлять', { label: 'Вернуть', onClick: () => updateCalendar(c.id, (cal) => ({ ...cal, layers: cal.layers.map((l) => (l.id === layerId ? withSlots(l, before) : l)) })) })
    onClose()
  }
  return (
    <Modal title="Повторить неделю" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Слой «<span className="text-ink">{layer.name}</span>»: {count} дежурств недели {fmtDT(ws, tz).split(',')[0]} – {fmtDT(addDays(ws, 6, tz), tz).split(',')[0]} повторятся на следующие недели. Совпадающие дежурства не дублируются.</p>
        <Field label="Сколько недель" error={ok ? undefined : 'От 1 до 26'}>
          <input data-testid="repeat-weeks" type="number" min={1} max={26} className={`${inlineCls} w-24`} value={n} onChange={(e) => setN(Math.floor(Number(e.target.value)))} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
        <Btn data-testid="repeat-run" onClick={run} disabled={!ok || !count}>Повторить</Btn>
      </div>
    </Modal>
  )
}
