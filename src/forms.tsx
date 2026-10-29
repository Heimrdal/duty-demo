import { useMemo, useState } from 'react'
import { addDays, calendarOnCall, describePattern, fmtDT, fmtDur, isoDate, layerAnchor, layerOnCall, periodMs, rotationLabel, startOfDay, uid } from './engine'
import { useStore } from './store'
import { Avatar, Btn, Field, inputCls, KIND_META, KindMark, Modal } from './ui'
import type { Calendar, Layer, LayerKind, Restriction } from './types'

const toLocalInput = (d: Date) => `${isoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const mondayOf = (d: Date) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)) }
const noneR = (): Restriction => ({ type: 'none', from: '00:00', to: '00:00', days: [] })

interface Tpl { id: string; name: string; hint: string; patch: (today: Date) => Partial<Layer> }

const TEMPLATES: Tpl[] = [
  {
    id: 'sutki', name: 'Сутки через трое', hint: 'Сутки в очереди из четырёх, передача в 09:00',
    patch: (today) => ({ kind: 'primary', startsAt: isoDate(today), handoffTime: '09:00', rotation: { unit: 'day', count: 1 }, parallel: 1, restriction: noneR() }),
  },
  {
    id: 'dev-week', name: 'Неделя разработки', hint: 'Неделя, передача в понедельник в 10:00',
    patch: () => ({ kind: 'primary', startsAt: isoDate(mondayOf(new Date())), handoffTime: '10:00', rotation: { unit: 'week', count: 1 }, parallel: 1, restriction: noneR() }),
  },
  {
    id: 'two-two', name: '2/2 по 12 часов', hint: 'Двое суток, окно 09:00–21:00',
    patch: (today) => ({ kind: 'business', startsAt: isoDate(today), handoffTime: '09:00', rotation: { unit: 'day', count: 2 }, parallel: 1, restriction: { type: 'daily', from: '09:00', to: '21:00', days: [] } }),
  },
  {
    id: 'weekends', name: 'Только выходные', hint: 'Суббота и воскресенье, круглосуточно',
    patch: () => ({ kind: 'night', startsAt: isoDate(mondayOf(new Date())), handoffTime: '00:00', rotation: { unit: 'week', count: 1 }, parallel: 1, restriction: { type: 'weekly', from: '00:00', to: '00:00', days: [5, 6] } }),
  },
  {
    id: 'office', name: 'Рабочие часы 9-18', hint: 'Понедельник–пятница, 09:00–18:00',
    patch: () => ({ kind: 'business', startsAt: isoDate(mondayOf(new Date())), handoffTime: '09:00', rotation: { unit: 'week', count: 1 }, parallel: 1, restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } }),
  },
]

/* ---------------- «Взять дежурство» ---------------- */
function preferredCalendars(calendars: Calendar[], userId: string, team: string, pinned?: string) {
  const mine = calendars.filter((c) => c.id === pinned || c.team === team || c.ownerId === userId || c.layers.some((l) => l.participants.includes(userId)))
  const base = mine.length ? mine : calendars
  const newest = [...base].reverse()
  if (!pinned) return newest
  const hit = newest.find((c) => c.id === pinned)
  return hit ? [hit, ...newest.filter((c) => c.id !== pinned)] : newest
}

export function TakeDutyModal({ calendarId, onClose }: { calendarId?: string; onClose: () => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const ordered = preferredCalendars(state.calendars, me.id, me.team, calendarId)
  const [calId, setCalId] = useState(ordered[0]?.id ?? '')
  const c = state.calendars.find((x) => x.id === calId)!
  const today = startOfDay(new Date())
  const presets = useMemo(() => {
    const now = Date.now()
    const sat0 = addDays(today, (5 - ((today.getDay() + 6) % 7) + 7) % 7)
    const sat = sat0.getTime() <= now ? addDays(sat0, 7) : sat0
    const mon = addDays(today, 7 - ((today.getDay() + 6) % 7))
    const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x }
    const todayStart = at(today, 10)
    const list = [
      { label: 'Завтра (сутки)', s: at(addDays(today, 1), 10), e: at(addDays(today, 2), 10) },
      { label: 'Ближайшие выходные', s: at(sat, 0), e: at(addDays(sat, 2), 0) },
      { label: 'Следующая неделя', s: at(mon, 10), e: at(addDays(mon, 7), 10) },
      { label: '2 недели (для разработки)', s: at(mon, 10), e: at(addDays(mon, 14), 10) },
    ]
    if (todayStart.getTime() > now) list.unshift({ label: 'Сутки с сегодня 10:00', s: todayStart, e: at(addDays(today, 1), 10) })
    return list.filter((p) => p.s.getTime() > now)
  }, [today.getTime()]) // eslint-disable-line
  const [start, setStart] = useState(toLocalInput(presets[0].s))
  const [end, setEnd] = useState(toLocalInput(presets[0].e))
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [replaces, setReplaces] = useState('')
  const [note, setNote] = useState('')
  const sT = new Date(start).getTime()
  const eT = new Date(end).getTime()
  const inPast = sT < Date.now()
  const candidates = c ? calendarOnCall(c, Math.max(sT, Date.now()) + 1).filter((e) => e.personId !== me.id) : []
  const valid = c && eT > sT && !inPast && (mode === 'add' || replaces)

  const submit = () => {
    if (!valid) return
    updateCalendar(c.id, (cal) => ({
      ...cal,
      shifts: [...cal.shifts, { id: uid(), personId: me.id, start: new Date(sT).toISOString(), end: new Date(eT).toISOString(), replacesPersonId: mode === 'replace' ? replaces : undefined, note: note || (mode === 'replace' ? 'Подмена' : 'Взял(а) дежурство сам(а)'), createdAt: new Date().toISOString() }],
    }))
    sendTg({ toPersonId: me.id, calendarId: c.id, kind: 'signup', text: `✅ Вы записаны на дежурство\nКалендарь: «${c.name}»\nС ${fmtDT(sT)} по ${fmtDT(eT)} МСК (${fmtDur(eT - sT)})\nЗа 1 час до начала пришлю напоминание.` })
    if (mode === 'replace' && replaces) {
      sendTg({ toPersonId: replaces, calendarId: c.id, kind: 'handover', text: `🔁 Вас подменяет ${me.name}\nКалендарь: «${c.name}»\nС ${fmtDT(sT)} по ${fmtDT(eT)} МСК — в это время алерты вам не придут.` })
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
            {ordered.map((x) => (
              <button key={x.id} onClick={() => setCalId(x.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${x.id === calId ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
                <div className="font-medium">{x.name}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Когда">
          <div className="mb-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.label} onClick={() => { setStart(toLocalInput(p.s)); setEnd(toLocalInput(p.e)) }} className="rounded-full px-3 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
            <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </Field>
        <Field label="Как">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button onClick={() => setMode('add')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'add' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Дополнительно</span><div className="text-xs text-muted">параллельно с ротацией</div>
            </button>
            <button onClick={() => setMode('replace')} className={`rounded-lg border px-3 py-2 text-left ${mode === 'replace' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="font-medium">Подменить коллегу</span><div className="text-xs text-muted">override поверх смены</div>
            </button>
          </div>
        </Field>
        {mode === 'replace' && (
          <Field label="Кого подменяю">
            <select className={inputCls} value={replaces} onChange={(e) => setReplaces(e.target.value)}>
              <option value="">Выберите</option>
              {candidates.map((e) => <option key={e.personId} value={e.personId}>{state.people.find((p) => p.id === e.personId)?.name} · {e.layerName}</option>)}
            </select>
          </Field>
        )}
        <Field label="Комментарий"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: релиз 2.14, ночное окно" /></Field>
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="text-sm text-muted">{inPast ? <span className="text-danger">Начало уже в прошлом — выберите будущий интервал</span> : eT > sT ? <>{mode === 'replace' ? 'Подмена' : 'Разовое'} · {fmtDur(eT - sT)} · {fmtDT(sT)}</> : <span className="text-danger">Окончание раньше начала</span>}</div>
          <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn onClick={submit} disabled={!valid}>Взять дежурство</Btn></div>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Мастер слоя ротации ---------------- */
export function LayerWizard({ c, layer, onClose }: { c: Calendar; layer?: Layer; onClose: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const [step, setStep] = useState(0)
  const [tpl, setTpl] = useState<string | null>(null)
  const [l, setL] = useState<Layer>(layer ?? {
    id: uid(), name: '', kind: 'primary', startsAt: isoDate(new Date()), handoffTime: '10:00', rotation: { unit: 'week', count: 1 },
    participants: state.currentUserId ? [state.currentUserId] : [], parallel: 1, restriction: { type: 'none', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] },
  })
  const set = (patch: Partial<Layer>) => setL((x) => ({ ...x, ...patch }))
  const steps = ['Название и тип', 'Ротация', 'Участники', 'Часы дежурства', 'Проверка']
  const teams = [...new Set(state.people.map((p) => p.team))]
  const toggle = (id: string) => set({ participants: l.participants.includes(id) ? l.participants.filter((x) => x !== id) : [...l.participants, id] })
  const move = (i: number, d: number) => { const a = [...l.participants]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; set({ participants: a }) }
  const okStep = [l.name.trim().length > 0, l.rotation.count > 0, l.participants.length > 0, true, true][step]
  const applyTpl = (t: Tpl) => {
    const patch = t.patch(new Date())
    setL((x) => ({
      ...x,
      ...patch,
      name: !x.name.trim() || TEMPLATES.some((p) => p.name === x.name) ? t.name : x.name,
      rotation: patch.rotation ? { ...patch.rotation } : x.rotation,
      restriction: patch.restriction ? { ...patch.restriction, days: [...patch.restriction.days] } : x.restriction,
    }))
    setTpl(t.id)
  }
  const save = () => {
    const fixed = { ...l, parallel: Math.max(1, Math.min(l.parallel, l.participants.length)) }
    updateCalendar(c.id, (cal) => ({ ...cal, layers: layer ? cal.layers.map((x) => (x.id === l.id ? fixed : x)) : [...cal.layers, fixed] }))
    toast(layer ? 'Слой обновлён' : `Слой «${l.name}» добавлен в календарь «${c.name}»`)
    onClose()
  }
  const preview = useMemo(() => {
    const a = layerAnchor(l)
    const p = periodMs(l)
    return Array.from({ length: 6 }, (_, i) => ({ start: a + i * p, end: a + (i + 1) * p, ids: layerOnCall({ ...l, restriction: { ...l.restriction, type: 'none' } }, a + i * p + 1) }))
  }, [l])
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const active = TEMPLATES.find((t) => t.id === tpl)
  const pattern = describePattern(l, (id) => state.people.find((p) => p.id === id)?.name ?? id)
  const needForSutki = 4 * Math.max(1, Math.min(l.parallel, Math.max(l.participants.length, 1)))
  const sutkiMatches = l.rotation.unit === 'day' && l.rotation.count === 1 && pattern.regular && pattern.onPeriods === 1 && pattern.offPeriods === 3
  const patternNote = (
    <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed">
      <div data-testid="pattern-line">{pattern.line}</div>
      {tpl === 'sutki' && l.participants.length > 0 && !sutkiMatches && (
        <div className="mt-1 text-muted">Чтобы вышло «сутки через трое» при {Math.min(l.parallel, l.participants.length)} параллельно, в очереди нужно {needForSutki} человек. Строка выше — фактический ритм.</div>
      )}
    </div>
  )

  return (
    <Modal title={layer ? l.name || 'Слой' : 'Добавить ротацию'} onClose={onClose} wide>
      <div className="mb-6 flex items-center justify-between gap-4 text-sm">
        <div className="text-muted">Шаг {step + 1} из {steps.length} · {steps[step]}</div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button key={s} aria-label={s} disabled={i > step} onClick={() => i <= step && setStep(i)} className={`h-1.5 w-6 rounded-full ${i === step ? 'bg-accent' : i < step ? 'bg-accent/40' : 'bg-surface-2'}`} />
          ))}
        </div>
      </div>
      {step === 0 && (
        <div className="space-y-6">
          <div data-testid="layer-templates">
            <div className="mb-2 text-sm font-medium">Шаблоны</div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" aria-pressed={tpl === t.id} onClick={() => applyTpl(t)} className={`flex w-full items-baseline justify-between gap-4 px-3 py-2.5 text-left text-sm hover:bg-surface-2 ${tpl === t.id ? 'bg-accent-soft ring-2 ring-inset ring-accent' : ''}`}>
                  <span className="font-medium">{t.name}{tpl === t.id ? <span className="ml-2 text-xs font-medium text-accent">Выбран</span> : null}</span>
                  <span className="text-right text-xs text-muted">{t.hint}</span>
                </button>
              ))}
            </div>
            {active && <p className="mt-2 text-sm text-muted">Выбран шаблон «{active.name}».</p>}
          </div>
          <Field label="Название слоя" hint="Что покрывает слой: основная смена, ночь, резерв.">
            <input autoFocus className={inputCls} value={l.name} onChange={(e) => set({ name: e.target.value })} placeholder="Например: Основная ротация разработки" />
          </Field>
          <Field label="Тип дежурства">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(KIND_META).filter((k) => k !== 'override') as LayerKind[]).map((k) => (
                <button key={k} onClick={() => set({ kind: k })} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${l.kind === k ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_META[k].color }} />{KIND_META[k].label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-6">
          {active && <p className="text-sm font-medium">Шаблон «{active.name}» выбран. Длительность можно поправить.</p>}
          {patternNote}
          <Field label="Длительность смены">
            <div className="mb-3 flex flex-wrap gap-2">
              {[['day', 1, 'Сутки'], ['day', 2, '2 суток'], ['day', 3, '3 суток'], ['week', 1, 'Неделя'], ['week', 2, '2 недели'], ['week', 4, '4 недели']].map(([u, n, lbl]) => (
                <button key={String(lbl)} onClick={() => set({ rotation: { unit: u as 'day' | 'week', count: n as number } })} className={`rounded-full px-3 py-1 text-sm ${l.rotation.unit === u && l.rotation.count === n ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">каждые
              <input type="number" min={1} max={52} className={`${inputCls} w-20`} value={l.rotation.count} onChange={(e) => set({ rotation: { ...l.rotation, count: Math.max(1, +e.target.value) } })} />
              <select className={`${inputCls} w-28`} value={l.rotation.unit} onChange={(e) => set({ rotation: { ...l.rotation, unit: e.target.value as 'day' | 'week' } })}><option value="day">сут.</option><option value="week">нед.</option></select>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Начало ротации"><input type="date" className={inputCls} value={l.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
            <Field label="Передача смены, МСК"><input type="time" className={inputCls} value={l.handoffTime} onChange={(e) => set({ handoffTime: e.target.value })} /></Field>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium">Участники</div>
            {tpl === 'sutki' && <p className="mb-2 text-xs text-muted">Для «сутки через трое» на одно место обычно четверо. Шаблон выбран.</p>}
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1 scroll-thin">
              {teams.map((t) => (
                <div key={t}>
                  <div className="mb-1 text-xs text-faint">{t}</div>
                  {state.people.filter((p) => p.team === t).map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
                      <input type="checkbox" checked={l.participants.includes(p.id)} onChange={() => toggle(p.id)} />
                      <Avatar p={p} size={22} /> {p.name}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Порядок очереди</div>
            <ol className="space-y-1">
              {l.participants.map((id, i) => {
                const p = state.people.find((x) => x.id === id)!
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm">
                    <span className="w-4 text-faint">{i + 1}</span><Avatar p={p} size={22} /><span className="flex-1">{p.name}</span>
                    <button onClick={() => move(i, -1)} className="px-1 text-faint hover:text-ink" aria-label="Выше">↑</button>
                    <button onClick={() => move(i, 1)} className="px-1 text-faint hover:text-ink" aria-label="Ниже">↓</button>
                  </li>
                )
              })}
            </ol>
            <div className="mt-6">
              <Field label="Сколько человек одновременно" hint="Для второй группы заведите ещё один слой.">
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
          <Field label="Когда слой активен" hint="Вне этих часов работают другие слои календаря.">
            <div className="grid grid-cols-3 gap-2 text-sm">
              {([['none', 'Круглосуточно', '24×7'], ['daily', 'Каждый день', 'в заданные часы'], ['weekly', 'По дням недели', 'например, выходные']] as const).map(([v, a, b]) => (
                <button key={v} onClick={() => set({ restriction: { ...l.restriction, type: v } })} className={`rounded-lg border px-3 py-2 text-left ${l.restriction.type === v ? 'border-accent bg-accent-soft' : 'border-line'}`}><span className="font-medium">{a}</span><div className="text-xs text-muted">{b}</div></button>
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
                <button key={d} onClick={() => set({ restriction: { ...l.restriction, days: l.restriction.days.includes(i) ? l.restriction.days.filter((x) => x !== i) : [...l.restriction.days, i] } })}
                  className={`h-9 w-11 rounded-lg text-sm ${l.restriction.days.includes(i) ? 'bg-accent text-white' : 'bg-surface-2 text-muted'}`}>{d}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {step === 4 && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3"><span className="text-base font-medium">{l.name}</span><KindMark k={l.kind} /></div>
          {active && <p className="font-medium">Шаблон «{active.name}» выбран · одновременно {l.parallel}</p>}
          <p className="text-muted">{rotationLabel(l)}, передача в {l.handoffTime}</p>
          {patternNote}
          <div className="space-y-1">
            {preview.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg px-1 py-1.5">
                <span className="w-72 text-muted">{fmtDT(r.start)} — {fmtDT(r.end)}</span>
                <span className="flex flex-wrap gap-3">{r.ids.map((id) => { const p = state.people.find((x) => x.id === id)!; return <span key={id} className="flex items-center gap-1.5"><Avatar p={p} size={20} />{p.name}</span> })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-8 flex justify-between">
        <Btn variant="ghost" onClick={() => (step ? setStep(step - 1) : onClose())}>{step ? 'Назад' : 'Отмена'}</Btn>
        {step < steps.length - 1 ? <Btn disabled={!okStep} onClick={() => setStep(step + 1)}>Далее</Btn> : <Btn onClick={save}>Сохранить слой</Btn>}
      </div>
    </Modal>
  )
}
