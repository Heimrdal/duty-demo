import { useMemo, useState } from 'react'
import { addDays, calendarOnCall, fmtDT, fmtDur, isoDate, layerAnchor, layerOnCall, periodMs, rotationLabel, startOfDay, uid } from './engine'
import { useStore } from './store'
import { Avatar, Btn, Field, inputCls, KIND_META, KindBadge, Modal, TYPE_META } from './ui'
import type { Calendar, Layer, LayerKind } from './types'

const toLocalInput = (d: Date) => `${isoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/* ---------------- «Взять дежурство» ---------------- */
export function TakeDutyModal({ calendarId, onClose }: { calendarId?: string; onClose: () => void }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const [calId, setCalId] = useState(calendarId ?? state.calendars[0]?.id)
  const c = state.calendars.find((x) => x.id === calId)!
  const today = startOfDay(new Date())
  const presets = useMemo(() => {
    const sat = addDays(today, (5 - ((today.getDay() + 6) % 7) + 7) % 7)
    const mon = addDays(today, 7 - ((today.getDay() + 6) % 7))
    const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x }
    return [
      { label: 'Сутки с сегодня 10:00', s: at(today, 10), e: at(addDays(today, 1), 10) },
      { label: 'Завтра (сутки)', s: at(addDays(today, 1), 10), e: at(addDays(today, 2), 10) },
      { label: 'Ближайшие выходные', s: at(sat, 0), e: at(addDays(sat, 2), 0) },
      { label: 'Следующая неделя', s: at(mon, 10), e: at(addDays(mon, 7), 10) },
      { label: '2 недели (для разработки)', s: at(mon, 10), e: at(addDays(mon, 14), 10) },
    ]
  }, [today.getTime()]) // eslint-disable-line
  const [start, setStart] = useState(toLocalInput(presets[0].s))
  const [end, setEnd] = useState(toLocalInput(presets[0].e))
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [replaces, setReplaces] = useState('')
  const [note, setNote] = useState('')
  const sT = new Date(start).getTime()
  const eT = new Date(end).getTime()
  const candidates = c ? calendarOnCall(c, sT + 1).filter((e) => e.personId !== me.id) : []
  const valid = c && eT > sT && (mode === 'add' || replaces)

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
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm">
          <Avatar p={me} /> <div><b>{me.name}</b> — запись на себя. Выберите календарь и время, остальное сделаем мы.</div>
        </div>
        <Field label="Календарь">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {state.calendars.map((x) => (
              <button key={x.id} onClick={() => setCalId(x.id)} className={`rounded-lg border p-2 text-left text-sm ${x.id === calId ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="font-medium">{TYPE_META[x.type].icon} {x.name}</div>
                <div className="text-xs text-slate-500">{TYPE_META[x.type].label}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Когда">
          <div className="mb-2 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.label} onClick={() => { setStart(toLocalInput(p.s)); setEnd(toLocalInput(p.e)) }} className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
            <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </Field>
        <Field label="Как">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button onClick={() => setMode('add')} className={`rounded-lg border p-2 text-left ${mode === 'add' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
              <b>Дополнительно</b><div className="text-xs text-slate-500">дежурю параллельно с текущей ротацией</div>
            </button>
            <button onClick={() => setMode('replace')} className={`rounded-lg border p-2 text-left ${mode === 'replace' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
              <b>Подменить коллегу</b><div className="text-xs text-slate-500">override, как в OneUptime</div>
            </button>
          </div>
        </Field>
        {mode === 'replace' && (
          <Field label="Кого подменяю (дежурит в начале выбранного интервала)">
            <select className={inputCls} value={replaces} onChange={(e) => setReplaces(e.target.value)}>
              <option value="">— выберите —</option>
              {candidates.map((e) => <option key={e.personId} value={e.personId}>{state.people.find((p) => p.id === e.personId)?.name} · {e.layerName}</option>)}
            </select>
          </Field>
        )}
        <Field label="Комментарий (необязательно)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: релиз 2.14, ночное окно" /></Field>
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-600">{eT > sT ? <>Итого: <b>{fmtDur(eT - sT)}</b>, {fmtDT(sT)} → {fmtDT(eT)}</> : <span className="text-red-600">Окончание раньше начала</span>}</div>
          <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Отмена</Btn><Btn onClick={submit} disabled={!valid}>✋ Взять дежурство</Btn></div>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Мастер слоя ротации ---------------- */
export function LayerWizard({ c, layer, onClose }: { c: Calendar; layer?: Layer; onClose: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const [step, setStep] = useState(0)
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

  return (
    <Modal title={layer ? `Слой «${layer.name}»` : 'Новый слой ротации'} onClose={onClose} wide>
      <div className="mb-5 flex gap-1">
        {steps.map((s, i) => (
          <button key={s} onClick={() => i < step && setStep(i)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}. {s}</button>
        ))}
      </div>
      {step === 0 && (
        <div className="space-y-4">
          <Field label="Название слоя" hint="Что покрывает слой: «Основной», «Ночная смена», «SRE-резерв»…"><input autoFocus className={inputCls} value={l.name} onChange={(e) => set({ name: e.target.value })} placeholder="Например: Основная ротация разработки" /></Field>
          <Field label="Тип дежурства (цвет/бейдж в календаре)">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_META).filter((k) => k !== 'override') as LayerKind[]).map((k) => (
                <button key={k} onClick={() => set({ kind: k })} className={`rounded-full border-2 px-3 py-1 text-sm ${l.kind === k ? '' : 'border-transparent opacity-60'}`} style={{ borderColor: l.kind === k ? KIND_META[k].color : undefined, background: KIND_META[k].bg, color: KIND_META[k].color }}>{KIND_META[k].label}</button>
              ))}
            </div>
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <Field label="Длительность смены (каждый участник дежурит…)">
            <div className="mb-2 flex flex-wrap gap-2">
              {[['day', 1, 'Сутки'], ['day', 2, '2 суток'], ['day', 3, '3 суток'], ['week', 1, 'Неделя'], ['week', 2, '2 недели'], ['week', 4, '4 недели']].map(([u, n, lbl]) => (
                <button key={String(lbl)} onClick={() => set({ rotation: { unit: u as 'day' | 'week', count: n as number } })} className={`rounded-full border px-3 py-1 text-sm ${l.rotation.unit === u && l.rotation.count === n ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300'}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">или: каждые
              <input type="number" min={1} max={52} className={`${inputCls} w-20`} value={l.rotation.count} onChange={(e) => set({ rotation: { ...l.rotation, count: Math.max(1, +e.target.value) } })} />
              <select className={`${inputCls} w-32`} value={l.rotation.unit} onChange={(e) => set({ rotation: { ...l.rotation, unit: e.target.value as 'day' | 'week' } })}><option value="day">сут.</option><option value="week">нед.</option></select>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Начало ротации"><input type="date" className={inputCls} value={l.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
            <Field label="Время передачи смены (handoff), МСК"><input type="time" className={inputCls} value={l.handoffTime} onChange={(e) => set({ handoffTime: e.target.value })} /></Field>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium">Выберите участников</div>
            <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-2 scroll-thin">
              {teams.map((t) => (
                <div key={t}>
                  <div className="text-xs font-semibold text-slate-400 uppercase">{t}</div>
                  {state.people.filter((p) => p.team === t).map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={l.participants.includes(p.id)} onChange={() => toggle(p.id)} />
                      <Avatar p={p} size={22} /> {p.name} <span className="text-xs text-slate-400">{p.title}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Порядок очереди</div>
            <ol className="space-y-1">
              {l.participants.map((id, i) => {
                const p = state.people.find((x) => x.id === id)!
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm">
                    <span className="w-5 text-slate-400">{i + 1}.</span><Avatar p={p} size={22} /><span className="flex-1">{p.name}</span>
                    <button onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-800">↑</button>
                    <button onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-800">↓</button>
                  </li>
                )
              })}
            </ol>
            <div className="mt-4">
              <Field label="Сколько человек дежурят одновременно в этом слое" hint="Например, 3 разработчика по суткам параллельно. Для другой группы (2 человека по неделе) добавьте второй слой.">
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} disabled={n > Math.max(1, l.participants.length)} onClick={() => set({ parallel: n })} className={`h-9 w-9 rounded-lg border text-sm font-semibold disabled:opacity-30 ${l.parallel === n ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300'}`}>{n}</button>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <Field label="Когда слой активен (restriction times)" hint="Вне этих часов слой не дежурит — работают другие слои календаря.">
            <div className="grid grid-cols-3 gap-2 text-sm">
              {([['none', 'Круглосуточно', '24×7'], ['daily', 'Каждый день', 'в заданные часы'], ['weekly', 'По дням недели', 'напр. только выходные']] as const).map(([v, a, b]) => (
                <button key={v} onClick={() => set({ restriction: { ...l.restriction, type: v } })} className={`rounded-lg border p-2 text-left ${l.restriction.type === v ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}><b>{a}</b><div className="text-xs text-slate-500">{b}</div></button>
              ))}
            </div>
          </Field>
          {l.restriction.type !== 'none' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="С"><input type="time" className={inputCls} value={l.restriction.from} onChange={(e) => set({ restriction: { ...l.restriction, from: e.target.value } })} /></Field>
              <Field label="До" hint="Если «до» раньше «с» — окно через полночь. 00:00–00:00 = весь день."><input type="time" className={inputCls} value={l.restriction.to} onChange={(e) => set({ restriction: { ...l.restriction, to: e.target.value } })} /></Field>
            </div>
          )}
          {l.restriction.type === 'weekly' && (
            <div className="flex gap-2">
              {dayNames.map((d, i) => (
                <button key={d} onClick={() => set({ restriction: { ...l.restriction, days: l.restriction.days.includes(i) ? l.restriction.days.filter((x) => x !== i) : [...l.restriction.days, i] } })}
                  className={`h-9 w-11 rounded-lg border text-sm ${l.restriction.days.includes(i) ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300'} ${i > 4 ? 'text-rose-600' : ''}`}>{d}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {step === 4 && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b className="text-base">{l.name}</b><KindBadge k={l.kind} /><span className="text-slate-500">ротация {rotationLabel(l)}, передача в {l.handoffTime} МСК, {Math.min(l.parallel, l.participants.length)} чел. одновременно</span></div>
          <div className="font-medium">Ближайшие смены:</div>
          <div className="space-y-1">
            {preview.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5">
                <span className="w-64 text-slate-500">{fmtDT(r.start)} → {fmtDT(r.end)}</span>
                <span className="flex flex-wrap gap-2">{r.ids.map((id) => { const p = state.people.find((x) => x.id === id)!; return <span key={id} className="flex items-center gap-1"><Avatar p={p} size={20} />{p.name}</span> })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
        <Btn variant="ghost" onClick={() => (step ? setStep(step - 1) : onClose())}>{step ? '← Назад' : 'Отмена'}</Btn>
        {step < steps.length - 1 ? <Btn disabled={!okStep} onClick={() => setStep(step + 1)}>Далее →</Btn> : <Btn onClick={save}>💾 Сохранить слой</Btn>}
      </div>
    </Modal>
  )
}
