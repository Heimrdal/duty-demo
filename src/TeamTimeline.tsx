import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { addDays, calendarHandoff, calendarOnCall, DEFAULT_TZ, fmtDT, fmtDur, fmtT, HOUR, overlapRanges, personDutySpans, snapDuty, startOfDay, teamCoverage, uid, weekday, type CoverSeg, type DutySpan } from './engine'
import { useNow, useStore } from './store'
import { fmtTz, startOfMonthTz, tzLabel, tzName } from './tz'
import type { Calendar, Person } from './types'
import { barRect, BarCard, blurClosesCard, CONFLICT_STYLE, personColor, ScheduleLegend, shortName, SUBST_STYLE, type BarInfo } from './ui'

type Zoom = 'day' | 'week' | '2w' | 'month'
type Drag =
  | { kind: 'select'; x0: number; time0: number; time1: number }
  | { kind: 'move'; span: DutySpan; x: number; y: number; x0: number; y0: number; over: boolean }
type Pop =
  | { type: 'create'; raw0: number; raw1: number; x: number; y: number }
  | { type: 'swap'; start: number; end: number; x: number; y: number; personId: string; calendarId: string; layerName: string; shifted: boolean }

const ZOOMS: [Zoom, string][] = [['day', 'День'], ['week', 'Неделя'], ['2w', '2 недели'], ['month', 'Месяц']]

function viewOf(zoom: Zoom, offset: number, now: number, tz: string): { from: number; to: number } {
  const today = startOfDay(now, tz)
  if (zoom === 'day') {
    const from = addDays(today, offset, tz)
    return { from, to: addDays(from, 1, tz) }
  }
  if (zoom === 'week' || zoom === '2w') {
    const days = zoom === 'week' ? 7 : 14
    const monday = addDays(today, -weekday(today, tz), tz)
    const from = addDays(monday, offset * days, tz)
    return { from, to: addDays(from, days, tz) }
  }
  return { from: startOfMonthTz(now, offset, tz), to: startOfMonthTz(now, offset + 1, tz) }
}

const dutyKey = (d: DutySpan) => `${d.calendarId}-${d.layerId}-${d.kind}-${d.start}`

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
  const [card, setCard] = useState<BarInfo | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const meRowRef = useRef<HTMLDivElement>(null)
  const meTrackRef = useRef<HTMLDivElement>(null)

  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d) }

  const teamCals = state.calendars.filter((c) => c.team === team)
  const tz = teamCals[0]?.timezone ?? DEFAULT_TZ
  const zl = tzLabel(tz)
  const leadIds = [...new Set(teamCals.map((c) => c.leadId))]
  const { from, to } = viewOf(zoom, offset, now, tz)
  const span = to - from
  const viewRef = useRef({ from, span })
  useEffect(() => { viewRef.current = { from, span } }, [from, span])

  const members = useMemo(() => {
    const ids = new Set(state.people.filter((p) => p.teams.includes(team)).map((p) => p.id))
    for (const c of state.calendars) if (c.team === team) {
      ids.add(c.leadId)
      ids.add(c.ownerId)
      for (const l of c.layers) for (const id of l.participants) ids.add(id)
    }
    const lead = new Set(leadIds)
    return state.people.filter((p) => ids.has(p.id)).sort((a, b) => {
      const score = (p: Person) => (lead.has(p.id) ? 0 : p.teams.includes(team) ? 1 : 2)
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
  const selCal = teamCals.find((c) => c.id === calId) ?? teamCals[teamCals.length - 1]
  const selTz = selCal?.timezone ?? tz
  const handoff = calendarHandoff(selCal?.layers ?? [])
  const snapped = pop?.type === 'create' ? snapDuty(pop.raw0, pop.raw1, handoff, selTz, now) : null

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

  const todayStart = startOfDay(now, tz)
  const dayCount = Math.round(span / (24 * HOUR))
  const cols = zoom === 'day'
    ? Array.from({ length: 24 }, (_, h) => ({ key: h, label: String(h).padStart(2, '0'), sub: '', shade: '' }))
    : Array.from({ length: dayCount }, (_, i) => {
        const d = addDays(from, i, tz)
        const we = weekday(d, tz) >= 5
        return {
          key: d,
          label: fmtTz(d, tz, { day: 'numeric', month: zoom === 'month' ? undefined : 'short' }),
          sub: fmtTz(d, tz, { weekday: 'short' }),
          shade: todayStart === d ? 'today-col' : we ? 'weekend' : '',
        }
      })

  const openCard = (el: Element, duty: DutySpan, person: Person, overlapped: boolean) => {
    const ctz = state.calendars.find((c) => c.id === duty.calendarId)?.timezone ?? tz
    setTip(null)
    setCard({
      title: person.name,
      lines: [
        `${duty.calendarName} · ${duty.layerName}${duty.kind === 'override' ? ' (подмена)' : ''}`,
        ...(duty.replacedId ? [`Вместо: ${state.people.find((x) => x.id === duty.replacedId)?.name ?? ''}`] : []),
        `${fmtDT(duty.start, ctz)} — ${fmtDT(duty.end, ctz)} · ${fmtDur(duty.end - duty.start)}`,
        `Часовой пояс: ${tzName(ctz)}`,
        ...(duty.note ? [duty.note] : []),
        ...(overlapped ? ['Конфликт: в это время у человека ещё одна смена'] : []),
      ],
      rect: barRect(el),
    })
  }

  const showTip = (e: MouseEvent, title: string, lines: string[]) => {
    if (dragRef.current) return
    setTip({ x: e.clientX, y: e.clientY, title, lines })
  }

  const confirm = () => {
    if (!pop) return
    const createSnap = pop.type === 'create' ? snapDuty(pop.raw0, pop.raw1, handoff, selTz, Date.now()) : null
    if (createSnap?.past) { toast('Нельзя создать дежурство в прошлом'); return }
    const start = pop.type === 'swap' ? pop.start : createSnap!.start
    const end = pop.type === 'swap' ? pop.end : createSnap!.end
    const id = pop.type === 'swap' ? pop.calendarId : (calId || [...teamCals].reverse()[0]?.id)
    const cal = state.calendars.find((c) => c.id === id)
    if (!cal) { setPop(null); return }
    const replaces = pop.type === 'swap' ? pop.personId : undefined
    const ctz = cal.timezone
    const czl = tzLabel(ctz)
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
        ? `✅ Вы подменяете ${who?.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(start, ctz)} по ${fmtDT(end, ctz)} ${czl} (${fmtDur(end - start)})`
        : `✅ Разовое дежурство\nКалендарь: «${cal.name}»\nС ${fmtDT(start, ctz)} по ${fmtDT(end, ctz)} ${czl} (${fmtDur(end - start)})\nЗа 1 час до начала пришлю напоминание.`,
    })
    if (replaces) {
      sendTg({
        toPersonId: replaces, calendarId: cal.id, kind: 'handover',
        text: `🔁 Вас подменяет ${me.name}\nКалендарь: «${cal.name}»\nС ${fmtDT(start, ctz)} по ${fmtDT(end, ctz)} ${czl} — в это время алерты вам не придут.`,
      })
    }
    toast(replaces ? 'Подмена оформлена. Уведомление записано в Telegram.' : 'Разовое дежурство добавлено. Уведомление записано в Telegram.')
    setPop(null)
    setDrag(null)
  }

  const preview = drag?.kind === 'select'
    ? (() => { const s = snapDuty(drag.time0, drag.time1, handoff, selTz, now); return s.past ? null : [s.start, s.end] as [number, number] })()
    : snapped && !snapped.past ? [snapped.start, snapped.end] as [number, number] : null
  const nowPct = (now - from) / span
  const periodLabel = zoom === 'day'
    ? fmtTz(from, tz, { weekday: 'long', day: 'numeric', month: 'long' })
    : zoom === 'month'
      ? fmtTz(from, tz, { month: 'long', year: 'numeric' })
      : `${fmtTz(from, tz, { day: 'numeric', month: 'short' })} – ${fmtTz(to - HOUR, tz, { day: 'numeric', month: 'short' })}`
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
          <span className="min-w-40 px-2 text-center text-muted">{periodLabel} <span className="text-faint">· {zl}</span></span>
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
                guest={!p.teams.includes(team)}
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
                onOpenCard={(el, duty, overlapped) => openCard(el, duty, p, overlapped)}
                onCloseCard={() => setCard(null)}
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
                  if (e.type === 'pointercancel') return
                  if (Math.abs(e.clientX - d.x0) < 8) {
                    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x instanceof HTMLElement && x.dataset.dutyKey)
                    const hit = el && rows.find((r) => r.p.id === me.id)?.items.find((it) => dutyKey(it.span) === (el as HTMLElement).dataset.dutyKey)
                    const myRow = rows.find((r) => r.p.id === me.id)
                    if (el && hit && myRow) openCard(el, hit.span, myRow.p, myRow.overlaps.some((o) => hit.span.start < o.end && hit.span.end > o.start))
                    return
                  }
                  if (!teamCals.length) { toast('У команды нет календаря, куда записать дежурство'); return }
                  const raw1 = timeAt(e.clientX)
                  const id = pickCalendar(teamCals, me.id, rows.find((r) => r.p.id === me.id)?.spans ?? [], Math.min(d.time0, raw1), Math.max(d.time0, raw1))
                  const pc = teamCals.find((c) => c.id === id)
                  const snap = snapDuty(d.time0, raw1, calendarHandoff(pc?.layers ?? []), pc?.timezone ?? tz, Date.now())
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
                  setDrag({ kind: 'move', span: duty, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, over: overMe(e.clientX, e.clientY) })
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
                  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) {
                    const row = rows.find((r) => r.p.id === duty.personId)
                    if (row) openCard(e.currentTarget, duty, row.p, row.overlaps.some((o) => duty.start < o.end && duty.end > o.start))
                    return
                  }
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
                      onMouseEnter={(e) => showTip(e, 'Нет дежурного', [c.gapNames || 'Календарь команды', `${fmtDT(c.start, tz)} — ${fmtDT(c.end, tz)} ${zl}`, 'Дыра в видимом окне. Счётчик на главной считает только текущий момент.'])}
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
                <div className="absolute top-1 left-1 rounded bg-danger px-1 py-0.5 text-[10px] font-medium whitespace-nowrap text-white">{fmtT(now, tz)}</div>
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

      {card && <BarCard info={card} onClose={() => setCard(null)} />}

      {tip && !drag && !card && (
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
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{fmtDT(snapped.start, selTz)} — {fmtDT(snapped.end, selTz)} {tzLabel(selTz)}</p>
                <p className="text-sm text-muted">{fmtDur(snapped.end - snapped.start)} · передача смены {handoff}</p>
                {snapped.shifted && <p className="mt-2 text-sm text-muted">Начало сдвинуто вперёд: дежурство в прошлом не создаётся.</p>}
              </>
            )
          ) : pop.type === 'swap' ? (
            <>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{(() => { const ptz = state.calendars.find((c) => c.id === pop.calendarId)?.timezone ?? tz; return `${fmtDT(pop.start, ptz)} — ${fmtDT(pop.end, ptz)} ${tzLabel(ptz)}` })()}</p>
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
    <div ref={cardRef} role="dialog" aria-label={title} data-testid="duty-popover" className="popover-in fixed z-50 w-[320px] rounded-xl border border-line bg-surface p-4 shadow-card" style={{ left, top, pointerEvents: armed ? 'auto' : 'none' }}>
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>,
    document.body,
  )
}

function PersonRow({ person, me, lead, guest, items, overlaps, laneCount, box, span, shade, gaps, drop, preview, rowRef, trackRef, hint, moving, onTip, onHideTip, onOpenCard, onCloseCard, onSelectDown, onSelectMove, onSelectUp, onMoveDown, onMove, onMoveUp }: {
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
  onOpenCard: (el: Element, span: DutySpan, overlapped: boolean) => void
  onCloseCard: () => void
  onSelectDown: (e: PointerEvent<HTMLDivElement>) => void
  onSelectMove: (e: PointerEvent<HTMLDivElement>) => void
  onSelectUp: (e: PointerEvent<HTMLDivElement>) => void
  onMoveDown: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
  onMove: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
  onMoveUp: (e: PointerEvent<HTMLDivElement>, span: DutySpan) => void
}) {
  const { state } = useStore()
  const height = Math.max(56, 18 + laneCount * 24)
  return (
    <div ref={rowRef} data-row={me ? 'me' : undefined} className={`flex border-t border-line ${drop ? 'bg-accent-soft' : ''}`}>
      <div className={`sticky left-0 z-20 flex w-48 shrink-0 flex-col justify-center px-4 ${drop ? 'bg-accent-soft' : 'bg-surface'}`}>
        <div className="truncate text-sm font-medium" title={person.name}>{person.name}</div>
        <div className="truncate text-xs text-faint">{hint ?? (lead ? 'Лид календаря' : guest ? person.orgUnit : person.title)}</div>
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
              key={dutyKey(duty)}
              data-bar
              data-duty-key={dutyKey(duty)}
              data-kind={hatch ? 'substitution' : undefined}
              role="button"
              tabIndex={0}
              aria-label={`${person.name}: ${duty.layerName}, ${duty.calendarName}, ${fmtDT(duty.start)} — ${fmtDT(duty.end)}${hatch ? ', подмена' : ''}${overlapped ? ', конфликт' : ''}`}
              onFocus={(e) => onOpenCard(e.currentTarget, duty, overlapped)}
              onBlur={(e) => { if (blurClosesCard(e.relatedTarget)) onCloseCard() }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenCard(e.currentTarget, duty, overlapped) } }}
              className={`absolute flex items-center overflow-hidden rounded-md px-1 text-[10px] font-medium whitespace-nowrap text-white focus-visible:ring-2 focus-visible:ring-ink ${me ? 'cursor-pointer' : 'cursor-grab'} ${dim ? 'opacity-40' : ''}`}
              style={{
                ...box(duty.start, duty.end),
                top: 10 + lane * 24,
                height: 20,
                background: personColor(duty.personId),
                ...(hatch ? SUBST_STYLE : {}),
              }}
              onPointerDown={(e) => { if (me) e.preventDefault(); onMoveDown(e, duty) }}
              onPointerMove={(e) => onMove(e, duty)}
              onPointerUp={(e) => onMoveUp(e, duty)}
              onPointerCancel={(e) => onMoveUp(e, duty)}
              onMouseEnter={(e) => onTip(e, person.name, [
                `${duty.layerName}${hatch ? ' · подмена' : ''} · ${duty.calendarName}`,
                ...(duty.replacedId ? [`вместо ${state.people.find((x) => x.id === duty.replacedId)?.name ?? ''}`] : []),
                `${fmtDT(duty.start)} — ${fmtDT(duty.end)} · ${fmtDur(duty.end - duty.start)}`,
                ...(duty.note ? [duty.note] : []),
                ...(overlapped ? ['Оранжевая рамка с «!» — две смены сразу'] : []),
              ])}
              onMouseLeave={onHideTip}
            >
              {wide && ((duty.end - duty.start) / span) * 640 >= shortName(person.name).length * 6.1 + 8 ? shortName(person.name) : ''}
            </div>
          )
        })}
        {overlaps.map((o) => (
          <div key={o.start} data-conflict className="pointer-events-none absolute rounded-sm" style={{ ...box(o.start, o.end), top: 6, bottom: 6, ...CONFLICT_STYLE }}>
            <span aria-hidden className="absolute -top-2 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warn text-[9px] font-bold text-white">!</span>
          </div>
        ))}
        {preview && <div className="pointer-events-none absolute top-1 bottom-1 rounded-md bg-accent/15 ring-1 ring-accent/50" style={box(preview[0], preview[1])} />}
      </div>
    </div>
  )
}
