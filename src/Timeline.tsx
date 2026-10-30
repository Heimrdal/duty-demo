import { useMemo, useState } from 'react'
import { addDays, calendarOnCall, fmtDT, fmtDur, HOUR, layerSlot, sampleSegments, startOfDay, weekday, type Segment } from './engine'
import { useStore } from './store'
import { fmtTz, tzName, zparts } from './tz'
import { barRect, BarCard, blurClosesCard, KIND_META, personColor, shortName, SUBST_STYLE, type BarAction, type BarInfo } from './ui'
import type { Calendar, Shift } from './types'

/** Что знает таймлайн о смене, по которой кликнули: для действий лида. */
export interface BarTarget { personId: string; start: number; end: number; shift?: Shift }

interface Lane { key: string; label: string; sub?: string; kind: string; segs: (Segment & { shiftId?: string })[]; final?: boolean }

export function Timeline({ c, from, days, now, actions }: { c: Calendar; from: number; days: number; now: number; actions?: (t: BarTarget) => BarAction[] }) {
  const { state } = useStore()
  const tz = c.timezone
  const [info, setInfo] = useState<BarInfo | null>(null)
  const a = from
  const b = addDays(from, days, tz)
  const span = b - a
  const step = days > 14 ? 2 * HOUR : HOUR
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = []
    for (const l of c.layers) {
      const k = Math.min(l.parallel, l.participants.length) || 1
      for (let i = 0; i < k; i++) {
        out.push({ key: l.id + i, label: i === 0 ? l.name : '', sub: k > 1 ? `место ${i + 1} из ${k}` : undefined, kind: l.kind, segs: sampleSegments(a, b, (t) => layerSlot(l, t, i, tz), step) })
      }
    }
    if (c.shifts.length) {
      out.push({
        key: 'shifts', label: 'Разовые и подмены', kind: 'override',
        segs: c.shifts.map((s) => ({ start: Math.max(a, +new Date(s.start)), end: Math.min(b, +new Date(s.end)), personId: s.personId, extra: s.note, hatch: !!s.replacesPersonId, shiftId: s.id })).filter((s) => s.end > s.start),
      })
    }
    // итоговые дорожки: человек остаётся на своей дорожке, пока дежурит (стабильная раскладка)
    const lanesP: (string | null)[] = []
    const finalSegs: Segment[][] = []
    for (let t = a; t < b; t += step) {
      const ids = calendarOnCall(c, t + 1).map((e) => e.personId)
      for (let i = 0; i < lanesP.length; i++) if (lanesP[i] && !ids.includes(lanesP[i]!)) lanesP[i] = null
      for (const id of ids) if (!lanesP.includes(id)) { const free = lanesP.indexOf(null); if (free >= 0) lanesP[free] = id; else lanesP.push(id) }
      lanesP.forEach((id, i) => {
        finalSegs[i] ??= []
        if (!id) return
        const arr = finalSegs[i]
        const last = arr[arr.length - 1]
        const hatch = c.shifts.some((s) => s.personId === id && s.replacesPersonId && t + 1 >= +new Date(s.start) && t + 1 < +new Date(s.end))
        if (last && last.personId === id && last.end === t && last.hatch === hatch) last.end = t + step
        else arr.push({ start: t, end: t + step, personId: id, hatch })
      })
    }
    finalSegs.forEach((segs, i) => out.push({ key: 'final' + i, label: i === 0 ? 'ИТОГ: кому придёт алерт' : '', kind: 'final', final: true, segs }))
    if (!finalSegs.length) out.push({ key: 'final0', label: 'ИТОГ: кому придёт алерт', kind: 'final', final: true, segs: [] })
    return out
  }, [c, a, b, step, tz])

  const gaps = useMemo(() => {
    const out: { start: number; end: number }[] = []
    let cur: { start: number; end: number } | null = null
    for (let t = a; t < b; t += step) {
      const empty = calendarOnCall(c, t + 1).length === 0
      if (empty) {
        if (cur) cur.end = t + step
        else cur = { start: t, end: t + step }
      } else if (cur) { out.push(cur); cur = null }
    }
    if (cur) out.push(cur)
    return out
  }, [c, a, b, step])

  const byId = (id: string) => state.people.find((p) => p.id === id)
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i, tz))
  const today = startOfDay(now, tz)
  const nowPct = ((now - a) / span) * 100

  return (
    <div className="overflow-x-auto scroll-thin">
      <div style={{ minWidth: Math.max(900, days * 46) }}>
        <div className="flex border-b border-line text-xs text-muted">
          <div className="w-52 shrink-0 px-3 py-2 font-medium">Слой</div>
          <div className="relative flex flex-1">
            {dayList.map((d, i) => {
              const we = weekday(d, tz) >= 5
              return (
                <div key={i} className={`flex-1 border-l border-line px-1 py-1 text-center ${we ? 'weekend' : ''} ${today === d ? 'font-medium text-accent' : ''}`}>
                  {fmtTz(d, tz, { weekday: 'short' })}<br />{fmtTz(d, tz, { day: '2-digit', month: '2-digit' })}
                </div>
              )
            })}
          </div>
        </div>
        {lanes.map((ln) => (
          <div key={ln.key} className={`flex border-b border-line ${ln.final ? 'bg-surface-2' : ''}`}>
            <div className="w-52 shrink-0 px-3 py-1.5 text-xs">
              {ln.label && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ln.final ? 'var(--c-ink)' : KIND_META[ln.kind as keyof typeof KIND_META]?.color }} />
                  <span className={`truncate ${ln.final ? 'font-medium' : ''}`} title={ln.label}>{ln.label}</span>
                </div>
              )}
              {ln.sub && <div className="pl-3.5 text-faint">{ln.sub}</div>}
            </div>
            <div className="relative h-9 flex-1">
              {dayList.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-line" style={{ left: `${(i / days) * 100}%` }} />)}
              {ln.segs.map((s, i) => {
                const p = byId(s.personId)
                const left = ((s.start - a) / span) * 100
                const width = ((s.end - s.start) / span) * 100
                const col = personColor(s.personId)
                const label = p ? shortName(p.name) : ''
                const layerName = ln.final ? 'Итог' : ln.key === 'shifts' ? (s.hatch ? 'Подмена' : 'Разовое') : c.layers.find((x) => ln.key.startsWith(x.id))?.name ?? ln.label
                const lines = [
                  `${c.name} · ${s.hatch && ln.key !== 'shifts' ? `${layerName}, подмена` : layerName}`,
                  `${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)} · ${fmtDur(s.end - s.start)}`,
                  `Часовой пояс: ${tzName(tz)}`,
                  ...(s.extra ? [s.extra] : []),
                ]
                const shift = s.shiftId ? c.shifts.find((x) => x.id === s.shiftId) : ln.final ? c.shifts.find((x) => x.personId === s.personId && +new Date(x.start) <= s.start + 1 && s.start < +new Date(x.end)) : undefined
                const open = (el: Element) => p && setInfo({ title: p.name, lines, rect: barRect(el), actions: actions?.({ personId: s.personId, start: s.start, end: s.end, shift }) })
                return (
                  <div key={i} data-bar role="button" tabIndex={0}
                    aria-label={p ? `${p.name}, ${lines.join(', ')}` : undefined}
                    onClick={(e) => open(e.currentTarget)}
                    onFocus={(e) => open(e.currentTarget)}
                    onBlur={(e) => { if (blurClosesCard(e.relatedTarget)) setInfo(null) }}
                    className="absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-md px-1 text-[10px] leading-7 font-medium whitespace-nowrap text-white focus-visible:ring-2 focus-visible:ring-ink"
                    style={{
                      left: `${left}%`, width: `calc(${width}% - 2px)`, background: col,
                      ...(s.hatch ? SUBST_STYLE : {}),
                    }}>
                    {width > 5 ? label : ''}
                  </div>
                )
              })}
              {nowPct >= 0 && nowPct <= 100 && <div className="absolute top-0 bottom-0 z-10 w-px bg-danger" style={{ left: `${nowPct}%` }} />}
            </div>
          </div>
        ))}
        <div className="flex border-b border-line">
          <div className="w-52 shrink-0 px-3 py-1.5 text-xs text-muted">Покрытие</div>
          <div className="relative h-8 flex-1">
            {gaps.map((g) => {
              const left = ((g.start - a) / span) * 100
              const width = ((g.end - g.start) / span) * 100
              return <div key={g.start} className="gap-band absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md px-1 text-[11px] text-danger" style={{ left: `${left}%`, width: `${width}%` }}>{width > 8 ? 'Нет дежурного' : ''}</div>
            })}
            {nowPct >= 0 && nowPct <= 100 && <div className="absolute top-0 bottom-0 z-10 w-px bg-danger" style={{ left: `${nowPct}%` }} />}
          </div>
        </div>
      </div>
      {info && <BarCard info={info} onClose={() => setInfo(null)} />}
    </div>
  )
}

export function MonthGrid({ c, month, now }: { c: Calendar; month: number; now: number }) {
  const { state } = useStore()
  const tz = c.timezone
  const first = month
  const monthNo = zparts(first, tz).m
  const gridStart = addDays(first, -weekday(first, tz), tz)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i, tz))
  const today = startOfDay(now, tz)
  const byId = (id: string) => state.people.find((p) => p.id === id)
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg text-xs">
      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => <div key={d} className="px-2 py-1 font-medium text-faint">{d}</div>)}
      {cells.map((d, i) => {
        const inMonth = zparts(d, tz).m === monthNo
        const people = new Map<string, string>()
        for (let h = 0; h < 24; h += 3) {
          for (const e of calendarOnCall(c, d + h * HOUR + 1)) if (!people.has(e.personId)) people.set(e.personId, e.kind)
        }
        const isToday = today === d
        return (
          <div key={i} className={`min-h-24 border-t border-l border-line p-1 ${inMonth ? '' : 'text-faint'} ${isToday ? 'bg-accent-soft' : ''}`}>
            <div className="mb-1 font-semibold">{zparts(d, tz).d}</div>
            <div className="space-y-0.5">
              {[...people].map(([id, kind]) => {
                const person = byId(id)
                return (
                  <div key={id} title={person ? `${person.name}${kind === 'override' ? ' · подмена' : kind === 'oneoff' ? ' · разовое' : ''}` : ''} className="truncate rounded px-1" style={{ background: personColor(id) + '22', borderLeft: `3px solid ${personColor(id)}`, ...(kind === 'override' ? { backgroundImage: SUBST_STYLE.backgroundImage, outline: '1px dashed ' + personColor(id), outlineOffset: '-1px' } : {}) }}>
                    {person ? shortName(person.name) : ''}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
