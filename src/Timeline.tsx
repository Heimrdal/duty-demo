import { useMemo } from 'react'
import { addDays, calendarOnCall, DAY, fmtDT, HOUR, layerSlot, sampleSegments, startOfDay, type Segment } from './engine'
import { useStore } from './store'
import { KIND_META, personColor } from './ui'
import type { Calendar } from './types'

interface Lane { key: string; label: string; sub?: string; kind: string; segs: Segment[]; final?: boolean }

export function Timeline({ c, from, days, now }: { c: Calendar; from: Date; days: number; now: number }) {
  const { state } = useStore()
  const a = from.getTime()
  const b = addDays(from, days).getTime()
  const span = b - a
  const step = days > 14 ? 2 * HOUR : HOUR
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = []
    for (const l of c.layers) {
      const k = Math.min(l.parallel, l.participants.length) || 1
      for (let i = 0; i < k; i++) {
        out.push({ key: l.id + i, label: i === 0 ? l.name : '', sub: k > 1 ? `место ${i + 1} из ${k}` : undefined, kind: l.kind, segs: sampleSegments(a, b, (t) => layerSlot(l, t, i), step) })
      }
    }
    if (c.shifts.length) {
      out.push({
        key: 'shifts', label: 'Взятые дежурства / подмены', kind: 'override',
        segs: c.shifts.map((s) => ({ start: Math.max(a, +new Date(s.start)), end: Math.min(b, +new Date(s.end)), personId: s.personId, extra: s.note })).filter((s) => s.end > s.start),
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
        if (last && last.personId === id && last.end === t) last.end = t + step
        else arr.push({ start: t, end: t + step, personId: id })
      })
    }
    finalSegs.forEach((segs, i) => out.push({ key: 'final' + i, label: i === 0 ? 'ИТОГ: кому придёт алерт' : '', kind: 'final', final: true, segs }))
    if (!finalSegs.length) out.push({ key: 'final0', label: 'ИТОГ: кому придёт алерт', kind: 'final', final: true, segs: [] })
    return out
  }, [c, a, b, step])

  const byId = (id: string) => state.people.find((p) => p.id === id)
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i))
  const nowPct = ((now - a) / span) * 100

  return (
    <div className="overflow-x-auto scroll-thin">
      <div style={{ minWidth: Math.max(900, days * 46) }}>
        <div className="flex border-b border-slate-200 text-xs text-slate-500">
          <div className="w-56 shrink-0 px-2 py-1 font-medium">Слой</div>
          <div className="relative flex flex-1">
            {dayList.map((d, i) => {
              const we = d.getDay() === 0 || d.getDay() === 6
              return (
                <div key={i} className={`flex-1 border-l border-slate-200 px-1 py-1 text-center ${we ? 'bg-rose-50 text-rose-600' : ''} ${startOfDay(now).getTime() === d.getTime() ? 'font-bold text-blue-700' : ''}`}>
                  {d.toLocaleDateString('ru-RU', { weekday: 'short' })}<br />{d.getDate()}.{String(d.getMonth() + 1).padStart(2, '0')}
                </div>
              )
            })}
          </div>
        </div>
        {lanes.map((ln) => (
          <div key={ln.key} className={`flex border-b border-slate-100 ${ln.final ? 'bg-slate-50' : ''}`}>
            <div className="w-56 shrink-0 px-2 py-1.5 text-xs">
              {ln.label && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ln.final ? '#0f172a' : KIND_META[ln.kind as keyof typeof KIND_META]?.color }} />
                  <span className={`truncate ${ln.final ? 'font-bold' : 'font-medium'}`} title={ln.label}>{ln.label}</span>
                </div>
              )}
              {ln.sub && <div className="pl-4 text-slate-400">{ln.sub}</div>}
            </div>
            <div className="relative h-9 flex-1">
              {dayList.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: `${(i / days) * 100}%` }} />)}
              {ln.segs.map((s, i) => {
                const p = byId(s.personId)
                const left = ((s.start - a) / span) * 100
                const width = ((s.end - s.start) / span) * 100
                const col = personColor(s.personId)
                const override = ln.kind === 'override'
                return (
                  <div key={i} title={`${p?.name}\n${fmtDT(s.start)} — ${fmtDT(s.end)}${s.extra ? '\n' + s.extra : ''}`}
                    className="absolute top-1 bottom-1 overflow-hidden rounded-md px-1.5 text-[11px] leading-7 font-medium whitespace-nowrap text-white shadow-sm"
                    style={{
                      left: `${left}%`, width: `calc(${width}% - 2px)`, background: col,
                      backgroundImage: override ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px)' : undefined,
                      outline: ln.final ? '2px solid #0f172a22' : undefined,
                    }}>
                    {(s.end - s.start) / DAY * (Math.max(900, days * 46) / days) > 44 ? p?.name.split(' ').reverse().join(' ').replace(/^(\S+) (\S)\S*$/, '$1 $2.') : ''}
                  </div>
                )
              })}
              {nowPct >= 0 && nowPct <= 100 && <div className="absolute top-0 bottom-0 z-10 w-0.5 bg-red-500" style={{ left: `${nowPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MonthGrid({ c, month, now }: { c: Calendar; month: Date; now: number }) {
  const { state } = useStore()
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startPad = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -startPad)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const byId = (id: string) => state.people.find((p) => p.id === id)
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 text-xs">
      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => <div key={d} className="bg-slate-50 px-2 py-1 font-medium text-slate-500">{d}</div>)}
      {cells.map((d, i) => {
        const inMonth = d.getMonth() === month.getMonth()
        const people = new Map<string, string>()
        for (let h = 0; h < 24; h += 3) {
          for (const e of calendarOnCall(c, d.getTime() + h * HOUR + 1)) if (!people.has(e.personId)) people.set(e.personId, e.kind)
        }
        const isToday = startOfDay(now).getTime() === d.getTime()
        return (
          <div key={i} className={`min-h-24 border-t border-l border-slate-100 p-1 ${inMonth ? 'bg-white' : 'bg-slate-50 text-slate-400'} ${isToday ? 'ring-2 ring-blue-500 ring-inset' : ''}`}>
            <div className="mb-1 font-semibold">{d.getDate()}</div>
            <div className="space-y-0.5">
              {[...people].map(([id, kind]) => (
                <div key={id} className="flex items-center gap-1 truncate rounded px-1" style={{ background: personColor(id) + '22', borderLeft: `3px solid ${personColor(id)}` }}>
                  {kind === 'override' && '★'} {byId(id)?.name.split(' ')[1] ?? ''} {byId(id)?.name.split(' ')[0][0]}.
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
