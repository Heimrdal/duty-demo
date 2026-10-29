import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { addDays, calendarHandoff, calendarOnCall, fmtDT, fmtDur, fmtT, HOUR, overlapRanges, personDutySpans, snapDuty, startOfDay, teamCoverage, uid, type CoverSeg, type DutySpan } from './engine'
import { useNow, useStore } from './store'
import type { Calendar, Person } from './types'
import { personColor, ScheduleLegend, shortName } from './ui'

type Zoom = 'day' | 'week' | '2w' | 'month'
type Drag =
  | { kind: 'select'; x0: number; time0: number; time1: number }
  | { kind: 'move'; span: DutySpan; x: number; y: number; over: boolean }
type Pop =
  | { type: 'create'; raw0: number; raw1: number; x: number; y: number }
  | { type: 'swap'; start: number; end: number; x: number; y: number; personId: string; calendarId: string; layerName: string; shifted: boolean }

const ZOOMS: [Zoom, string][] = [['day', 'День'], ['week', 'Неделя'], ['2w', '2 недели'], ['month', 'Месяц']]

function viewOf(zoom: Zoom, offset: number, now: number): { from: number; to: number } {
  const today = startOfDay(now)
  if (zoom === 'day') {
    const from = addDays(today, offset)
    return { from: from.getTime(), to: addDays(from, 1).getTime() }
  }
  if (zoom === 'week' || zoom === '2w') {
    const days = zoom === 'week' ? 7 : 14
    const monday = addDays(today, -((today.getDay() + 6) % 7))
    const from = addDays(monday, offset * days)
    return { from: from.getTime(), to: addDays(from, days).getTime() }
  }
  const m = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  return { from: m.getTime(), to: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() }
}

function pack(spans: DutySpan[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const ends: number[] = []
  const items = sorted.map((span) => {
    let lane = ends.findIndex((e) => e <= span.start)
    if (lane < 0) { lane = ends.length; ends.push(span.end) } else ends[lane] = span.end
    return { span, lane }
  })
  return { items, laneCount: Math.max(1, ends.length) }
}

function releasePointer(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
}

function pickCalendar(cals: Calendar[], meId: string, spans: DutySpan[], start: number, end: number) {
  const newest = [...cals].reverse()
  const hit = spans.find((s) => s.end > start && s.start < end && newest.some((c) => c.id === s.calendarId))
  if (hit) return hit.calendarId
  return (newest.find((c) => c.ownerId === meId || c.layers.some((l) => l.participants.includes(meId))) ?? newest[0])?.id ?? ''
}

export function TeamTimeline({ team }: { team: string }) {
  const { state, updateCalendar, sendTg, toast } = useStore()
  const now = useNow(15000)
  const me = state.people.find((p) => p.id === state.currentUserId)!
  const [zoom, setZoom] = useState<Zoom>('week')
  const [offset, setOffset] = useState(0)
  const [drag, setDragState] = useState<Drag | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [calId, setCalId] = useState('')
  const [tip, setTip] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const meRowRef = useRef<HTMLDivElement>(null)
  const meTrackRef = useRef<HTMLDivElement>(null)

  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d) }

  const teamCals = state.calendars.filter((c) => c.team === team)
  const leadIds = [...new Set(teamCals.map((c) => c.leadId))]
  const { from, to } = viewOf(zoom, offset, now)
  const span = to - from
  const viewRef = useRef({ from, span })
  useEffect(() => { viewRef.current = { from, span } }, [from, span])

  const members = useMemo(() => {
    const ids = new Set(state.people.filter((p) => p.team === team).map((p) => p.id))
    for (const c of state.calendars) if (c.team === team) {
      ids.add(c.leadId)
      ids.add(c.ownerId)
      for (const l of c.layers) for (const id of l.participants) ids.add(id)
    }
    const lead = new Set(leadIds)
    return state.people.filter((p) => ids.has(p.id)).sort((a, b) => {
      const score = (p: Person) => (lead.has(p.id) ? 0 : p.team === team ? 1 : 2)
      return score(a) - score(b) || a.name.localeCompare(b.name, 'ru')
    })
  }, [state.people, state.calendars, team, leadIds.join('|')]) // eslint-disable-line

  const rows = useMemo(() => members.map((p) => {
    const spans = personDutySpans(state.calendars, p.id, from, to)
    return { p, spans, overlaps: overlapRanges(spans), ...pack(spans) }
  }), [members, state.calendars, from, to])

  const cover = useMemo(() => (teamCals.length ? teamCoverage(teamCals, from, to) : []), [teamCals, from, to])
  const hasGap = cover.some((c) => c.gap)
  const nowGap = teamCals.some((c) => calendarOnCall(c, now).length === 0)
  const handoff = calendarHandoff((teamCals.find((c) => c.id === calId) ?? teamCals[teamCals.length - 1])?.layers ?? [])
  const snapped = pop?.type === 'create' ? snapDuty(pop.raw0, pop.raw1, handoff, now) : null

  const timeAt = (clientX: number) => {
    const rect = meTrackRef.current?.getBoundingClientRect()
    const v = viewRef.current
    if (!rect || rect.width <= 0) return v.from
    const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return v.from + p * v.span
  }
  const overMe = (x: number, y: number) => {
    const r = meRowRef.current?.getBoundingClientRect()
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  const box = (start: number, end: number) => ({
    left: `${((start - from) / span) * 100}%`,
    width: `${((Math.min(end, to) - Math.max(start, from)) / span) * 100}%`,
  })

  const cols = zoom === 'day'
    ? Array.from({ length: 24 }, (_, h) => ({ key: h, label: String(h).padStart(2, '0'), sub: '', shade: '' }))
    : Array.from({ length: Math.round(span / (24 * HOUR)) }, (_, i) => {
        const d = new Date(from + i * 24 * HOUR)
        const we = d.getDay() === 0 || d.getDay() === 6
        const today = startOfDay(now).getTime() === startOfDay(d).getTime()
        return {
          key: d.getTime(),
          label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: zoom === 'month' ? undefined : 'short' }),
          sub: d.toLocaleDateString('ru-RU', { weekday: 'short' }),
          shade: today ? 'today-col' : we ? 'weekend' : '',
        }
      })

  const showTip = (e: MouseEvent, title: string, lines: string[]) => {
    if (dragRef.current) return
    setTip({ x: e.clientX, y: e.clientY, title, lines })
  }

  const confirm = () => {
    if (!pop) return
    const createSnap = pop.type === 'create' ? snapDuty(pop.raw0, pop.raw1, handoff, Date.now()) : null
    if (createSnap?.past) { toast('Нельзя создать дежурство в прошлом'); return }
    const start = pop.type === 'swap' ? pop.start : createSnap!.start
    const end = pop.type === 'swap' ? pop.end : createSnap!.end
    const id = pop.type === 'swap' ? pop.calendarId : (calId || [...teamCals].reverse()[0]?.id)
    const cal = state.calendars.find((c) => c.id === id)
    if (!cal) { setPop(null); return }
    const replaces = pop.type === 'swap' ? pop.personId : undefined
    const who = state.people.find((p) => p.id === replaces)
    updateCalendar(cal.id, (c) => ({
      ...c,
      shifts: [...c.shifts, {
        id: uid(), personId: me.id,
        start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        replacesPersonId: replaces,
        note: replaces ? `Подмена: ${who?.name ?? ''}` : 'Разовое дежурство',
        createdAt: new Date().toISOString(),
      }],
    }))
    sendTg({
      toPersonId: me.id, calendarId: cal.id, kind: 'signup',
      text: replaces
        ? `✅ Вы подменяете ${who?.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(start)} по ${fmtDT(end)} МСК (${fmtDur(end - start)})`
        : `✅ Разовое дежурство\nКалендарь: «${cal.name}»\nС ${fmtDT(start)} по ${fmtDT(end)} МСК (${fmtDur(end - start)})\nЗа 1 час до начала пришлю напоминание.`,
    })
    if (replaces) {
      sendTg({
        toPersonId: replaces, calendarId: cal.id, kind: 'handover',
        text: `🔁 Вас подменяет ${me.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(start)} по ${fmtDT(end)} МСК — в это время алерты вам не придут.`,
      })
    }
    toast(replaces ? 'Подмена оформлена. Уведомление записано в Telegram.' : 'Разовое дежурство добавлено. Уведомление записано в Telegram.')
    setPop(null)
    setDrag(null)
  }

  const preview = drag?.kind === 'select'
    ? (() => { const s = snapDuty(drag.time0, drag.time1, handoff, now); return s.past ? null : [s.start, s.end] as [number, number] })()
    : snapped && !snapped.past ? [snapped.start, snapped.end] as [number, number] : null
  const nowPct = (now - from) / span
  const periodLabel = zoom === 'day'
    ? new Date(from).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
    : zoom === 'month'
      ? new Date(from).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      : `${new Date(from).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${new Date(to - HOUR).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
  const orderedCals = [...teamCals].reverse()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {ZOOMS.map(([id, label]) => (
            <button key={id} onClick={() => { setZoom(id); setOffset(0) }} className={`rounded-md px-3 py-1 text-sm ${zoom === id ? 'bg-surface font-medium text-ink shadow-card' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setOffset(offset - 1)} aria-label="Назад">‹</button>
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setOffset(0)}>Сегодня</button>
          <button className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setOffset(offset + 1)} aria-label="Вперёд">›</button>
          <span className="min-w-40 px-2 text-center text-muted">{periodLabel}</span>
        </div>
      </div>

      {members.some((p) => p.id === me.id) && (
        <p className="text-sm text-muted">Свою строку выделите мышью — разовое дежурство, целые сутки от времени передачи смены. Чужую смену перетащите на себя — подмена.</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface select-none scroll-thin" data-testid="team-timeline">
        <div className="relative" style={{ minWidth: zoom === 'month' ? 1080 : zoom === 'day' ? 920 : 840 }}>
          <div className="flex border-b border-line">
            <div className="sticky left-0 z-20 w-48 shrink-0 bg-surface px-4 py-2 text-xs text-faint">Сотрудник</div>
            <div className="flex flex-1">
              {cols.map((c) => (
                <div key={c.key} className={`flex-1 px-1 py-2 text-center text-xs text-muted ${c.shade}`}>
                  <div>{c.sub}</div>
                  <div className="font-medium text-ink">{c.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            {rows.map(({ p, overlaps, items, laneCount }) => (
              <PersonRow
                key={p.id}
                person={p}
                me={p.id === me.id}
                lead={leadIds.includes(p.id)}
                guest={p.team !== team}
                items={items}
                overlaps={overlaps}
                laneCount={laneCount}
                box={box}
                span={span}
                shade={cols.map((c) => c.shade)}
                gaps={cover.filter((c) => c.gap)}
                drop={!!(drag?.kind === 'move' && drag.over && p.id === me.id)}
                preview={p.id === me.id ? preview : null}
                rowRef={p.id === me.id ? meRowRef : undefined}
                trackRef={p.id === me.id ? meTrackRef : undefined}
                onTip={showTip}
                onHideTip={() => setTip(null)}
                onSelectDown={(e) => {
                  if (p.id !== me.id || e.button !== 0) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setPop(null)
                  const t0 = timeAt(e.clientX)
                  setDrag({ kind: 'select', x0: e.clientX, time0: t0, time1: t0 })
                }}
                onSelectMove={(e) => {
                  const d = dragRef.current
                  if (!d || d.kind !== 'select' || p.id !== me.id) return
                  setDrag({ ...d, time1: timeAt(e.clientX) })
                }}
                onSelectUp={(e) => {
                  releasePointer(e)
                  const d = dragRef.current
                  if (!d || d.kind !== 'select' || p.id !== me.id) return
                  setDrag(null)
                  if (e.type === 'pointercancel' || Math.abs(e.clientX - d.x0) < 8) return
                  if (!teamCals.length) { toast('У команды нет календаря, куда записать дежурство'); return }
                  const raw1 = timeAt(e.clientX)
                  const id = pickCalendar(teamCals, me.id, rows.find((r) => r.p.id === me.id)?.spans ?? [], Math.min(d.time0, raw1), Math.max(d.time0, raw1))
                  const snap = snapDuty(d.time0, raw1, calendarHandoff(teamCals.find((c) => c.id === id)?.layers ?? []), Date.now())
                  if (snap.past) { toast('Нельзя создать дежурство в прошлом'); return }
                  setCalId(id)
                  setPop({ type: 'create', raw0: d.time0, raw1, x: e.clientX, y: e.clientY })
                }}
                onMoveDown={(e, duty) => {
                  if (duty.personId === me.id) return
                  e.stopPropagation()
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setPop(null)
                  setTip(null)
                  setDrag({ kind: 'move', span: duty, x: e.clientX, y: e.clientY, over: overMe(e.clientX, e.clientY) })
                }}
                onMove={(e, duty) => {
                  const d = dragRef.current
                  if (!d || d.kind !== 'move') return
                  if (d.span.personId !== duty.personId || d.span.start !== duty.start || d.span.layerId !== duty.layerId) return
                  setDrag({ ...d, x: e.clientX, y: e.clientY, over: overMe(e.clientX, e.clientY) })
                }}
                onMoveUp={(e, duty) => {
                  releasePointer(e)
                  const d = dragRef.current
                  if (!d || d.kind !== 'move') return
                  if (d.span.personId !== duty.personId || d.span.start !== duty.start || d.span.layerId !== duty.layerId) return
                  const hit = overMe(e.clientX, e.clientY)
                  setDrag(null)
                  if (e.type === 'pointercancel' || !hit || !members.some((m) => m.id === me.id)) return
                  if (d.span.end <= Date.now()) { toast('Эта смена уже в прошлом — подмену не оформляем'); return }
                  let start = d.span.start
                  let end = d.span.end
                  let shifted = false
                  if (start < Date.now()) {
                    start = Math.ceil(Date.now() / HOUR) * HOUR
                    if (start >= end) { toast('От этой смены почти ничего не осталось'); return }
                    shifted = true
                  }
                  setPop({ type: 'swap', start, end, shifted, x: e.clientX, y: e.clientY, personId: d.span.personId, calendarId: d.span.calendarId, layerName: d.span.layerName })
                }}
                moving={drag?.kind === 'move' ? drag.span : null}
                hint={p.id === me.id ? (drag?.kind === 'move' && drag.over ? 'Отпустите, чтобы подменить' : 'Выделите будущий интервал') : undefined}
              />
            ))}

            {teamCals.length > 0 && (
              <div className="flex border-t border-line">
                <div className="sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center bg-surface px-4 py-3">
                  <div className="text-sm font-medium">Покрытие</div>
                  <div data-testid="coverage-note" className={`text-xs ${hasGap ? 'text-danger' : 'text-faint'}`}>
                    {hasGap ? (nowGap ? 'Сейчас есть календарь без дежурного' : 'Сейчас покрыто, в этом окне есть дыры') : 'В этом окне дыр нет'}
                  </div>
                </div>
                <div className="relative h-12 flex-1">
                  <div className="pointer-events-none absolute inset-0 flex">{cols.map((c) => <div key={c.key} className={`flex-1 ${c.shade}`} />)}</div>
                  {cover.map((c) => c.gap ? (
                    <div key={c.start} className="absolute inset-y-1 flex items-center rounded-md px-2 text-xs text-danger"
                      style={box(c.start, c.end)}
                      onMouseEnter={(e) => showTip(e, 'Нет дежурного', [c.gapNames || 'Календарь команды', `${fmtDT(c.start)} — ${fmtDT(c.end)}`, 'Дыра в видимом окне. Счётчик на главной считает только текущий момент.'])}
                      onMouseLeave={() => setTip(null)}>
                      {(c.end - c.start) / span > 0.08 ? 'Нет дежурного' : ''}
                    </div>
                  ) : (
                    <div key={c.start} className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ok/70" style={box(c.start, c.end)} />
                  ))}
                </div>
              </div>
            )}

            {nowPct >= 0 && nowPct <= 1 && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-30" style={{ left: `calc(12rem + (100% - 12rem) * ${nowPct})` }}>
                <div className="absolute top-0 bottom-0 w-px bg-danger" />
                <div className="absolute top-1 left-1 rounded bg-danger px-1 py-0.5 text-[10px] font-medium whitespace-nowrap text-white">{fmtT(now)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ScheduleLegend />

      {drag?.kind === 'move' && (
        <div className="pointer-events-none fixed z-50 rounded-lg bg-ink px-2.5 py-1 text-xs text-canvas shadow-card" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {state.people.find((p) => p.id === drag.span.personId)?.name}
        </div>
      )}

      {tip && !drag && (
        <div className="pointer-events-none fixed z-50 w-64 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card" style={{ left: Math.min(tip.x + 12, window.innerWidth - 280), top: Math.min(tip.y + 14, window.innerHeight - 160) }}>
          <div className="font-medium">{tip.title}</div>
          {tip.lines.map((l) => <div key={l} className="mt-0.5 text-muted">{l}</div>)}
        </div>
      )}

      {pop && (
        <DutyCard x={pop.x} y={pop.y} title={pop.type === 'swap' ? 'Подмена' : 'Разовое дежурство'} onClose={() => { setPop(null); setDrag(null) }}>
          {pop.type === 'create' && snapped ? (
            snapped.past ? <p className="mt-2 text-sm text-danger">Интервал в прошлом. Выберите будущие сутки.</p> : (
              <>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{fmtDT(snapped.start)} — {fmtDT(snapped.end)}</p>
                <p className="text-sm text-muted">{fmtDur(snapped.end - snapped.start)} · передача смены {handoff}</p>
                {snapped.shifted && <p className="mt-2 text-sm text-muted">Начало сдвинуто вперёд: дежурство в прошлом не создаётся.</p>}
              </>
            )
          ) : pop.type === 'swap' ? (
            <>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{fmtDT(pop.start)} — {fmtDT(pop.end)}</p>
              <p className="text-sm text-muted">{fmtDur(pop.end - pop.start)}</p>
              <p className="mt-3 text-sm leading-relaxed">Вместо {state.people.find((p) => p.id === pop.personId)?.name}. Сообщение уйдёт вам и коллеге.</p>
              {pop.shifted && <p className="mt-2 text-sm text-muted">Прошедшая часть смены не записывается.</p>}
              <p className="mt-1 text-xs text-faint">{state.calendars.find((c) => c.id === pop.calendarId)?.name} · {pop.layerName}</p>
            </>
          ) : null}
          {pop.type === 'create' && (orderedCals.length > 1 ? (
            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-muted">Календарь</span>
              <select data-testid="duty-calendar" className="w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" value={calId} onChange={(e) => setCalId(e.target.value)}>
                {orderedCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="mt-3 text-sm text-ink">{orderedCals[0]?.name}</p>
          ))}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setPop(null)}>Отмена</button>
            <button type="button" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2 disabled:opacity-40" disabled={pop.type === 'create' && !!snapped?.past} onClick={confirm}>{pop.type === 'swap' ? 'Подменить' : 'Создать'}</button>
          </div>
        </DutyCard>
      )}
    </div>
  )
}

function DutyCard({ x, y, title, onClose, children }: { x: number; y: number; title: string; onClose: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 280)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', key)
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    if (!armed) return
    const down = (e: globalThis.PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) closeRef.current()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [armed])
  const left = Math.max(12, Math.min(x - 24, window.innerWidth - 340))
  const top = y + 220 > window.innerHeight ? Math.max(12, y - 220) : y + 12
  return createPortal(
    <div ref={cardRef} data-testid="duty-popover" className="popover-in fixed z-50 w-[320px] rounded-xl border border-line bg-surface p-4 shadow-card" style={{ left, top, pointerEvents: armed ? 'auto' : 'none' }}>
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>,
    document.body,
  )
}

function PersonRow({ person, me, lead, guest, items, overlaps, laneCount, box, span, shade, gaps, drop, preview, rowRef, trackRef, hint, moving, onTip, onHideTip, onSelectDown, onSelectMove, onSelectUp, onMoveDown, onMove, onMoveUp }: {
  person: Person
  me: boolean
  lead: boolean
  guest: boolean
  items: { span: DutySpan; lane: number }[]
  overlaps: { start: number; end: number }[]
  laneCount: number
  box: (s: number, e: number) => { left: string; width: string }
  span: number
  shade: string[]
  gaps: CoverSeg[]
  drop: boolean
  preview: [number, number] | null
  rowRef?: Ref<HTMLDivElement>
  trackRef?: Ref<HTMLDivElement>
  hint?: string
  moving: DutySpan | null
  onTip: (e: MouseEvent, title: string, lines: string[]) => void
  onHideTip: () => void
  onSelectDown: (e: PointerEvent<HTMLDivElement>) => void
  onSelectMove: (e: PointerEvent<HTMLDivElement>) => void
  onSelectUp: (e: PointerEvent<HTMLDivElement>) => void
  onMoveDown: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
  onMove: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
  onMoveUp: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
}) {
  const height = Math.max(56, 18 + laneCount * 24)
  return (
    <div ref={rowRef} data-row={me ? 'me' : undefined} className={`flex border-t border-line ${drop ? 'bg-accent-soft' : ''}`}>
      <div className={`sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center px-4 ${drop ? 'bg-accent-soft' : 'bg-surface'}`}>
        <div className="truncate text-sm font-medium" title={person.name}>{person.name}</div>
        <div className="truncate text-xs text-faint">{hint ?? (lead ? 'Лид календаря' : guest ? person.team : person.title)}</div>
      </div>
      <div
        ref={trackRef}
        data-track={me ? 'me' : undefined}
        className={`relative flex-1 ${me ? 'cursor-crosshair touch-none' : ''}`}
        style={{ height }}
        onPointerDown={onSelectDown}
        onPointerMove={onSelectMove}
        onPointerUp={onSelectUp}
        onPointerCancel={(e) => { releasePointer(e); onSelectUp(e) }}
      >
        <div className="pointer-events-none absolute inset-0 flex">{shade.map((s, i) => <div key={i} className={`flex-1 ${s}`} />)}</div>
        {gaps.map((g) => <div key={g.start} className="gap-band pointer-events-none absolute inset-y-0" style={box(g.start, g.end)} />)}
        {items.map(({ span: duty, lane }) => {
          const wide = (duty.end - duty.start) / span > 0.045
          const overlapped = overlaps.some((o) => duty.start < o.end && duty.end > o.start)
          const dim = moving && moving.personId === duty.personId && moving.start === duty.start && moving.layerId === duty.layerId
          const hatch = duty.kind === 'override'
          return (
            <div
              key={`${duty.calendarId}-${duty.layerId}-${duty.kind}-${duty.start}`}
              data-bar
              title={person.name}
              className={`absolute flex items-center overflow-hidden rounded-md px-1 text-[10px] font-medium whitespace-nowrap text-white ${me ? '' : 'cursor-grab'} ${dim ? 'opacity-40' : ''}`}
              style={{
                ...box(duty.start, duty.end),
                top: 10 + lane * 24,
                height: 20,
                background: personColor(duty.personId),
                backgroundImage: hatch ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 4px, transparent 4px 8px)' : undefined,
              }}
              onPointerDown={(e) => onMoveDown(e, duty)}
              onPointerMove={(e) => onMove(e, duty)}
              onPointerUp={(e) => onMoveUp(e, duty)}
              onPointerCancel={(e) => onMoveUp(e, duty)}
              onMouseEnter={(e) => onTip(e, person.name, [
                `${duty.layerName} · ${duty.calendarName}`,
                `${fmtDT(duty.start)} — ${fmtDT(duty.end)} · ${fmtDur(duty.end - duty.start)}`,
                ...(duty.note ? [duty.note] : []),
                ...(overlapped ? ['Оранжевый контур — две смены сразу'] : []),
              ])}
              onMouseLeave={onHideTip}
            >
              {wide && ((duty.end - duty.start) / span) * 640 >= shortName(person.name).length * 6.1 + 8 ? shortName(person.name) : ''}
            </div>
          )
        })}
        {overlaps.map((o) => (
          <div key={o.start} className="pointer-events-none absolute rounded-sm" style={{ ...box(o.start, o.end), top: 8, bottom: 8, outline: '2px solid var(--c-warn)', background: 'repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in srgb, var(--c-warn) 45%, transparent) 5px 7px)' }} />
        ))}
        {preview && <div className="pointer-events-none absolute top-1 bottom-1 rounded-md bg-accent/15 ring-1 ring-accent/50" style={box(preview[0], preview[1])} />}
      </div>
    </div>
  )
}
