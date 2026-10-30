import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { addDays, fmtDT, fmtDur, HOUR, isManual, startOfDay, weekday } from './engine'
import { useStore } from './store'
import { atDay, dayNumber, fmtTz, tzName, zparts } from './tz'
import type { BarTarget } from './Timeline'
import { barRect, BarCard, KIND_META, Menu, personColor, type BarAction, type BarInfo } from './ui'
import type { Calendar, Layer } from './types'
import { cardTime, snapToHour, surnameInitial, weekBoard, weekTitle, type WeekCard } from './week'

export interface WeekBoardProps {
  c: Calendar
  weeks: number[] // понедельники недель
  month?: number // если задан — дни вне месяца бледнее
  now: number
  canEdit: boolean
  actions: (t: BarTarget) => BarAction[]
  onFill?: (start: number, end: number) => void
  onCreate: (l: Layer, start: number, end: number) => void
  onCopyWeek: (l: Layer, ws: number) => void
  onRepeat: (l: Layer, ws: number) => void
  onEditLayer: (l: Layer) => void
  onAddLayer: () => void
}

/** Расписание по неделям: 7 колонок-дней, слои — группы строк, смены — карточки «Фамилия И. · 08:00 – 20:00 (12ч)». */
export function WeekBoard(props: WeekBoardProps) {
  const { c, weeks, canEdit, onAddLayer } = props
  const [info, setInfo] = useState<BarInfo | null>(null)
  return (
    <div className="space-y-8" data-testid="week-board">
      {weeks.map((ws) => <WeekBlock key={ws} ws={ws} {...props} setInfo={setInfo} />)}
      {canEdit && (
        <button type="button" data-testid="add-layer" onClick={onAddLayer} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-3 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <span aria-hidden className="text-lg leading-none">+</span>Добавить слой
        </button>
      )}
      {!c.layers.length && !canEdit && <p className="text-sm text-muted">Слоёв пока нет.</p>}
      {info && <BarCard info={info} onClose={() => setInfo(null)} />}
    </div>
  )
}

const DAY_FMT = (t: number, tz: string) => `${fmtTz(t, tz, { weekday: 'short' }).replace('.', '').toUpperCase()}, ${zparts(t, tz).d}`

function WeekBlock({ c, ws, month, now, canEdit, actions, onFill, onCreate, onCopyWeek, onRepeat, onEditLayer, setInfo }: WeekBoardProps & { ws: number; setInfo: (x: BarInfo | null) => void }) {
  const { state } = useStore()
  const tz = c.timezone
  const we = addDays(ws, 7, tz)
  const span = we - ws
  const board = useMemo(() => weekBoard(c, ws), [c, ws])
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i, tz))
  const today = startOfDay(now, tz)
  const monthNo = month != null ? zparts(month, tz).m : null
  const pct = (t: number) => ((Math.max(ws, Math.min(we, t)) - ws) / span) * 100
  const byId = (id: string) => state.people.find((p) => p.id === id)
  const nowPct = now >= ws && now < we ? pct(now) : null
  const iso = fmtTz(ws, tz, { year: 'numeric', month: '2-digit', day: '2-digit' })

  const openCard = (el: Element, card: WeekCard, layer?: Layer) => {
    const p = byId(card.personId)
    if (!p) return
    const removal = card.state === 'removed' && card.shiftId ? c.shifts.find((x) => x.id === card.shiftId) : undefined
    const shift = card.state === 'subst' || (!layer && card.shiftId) ? c.shifts.find((x) => x.id === card.shiftId) : undefined
    const instead = card.replaced ? byId(card.replaced)?.name : undefined
    const lines = [
      `${c.name} · ${layer ? layer.name : shift?.replacesPersonId ? 'Подмена' : 'Разовое'}${layer && isManual(layer) ? ' (ручной график)' : ''}`,
      ...(card.state === 'removed' ? ['Снят(а) с дежурства'] : []),
      ...(instead ? [`Подмена: вместо ${instead}`] : []),
      `${fmtDT(card.start, tz)} — ${fmtDT(card.end, tz)} · ${fmtDur(card.active.reduce((s, x) => s + x.end - x.start, 0))}`,
      ...(card.active.length > 1 ? ['Штриховка — часы вне смены по правилам слоя'] : []),
      `Часовой пояс: ${tzName(tz)}`,
      ...(card.note ? [card.note] : []),
      ...(removal?.note ? [`Причина: ${removal.note}`] : []),
    ]
    setInfo({
      title: p.name, lines, rect: barRect(el),
      actions: actions({ personId: card.personId, start: removal ? +new Date(removal.start) : card.start, end: removal ? +new Date(removal.end) : card.end, shift, layerId: layer?.id, removal, slotId: card.state === 'normal' ? card.slotId : undefined }),
    })
  }

  return (
    <section data-testid="week-block" data-week={iso}>
      <h3 className="mb-2 text-sm font-medium">{weekTitle(ws, tz)}</h3>
      <div className="overflow-x-auto scroll-thin rounded-xl border border-line bg-surface">
        <div className="relative min-w-[1260px] md:min-w-[980px]">
          <div className="grid grid-cols-7 border-b border-line text-xs">
            {days.map((d) => {
              const out = monthNo != null && zparts(d, tz).m !== monthNo
              const isToday = d === today
              return <div key={d} data-day={d} className={`px-2 py-2 text-center ${isToday ? 'font-semibold text-accent' : out ? 'text-faint/60' : 'text-faint'} ${weekday(d, tz) >= 5 ? 'weekend' : ''}`}>{DAY_FMT(d, tz)}</div>
            })}
          </div>
          <div className="relative pb-2">
            {/* разделители дней */}
            <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-7">
              {days.map((d, i) => <div key={d} className={`${i ? 'border-l border-dashed border-line' : ''} ${weekday(d, tz) >= 5 ? 'weekend' : ''} ${monthNo != null && zparts(d, tz).m !== monthNo ? 'bg-surface-2/40' : ''}`} />)}
            </div>
            {board.groups.map((g) => (
              <div key={g.key} data-group={g.key} data-group-label={g.label} className="relative">
                <div className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs text-muted">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_META[g.kind as keyof typeof KIND_META]?.color ?? 'var(--c-ink)' }} />
                  <span className="font-medium text-ink">{g.label}</span>
                  {g.layer && isManual(g.layer) && <span className="text-faint">· ручной график</span>}
                  {g.layer && canEdit && <LayerMenu l={g.layer} ws={ws} now={now} tz={tz} onCreate={onCreate} onCopyWeek={onCopyWeek} onRepeat={onRepeat} onEditLayer={onEditLayer} />}
                </div>
                {g.rows.map((row, ri) => (
                  <LayerRow key={ri} c={c} layer={g.layer} row={row} first={ri === 0} gaps={ri === 0 ? g.gaps : []} ws={ws} we={we} now={now} canEdit={canEdit} onCreate={onCreate} openCard={openCard} byId={byId} />
                ))}
              </div>
            ))}
            {!board.groups.length && <p className="px-3 py-4 text-sm text-muted">В календаре нет слоёв.</p>}
            {/* итог: где во всём календаре никого нет */}
            {board.gaps.length > 0 && (
              <div className="relative mt-2 h-8 border-t border-line" data-testid="week-gaps">
                {board.gaps.map((x) => {
                  const fillable = onFill && x.end > now
                  const w = pct(x.end) - pct(x.start)
                  const cls = 'gap-band absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] whitespace-nowrap text-danger'
                  const text = w > 6 ? (fillable && w > 10 ? 'Нет дежурного · Поставить' : 'Нет дежурного') : ''
                  return fillable ? (
                    <button key={x.start} type="button" data-testid="gap-fill" onMouseDown={(e) => e.preventDefault()} onClick={() => onFill!(Math.max(x.start, now), x.end)}
                      aria-label={`Нет дежурного: ${fmtDT(x.start, tz)} — ${fmtDT(x.end, tz)}. Поставить дежурного`}
                      className={`${cls} cursor-pointer text-left hover:ring-1 hover:ring-danger`} style={{ left: `${pct(x.start)}%`, width: `${w}%` }}>{text}</button>
                  ) : <div key={x.start} className={cls} style={{ left: `${pct(x.start)}%`, width: `${w}%` }} title={`Нет дежурного: ${fmtDT(x.start, tz)} — ${fmtDT(x.end, tz)}`}>{text}</div>
                })}
              </div>
            )}
            {nowPct != null && <div aria-hidden data-testid="now-line" className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-danger" style={{ left: `${nowPct}%` }} />}
          </div>
        </div>
      </div>
    </section>
  )
}

function LayerMenu({ l, ws, now, tz, onCreate, onCopyWeek, onRepeat, onEditLayer }: { l: Layer; ws: number; now: number; tz: string } & Pick<WeekBoardProps, 'onCreate' | 'onCopyWeek' | 'onRepeat' | 'onEditLayer'>) {
  const manual = isManual(l)
  // «Добавить дежурство» с клавиатуры: ближайшие сутки этой недели с 08:00 до 20:00
  const day = Math.max(dayNumber(ws, tz), dayNumber(now, tz) + 1)
  const items = [
    ...(manual ? [
      { label: 'Добавить дежурство', onClick: () => onCreate(l, atDay(day, 8 * 60, tz), atDay(day, 20 * 60, tz)) },
      { label: 'Скопировать неделю на следующую', onClick: () => onCopyWeek(l, ws) },
      { label: 'Повторить неделю на N недель…', onClick: () => onRepeat(l, ws) },
    ] : []),
    { label: 'Изменить слой', onClick: () => onEditLayer(l) },
  ]
  return <span className="ml-1"><Menu label={`Действия со слоем «${l.name}»`} items={items} /></span>
}

function LayerRow({ c, layer, row, gaps, ws, we, now, canEdit, onCreate, openCard, byId }: {
  c: Calendar; layer?: Layer; row: WeekCard[]; first: boolean; gaps: { start: number; end: number }[]; ws: number; we: number; now: number; canEdit: boolean
  onCreate: WeekBoardProps['onCreate']; openCard: (el: Element, card: WeekCard, layer?: Layer) => void; byId: (id: string) => { name: string } | undefined
}) {
  const tz = c.timezone
  const span = we - ws
  const pct = (t: number) => ((Math.max(ws, Math.min(we, t)) - ws) / span) * 100
  const editable = !!layer && isManual(layer) && canEdit
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x0: number; a: number; b: number; moved: boolean } | null>(null)
  const frac = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return (clientX - r.left) / r.width }
  const floorNow = now - (now % HOUR)

  /** Клик без протягивания: пустое место ручного слоя — его дыра в пределах этих суток; иначе — час под курсором. */
  const clickInterval = (t: number): [number, number] => {
    const d0 = atDay(dayNumber(t, tz), 0, tz), d1 = addDays(d0, 1, tz)
    const g = gaps.find((x) => t >= x.start && t < x.end)
    if (g) {
      const a = Math.max(g.start, d0, t < floorNow + HOUR ? floorNow : -Infinity), b = Math.min(g.end, d1)
      if (b > a) return [a, b]
    }
    const a = snapToHour(ws, we, (t - ws) / span, tz, 'floor')
    return [a, a + HOUR]
  }
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!editable || e.button !== 0 || (e.target as HTMLElement).closest('[data-card]')) return
    const f = frac(e.clientX)
    const a = snapToHour(ws, we, f, tz, 'floor')
    setDrag({ x0: e.clientX, a, b: a + HOUR, moved: false })
    ref.current!.setPointerCapture?.(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const moved = drag.moved || Math.abs(e.clientX - drag.x0) > 4
    const f0 = (drag.x0 - ref.current!.getBoundingClientRect().left) / ref.current!.getBoundingClientRect().width
    const f = frac(e.clientX)
    const a = snapToHour(ws, we, Math.min(f0, f), tz, 'floor')
    const b = Math.max(a + HOUR, snapToHour(ws, we, Math.max(f0, f), tz, 'ceil'))
    setDrag({ ...drag, a, b, moved })
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag || !layer) return
    setDrag(null)
    ref.current!.releasePointerCapture?.(e.pointerId)
    if (drag.moved) onCreate(layer, drag.a, drag.b)
    else { const [a, b] = clickInterval(ws + frac(drag.x0) * span); onCreate(layer, a, b) }
  }

  return (
    <div ref={ref} data-row={layer?.id ?? 'shifts'} className={`relative h-12 ${editable ? 'cursor-crosshair touch-none select-none' : ''}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      {gaps.map((g) => {
        const w = pct(g.end) - pct(g.start)
        const future = g.end > now
        return (
          <button key={g.start} type="button" tabIndex={editable && future ? 0 : -1} data-testid="manual-gap" disabled={!editable || !future}
            aria-label={`Пусто: ${fmtDT(g.start, tz)} — ${fmtDT(g.end, tz)}${editable && future ? '. Добавить дежурство' : ''}`}
            onClick={(e) => { if (e.detail === 0 && layer) { const [a, b] = clickInterval(Math.max(g.start, floorNow)); onCreate(layer, a, b) } }}
            className="slot-gap absolute top-1 bottom-1 flex items-center justify-center overflow-hidden rounded-md text-[11px] whitespace-nowrap text-danger/80 disabled:cursor-default"
            style={{ left: `${pct(g.start)}%`, width: `calc(${w}% - 2px)` }}>
            {w > 7 ? (editable && future ? '+ Пусто' : 'Пусто') : ''}
          </button>
        )
      })}
      {row.map((card) => {
        const p = byId(card.personId)
        const left = pct(card.start)
        const w = pct(card.end) - left
        const col = personColor(card.personId)
        const removed = card.state === 'removed', subst = card.state === 'subst'
        const instead = card.replaced ? byId(card.replaced)?.name : undefined
        const time = cardTime(card, tz)
        const shown = w < 9.5 ? cardTime(card, tz, true) : time
        const name = p ? surnameInitial(p.name) : ''
        return (
          <div key={card.key} data-card data-bar role="button" tabIndex={0}
            data-person={card.personId} data-slot={card.slotId} data-removed={removed ? 'true' : undefined} data-subst={subst ? card.replaced ?? 'true' : undefined}
            aria-label={`${p?.name ?? ''}${removed ? ' (снят)' : ''}${instead ? `, подмена вместо ${instead}` : ''}, ${time}`}
            onClick={(e) => openCard(e.currentTarget, card, layer)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(e.currentTarget, card, layer) } }}
            className={`absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-md border text-[11px] leading-tight focus-visible:ring-2 focus-visible:ring-ink ${removed ? 'border-dashed border-line-strong bg-surface-2 text-muted' : 'border-line bg-surface text-ink shadow-[0_1px_0_rgba(0,0,0,.03)]'}`}
            style={{ left: `${left}%`, width: `calc(${w}% - 3px)`, borderLeft: `3px solid ${removed ? 'var(--c-line-strong)' : col}`, ...(subst ? { outline: `1.5px dashed ${col}`, outlineOffset: '-1.5px', background: `color-mix(in srgb, ${col} 10%, var(--c-surface))` } : {}) }}>
            {/* неактивные часы внутри смены */}
            {card.active.slice(1).map((x, i) => {
              const prev = card.active[i]
              const l = ((prev.end - card.start) / (card.end - card.start)) * 100
              const ww = ((x.start - prev.end) / (card.end - card.start)) * 100
              return <span key={i} aria-hidden className="hatch-off absolute top-0 bottom-0" style={{ left: `${l}%`, width: `${ww}%` }} />
            })}
            <span className="relative block truncate px-1.5 pt-1.5 font-medium">
              {removed ? <s>{name}</s> : name}{removed && <span className="ml-1 font-normal">· снят</span>}{subst && w > 8 && <span className="ml-1 font-normal text-muted">· вместо {instead ? surnameInitial(instead) : '—'}</span>}
            </span>
            <span className="relative block truncate px-1.5 text-muted" title={time}>{shown}</span>
          </div>
        )
      })}
      {drag?.moved && (
        <div aria-hidden data-testid="drag-preview" className="drag-preview pointer-events-none absolute top-1 bottom-1 flex items-center justify-center rounded-md text-[11px] font-medium text-accent"
          style={{ left: `${pct(drag.a)}%`, width: `${pct(drag.b) - pct(drag.a)}%` }}>
          {fmtTz(drag.a, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} – {fmtTz(drag.b, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
        </div>
      )}
    </div>
  )
}
