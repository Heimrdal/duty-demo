import { useMemo, useState } from 'react'
import { addDays, calendarLaunch, calendarOnCall, fmtDT, fmtDur, HOUR, samplePoints, startOfDay, weekday, type Segment } from './engine'
import { layerLanes, type Lane } from './lanes'
import { useStore } from './store'
import { fmtTz, tzName, zparts } from './tz'
import { barRect, BarCard, blurClosesCard, KIND_META, personColor, REMOVED_STYLE, shortName, SUBST_STYLE, type BarAction, type BarInfo } from './ui'
import type { Calendar, Shift } from './types'

/** Что знает таймлайн о смене, по которой кликнули: для действий лида. */
export interface BarTarget { personId: string; start: number; end: number; shift?: Shift; layerId?: string; removal?: Shift; slotId?: string }


export function Timeline({ c, from, days, now, actions, onFill }: { c: Calendar; from: number; days: number; now: number; actions?: (t: BarTarget) => BarAction[]; onFill?: (start: number, end: number) => void }) {
  const { state } = useStore()
  const tz = c.timezone
  const [info, setInfo] = useState<BarInfo | null>(null)
  const a = from
  const b = addDays(from, days, tz)
  const span = b - a
  const step = days > 14 ? 2 * HOUR : HOUR
  // точные границы разовых смен и снятий (снятие «с текущей минуты» не округляется до часа)
  const breaks = useMemo(() => c.shifts.flatMap((s) => [+new Date(s.start), +new Date(s.end)]), [c.shifts])
  const pts = useMemo(() => samplePoints(a, b, step, breaks), [a, b, step, breaks])
  const nextPt = (i: number) => (i + 1 < pts.length ? pts[i + 1] : Math.min(b, pts[i] + step))
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = layerLanes(c, a, b, step, breaks)
    // итоговые дорожки: человек остаётся на своей дорожке, пока дежурит (стабильная раскладка)
    const lanesP: (string | null)[] = []
    const finalSegs: Segment[][] = []
    for (let k = 0; k < pts.length; k++) {
      const t = pts[k]
      const tEnd = nextPt(k)
      const ids = calendarOnCall(c, t + 1).map((e) => e.personId)
      for (let i = 0; i < lanesP.length; i++) if (lanesP[i] && !ids.includes(lanesP[i]!)) lanesP[i] = null
      for (const id of ids) if (!lanesP.includes(id)) { const free = lanesP.indexOf(null); if (free >= 0) lanesP[free] = id; else lanesP.push(id) }
      lanesP.forEach((id, i) => {
        finalSegs[i] ??= []
        if (!id) return
        const arr = finalSegs[i]
        const last = arr[arr.length - 1]
        const hatch = c.shifts.some((s) => s.personId === id && s.replacesPersonId && t + 1 >= +new Date(s.start) && t + 1 < +new Date(s.end))
        if (last && last.personId === id && last.end === t && last.hatch === hatch) last.end = tEnd
        else arr.push({ start: t, end: tEnd, personId: id, hatch })
      })
    }
    finalSegs.forEach((segs, i) => out.push({ key: 'final' + i, label: i === 0 ? 'ИТОГ: кому придёт алерт' : '', kind: 'final', final: true, segs }))
    if (!finalSegs.length) out.push({ key: 'final0', label: 'ИТОГ: кому придёт алерт', kind: 'final', final: true, segs: [] })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, a, b, step, tz, pts, breaks])

  const gaps = useMemo(() => {
    const out: { start: number; end: number }[] = []
    let cur: { start: number; end: number } | null = null
    for (let k = 0; k < pts.length; k++) {
      const t = pts[k]
      // до первого старта календаря — «ещё не запущено», это не дыра
      const empty = t + 1 >= calendarLaunch(c) && calendarOnCall(c, t + 1).length === 0
      if (empty) {
        if (cur) cur.end = nextPt(k)
        else cur = { start: t, end: nextPt(k) }
      } else if (cur) { out.push(cur); cur = null }
    }
    if (cur) out.push(cur)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, pts])

  const byId = (id: string) => state.people.find((p) => p.id === id)
  /** Клик по пустому месту дорожки внутри дыры — «Поставить дежурного» на этот интервал. */
  const fillAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onFill || e.target !== e.currentTarget) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = a + ((e.clientX - r.left) / r.width) * span
    const g = gaps.find((x) => t >= x.start && t < x.end && x.end > now)
    if (g) onFill(Math.max(g.start, now), g.end)
  }
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
          <div key={ln.key} data-lane={ln.key} data-lane-label={ln.label} className={`flex border-b border-line ${ln.final ? 'bg-surface-2' : ''}`}>
            <div className="w-52 shrink-0 px-3 py-1.5 text-xs">
              {ln.label && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ln.final ? 'var(--c-ink)' : KIND_META[ln.kind as keyof typeof KIND_META]?.color }} />
                  <span className={`truncate ${ln.final ? 'font-medium' : ''}`} title={ln.label}>{ln.label}</span>
                </div>
              )}
              {ln.sub && <div className="pl-3.5 text-faint">{ln.sub}</div>}
            </div>
            <div className="relative h-9 flex-1" onClick={(e) => fillAt(e)}>
              {dayList.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-line" style={{ left: `${(i / days) * 100}%` }} />)}
              {ln.segs.map((s, i) => {
                const p = byId(s.personId)
                const left = ((s.start - a) / span) * 100
                const width = ((s.end - s.start) / span) * 100
                const col = personColor(s.personId)
                const label = p ? shortName(p.name) : ''
                const layerName = ln.final ? 'Итог' : ln.key === 'shifts' ? (s.hatch ? 'Подмена' : 'Разовое') : c.layers.find((x) => ln.key.startsWith(x.id))?.name ?? ln.label
                const replacedName = s.replaced ? byId(s.replaced)?.name : undefined
                const removal = s.removed && s.shiftId ? c.shifts.find((x) => x.id === s.shiftId) : undefined
                const lines = [
                  `${c.name} · ${s.removed ? `${layerName} · снят(а) с дежурства` : s.hatch && ln.key !== 'shifts' ? `${layerName}, подмена` : layerName}`,
                  ...(replacedName ? [`Подмена: вместо ${replacedName}`] : []),
                  `${fmtDT(s.start, tz)} — ${fmtDT(s.end, tz)} · ${fmtDur(s.end - s.start)}${s.start <= a || s.end >= b ? ' (видимая часть)' : ''}`,
                  `Часовой пояс: ${tzName(tz)}`,
                  ...(s.extra ? [s.extra] : []),
                  ...(removal?.note ? [`Причина: ${removal.note}`] : []),
                ]
                const shift = s.removed ? undefined : s.shiftId ? c.shifts.find((x) => x.id === s.shiftId) : ln.final ? c.shifts.find((x) => x.personId === s.personId && +new Date(x.start) <= s.start + 1 && s.start < +new Date(x.end)) : undefined
                const open = (el: Element) => p && setInfo({ title: p.name, lines, rect: barRect(el), actions: actions?.({ personId: s.personId, start: removal ? +new Date(removal.start) : s.start, end: removal ? +new Date(removal.end) : s.end, shift, layerId: ln.layerId, removal }) })
                return (
                  <div key={i} data-bar role="button" tabIndex={0}
                    aria-label={p ? `${p.name}${s.removed ? ' (снят)' : ''}, ${lines.join(', ')}` : undefined}
                    title={replacedName ? `${p?.name ?? ''} — подмена, вместо ${replacedName}` : undefined}
                    data-removed={s.removed ? 'true' : undefined}
                    data-subst={s.replaced ? s.replaced : undefined}
                    onClick={(e) => open(e.currentTarget)}
                    onFocus={(e) => open(e.currentTarget)}
                    onBlur={(e) => { if (blurClosesCard(e.relatedTarget)) setInfo(null) }}
                    className={`absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-md px-1 text-[10px] leading-7 font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ink ${s.removed ? 'text-muted line-through' : 'text-white'}`}
                    style={{
                      left: `${left}%`, width: `calc(${width}% - 2px)`, background: col,
                      ...(s.hatch ? SUBST_STYLE : {}),
                      ...(s.removed ? REMOVED_STYLE : {}),
                    }}>
                    {width > 5 ? (s.removed ? `снят · ${label}` : s.replaced && width > 9 ? `${label} · подмена` : label) : ''}
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
            {calendarLaunch(c) > a && (() => {
              const launch = calendarLaunch(c)
              const width = ((Math.min(b, launch) - a) / span) * 100
              const label = Number.isFinite(launch) ? `Ещё не запущено · старт ${fmtDT(launch, tz)}` : 'Ещё не запущено · графика нет'
              return <div data-testid="prelaunch" title={label} className="absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md bg-surface-2 px-1 text-[11px] whitespace-nowrap text-muted" style={{ left: 0, width: `${width}%` }}>{width > 8 ? (width > 25 ? label : 'Ещё не запущено') : ''}</div>
            })()}
            {gaps.map((g) => {
              const left = ((g.start - a) / span) * 100
              const width = ((g.end - g.start) / span) * 100
              const fillable = onFill && g.end > now
              const text = width > 8 ? (fillable && width > 14 ? 'Нет дежурного · Поставить' : 'Нет дежурного') : ''
              const cls = 'gap-band absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md px-1 text-[11px] whitespace-nowrap text-danger'
              return fillable ? (
                <button key={g.start} type="button" data-testid="gap-fill" onMouseDown={(e) => e.preventDefault()} onClick={() => onFill(Math.max(g.start, now), g.end)}
                  aria-label={`Нет дежурного: ${fmtDT(g.start, tz)} — ${fmtDT(g.end, tz)}. Поставить дежурного`}
                  className={`${cls} cursor-pointer text-left hover:ring-1 hover:ring-danger focus-visible:ring-2 focus-visible:ring-danger`} style={{ left: `${left}%`, width: `${width}%` }}>{text}</button>
              ) : <div key={g.start} className={cls} style={{ left: `${left}%`, width: `${width}%` }}>{text}</div>
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
        const people = new Map<string, { kind: string; replaced?: string }>()
        for (let h = 0; h < 24; h += 3) {
          for (const e of calendarOnCall(c, d + h * HOUR + 1)) if (!people.has(e.personId)) people.set(e.personId, { kind: e.kind, replaced: e.replaced })
        }
        const isToday = today === d
        return (
          <div key={i} className={`min-h-24 border-t border-l border-line p-1 ${inMonth ? '' : 'text-faint'} ${isToday ? 'bg-accent-soft' : ''}`}>
            <div className="mb-1 font-semibold">{zparts(d, tz).d}</div>
            <div className="space-y-0.5">
              {[...people].map(([id, { kind, replaced }]) => {
                const person = byId(id)
                const instead = replaced ? byId(replaced)?.name : undefined
                return (
                  <div key={id} data-subst={kind === 'override' ? replaced ?? 'true' : undefined} title={person ? `${person.name}${kind === 'override' ? ` · подмена${instead ? `, вместо ${instead}` : ''}` : kind === 'oneoff' ? ' · разовое' : ''}` : ''} className="truncate rounded px-1" style={{ background: personColor(id) + '22', borderLeft: `3px solid ${personColor(id)}`, ...(kind === 'override' ? { backgroundImage: SUBST_STYLE.backgroundImage, outline: '1px dashed ' + personColor(id), outlineOffset: '-1px' } : {}) }}>
                    {person ? shortName(person.name) : ''}{kind === 'override' && <span className="sr-only"> (подмена{instead ? `, вместо ${instead}` : ''})</span>}
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
