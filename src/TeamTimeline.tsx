import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react'
import { addDays, fmtDT, fmtDur, fmtT, HOUR, overlapRanges, personDutySpans, snapRange, startOfDay, teamCoverage, uid, type CoverSeg, type DutySpan, type SnapMode } from './engine'
import { useNow, useStore } from './store'
import type { Person } from './types'
import { KIND_META } from './ui'

type Zoom = 'day' | 'week' | '2w' | 'month'
type Drag =
  | { kind: 'select'; x0: number; time0: number; time1: number }
  | { kind: 'move'; span: DutySpan; x: number; y: number; over: boolean }
type Pop =
  | { type: 'create'; start: number; end: number; x: number; y: number }
  | { type: 'swap'; start: number; end: number; x: number; y: number; personId: string; calendarId: string; layerName: string }

const ZOOMS: [Zoom, string][] = [['day', 'День'], ['week', 'Неделя'], ['2w', '2 недели'], ['month', 'Месяц']]

function viewOf(zoom: Zoom, offset: number, now: number): { from: number; to: number; snap: SnapMode } {
  const today = startOfDay(now)
  if (zoom === 'day') {
    const from = addDays(today, offset)
    return { from: from.getTime(), to: addDays(from, 1).getTime(), snap: 'hour' }
  }
  if (zoom === 'week' || zoom === '2w') {
    const days = zoom === 'week' ? 7 : 14
    const monday = addDays(today, -((today.getDay() + 6) % 7))
    const from = addDays(monday, offset * days)
    return { from: from.getTime(), to: addDays(from, days).getTime(), snap: zoom === 'week' ? 'hour' : 'day' }
  }
  const m = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  return { from: m.getTime(), to: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime(), snap: 'day' }
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
  const { from, to, snap } = viewOf(zoom, offset, now)
  const span = to - from
  const viewRef = useRef({ from, span, snap })
  useEffect(() => { viewRef.current = { from, span, snap } }, [from, span, snap])

  const members = useMemo(() => {
    const list = state.people.filter((p) => p.team === team)
    const leads = list.filter((p) => leadIds.includes(p.id))
    const rest = list.filter((p) => !leadIds.includes(p.id))
    return [...leads, ...rest]
  }, [state.people, team, leadIds.join('|')]) // eslint-disable-line

  const rows = useMemo(() => members.map((p) => {
    const spans = personDutySpans(state.calendars, p.id, from, to)
    return { p, spans, overlaps: overlapRanges(spans), ...pack(spans) }
  }), [members, state.calendars, from, to])

  const cover = useMemo(() => (teamCals.length ? teamCoverage(teamCals, from, to) : []), [teamCals, from, to])
  const hasGap = cover.some((c) => c.gap)

  useEffect(() => {
    if (!pop) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [pop])

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
    const id = pop.type === 'swap' ? pop.calendarId : (calId || teamCals[0]?.id)
    const cal = state.calendars.find((c) => c.id === id)
    if (!cal) return
    const replaces = pop.type === 'swap' ? pop.personId : undefined
    const who = state.people.find((p) => p.id === replaces)
    updateCalendar(cal.id, (c) => ({
      ...c,
      shifts: [...c.shifts, {
        id: uid(), personId: me.id,
        start: new Date(pop.start).toISOString(), end: new Date(pop.end).toISOString(),
        replacesPersonId: replaces,
        note: replaces ? `Подмена: ${who?.name ?? ''}` : 'С таймлайна команды',
        createdAt: new Date().toISOString(),
      }],
    }))
    sendTg({
      toPersonId: me.id, calendarId: cal.id, kind: 'signup',
      text: replaces
        ? `✅ Вы подменяете ${who?.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(pop.start)} по ${fmtDT(pop.end)} МСК (${fmtDur(pop.end - pop.start)})`
        : `✅ Вы записаны на дежурство\nКалендарь: «${cal.name}»\nС ${fmtDT(pop.start)} по ${fmtDT(pop.end)} МСК (${fmtDur(pop.end - pop.start)})\nЗа 1 час до начала пришлю напоминание.`,
    })
    if (replaces) {
      sendTg({
        toPersonId: replaces, calendarId: cal.id, kind: 'handover',
        text: `🔁 Вас подменяет ${me.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(pop.start)} по ${fmtDT(pop.end)} МСК — в это время алерты вам не придут.`,
      })
    }
    toast(replaces ? `Подмена оформлена. Уведомление записано в Telegram.` : `Дежурство добавлено. Уведомление записано в Telegram.`)
    setPop(null)
    setDrag(null)
  }

  const preview = drag?.kind === 'select' ? snapRange(drag.time0, drag.time1, snap) : pop?.type === 'create' ? [pop.start, pop.end] as [number, number] : null
  const nowPct = (now - from) / span
  const periodLabel = zoom === 'day'
    ? new Date(from).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
    : zoom === 'month'
      ? new Date(from).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      : `${new Date(from).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${new Date(to - HOUR).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`

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
        <p className="text-sm text-muted">Свою строку выделите мышью — новое дежурство. Чужую смену перетащите на себя — подмена.</p>
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
                  const d = dragRef.current
                  if (!d || d.kind !== 'select' || p.id !== me.id) return
                  setDrag(null)
                  if (Math.abs(e.clientX - d.x0) < 8) return
                  const [s, en] = snapRange(d.time0, timeAt(e.clientX), viewRef.current.snap)
                  if (!teamCals.length) { toast('У команды нет календаря, куда записать дежурство'); return }
                  setCalId(teamCals[0].id)
                  setPop({ type: 'create', start: s, end: en, x: e.clientX, y: e.clientY })
                }}
                onMoveDown={(e, duty) => {
                  if (duty.personId === me.id) return
                  e.stopPropagation()
                  e.preventDefault()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
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
                  const d = dragRef.current
                  if (!d || d.kind !== 'move') return
                  if (d.span.personId !== duty.personId || d.span.start !== duty.start || d.span.layerId !== duty.layerId) return
                  const hit = overMe(e.clientX, e.clientY)
                  setDrag(null)
                  if (!hit || !members.some((m) => m.id === me.id)) return
                  setPop({ type: 'swap', start: d.span.start, end: d.span.end, x: e.clientX, y: e.clientY, personId: d.span.personId, calendarId: d.span.calendarId, layerName: d.span.layerName })
                }}
                moving={drag?.kind === 'move' ? drag.span : null}
                hint={p.id === me.id ? (drag?.kind === 'move' && drag.over ? 'Отпустите, чтобы подменить' : 'Выделите интервал') : undefined}
              />
            ))}

            {teamCals.length > 0 && (
              <div className="flex border-t border-line">
                <div className="sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center bg-surface px-4 py-3">
                  <div className="text-sm font-medium">Покрытие</div>
                  <div className={`text-xs ${hasGap ? 'text-danger' : 'text-faint'}`}>{hasGap ? 'Есть разрывы' : 'Без разрывов'}</div>
                </div>
                <div className="relative h-12 flex-1">
                  <div className="pointer-events-none absolute inset-0 flex">{cols.map((c) => <div key={c.key} className={`flex-1 ${c.shade}`} />)}</div>
                  {cover.map((c) => c.gap ? (
                    <div key={c.start} className="absolute inset-y-1 flex items-center rounded-md px-2 text-xs text-danger"
                      style={box(c.start, c.end)}
                      onMouseEnter={(e) => showTip(e, 'Нет дежурного', [c.gapNames || 'Календарь команды', `${fmtDT(c.start)} — ${fmtDT(c.end)}`])}
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

      <details className="text-sm text-muted">
        <summary className="cursor-pointer select-none">Как читать график</summary>
        <p className="mt-2 max-w-xl leading-relaxed">Цвет полосы — тип дежурства, не человек. Штриховка — две смены одного человека сразу. Розовый фон — в это время в календаре команды никто не дежурит. Привязка: к часу на дне и неделе, к суткам на двух неделях и месяце.</p>
      </details>

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
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setPop(null)} />
          <div data-testid="duty-popover" className="popover-in fixed z-50 w-[300px] rounded-xl border border-line bg-surface p-4 shadow-card"
            style={{ left: Math.max(12, Math.min(pop.x - 24, window.innerWidth - 320)), top: pop.y + 180 > window.innerHeight ? Math.max(12, pop.y - 200) : pop.y + 12 }}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium">{pop.type === 'swap' ? 'Подмена' : 'Новое дежурство'}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{fmtDT(pop.start)} — {fmtDT(pop.end)}</p>
            <p className="text-sm text-muted">{fmtDur(pop.end - pop.start)}</p>
            {pop.type === 'swap' ? (
              <p className="mt-3 text-sm leading-relaxed">Вместо {state.people.find((p) => p.id === pop.personId)?.name}. Сообщение уйдёт вам и коллеге.</p>
            ) : teamCals.length > 1 ? (
              <select className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm" value={calId} onChange={(e) => setCalId(e.target.value)}>
                {teamCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <p className="mt-3 text-sm text-muted">{teamCals[0]?.name}</p>
            )}
            {pop.type === 'swap' && <p className="mt-1 text-xs text-faint">{state.calendars.find((c) => c.id === pop.calendarId)?.name} · {pop.layerName}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setPop(null)}>Отмена</button>
              <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2" onClick={confirm}>{pop.type === 'swap' ? 'Подменить' : 'Создать'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PersonRow({ person, me, lead, items, overlaps, laneCount, box, span, shade, gaps, drop, preview, rowRef, trackRef, hint, moving, onTip, onHideTip, onSelectDown, onSelectMove, onSelectUp, onMoveDown, onMove, onMoveUp }: {
  person: Person
  me: boolean
  lead: boolean
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
        <div className="truncate text-sm font-medium">{person.name}</div>
        <div className="truncate text-xs text-faint">{hint ?? (lead ? 'Лид команды' : person.title)}</div>
      </div>
      <div
        ref={trackRef}
        className={`relative flex-1 ${me ? 'cursor-crosshair touch-none' : ''}`}
        style={{ height }}
        onPointerDown={onSelectDown}
        onPointerMove={onSelectMove}
        onPointerUp={onSelectUp}
      >
        <div className="pointer-events-none absolute inset-0 flex">{shade.map((s, i) => <div key={i} className={`flex-1 ${s}`} />)}</div>
        {gaps.map((g) => <div key={g.start} className="gap-band pointer-events-none absolute inset-y-0" style={box(g.start, g.end)} />)}
        {items.map(({ span: duty, lane }) => {
          const meta = KIND_META[duty.kind as keyof typeof KIND_META] ?? KIND_META.override
          const wide = (duty.end - duty.start) / span > 0.07
          const overlapped = overlaps.some((o) => duty.start < o.end && duty.end > o.start)
          const dim = moving && moving.personId === duty.personId && moving.start === duty.start && moving.layerId === duty.layerId
          return (
            <div
              key={`${duty.calendarId}-${duty.layerId}-${duty.start}`}
              data-bar
              className={`absolute flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium whitespace-nowrap text-white ${me ? '' : 'cursor-grab'} ${dim ? 'opacity-40' : ''}`}
              style={{
                ...box(duty.start, duty.end),
                top: 10 + lane * 24,
                height: 20,
                background: meta.color,
                backgroundImage: duty.kind === 'override' ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.28) 0 4px, transparent 4px 8px)' : undefined,
              }}
              onPointerDown={(e) => onMoveDown(e, duty)}
              onPointerMove={(e) => onMove(e, duty)}
              onPointerUp={(e) => onMoveUp(e, duty)}
              onMouseEnter={(e) => onTip(e, person.name, [
                `${meta.label} · ${duty.calendarName}`,
                duty.layerName,
                `${fmtDT(duty.start)} — ${fmtDT(duty.end)} · ${fmtDur(duty.end - duty.start)}`,
                ...(duty.note ? [duty.note] : []),
                ...(overlapped ? ['Пересекается с другой сменой'] : []),
              ])}
              onMouseLeave={onHideTip}
            >
              {wide ? meta.label : ''}
            </div>
          )
        })}
        {overlaps.map((o) => (
          <div key={o.start} className="pointer-events-none absolute rounded-sm" style={{ ...box(o.start, o.end), top: 8, bottom: 8, outline: '2px solid #d97706', background: 'repeating-linear-gradient(-45deg, transparent 0 5px, rgba(217,119,6,.45) 5px 7px)' }} />
        ))}
        {preview && <div className="pointer-events-none absolute top-1 bottom-1 rounded-md bg-accent/15 ring-1 ring-accent/50" style={box(preview[0], preview[1])} />}
      </div>
    </div>
  )
}
