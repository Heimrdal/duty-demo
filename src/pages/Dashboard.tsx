import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hasWeekGap, involves, onCallAt, onCallIndex } from '../cache'
import { CalendarFilters, CalendarRow, OnCallCard, Pager } from '../CalendarList'
import { calendarOnCall, DAY, fmtDT, fmtDur, HOUR, sampleSegments } from '../engine'
import { useFavorites } from '../favorites'
import { calendarOrgUnit, EMPTY_FILTER, filterCalendars, type CalFilter } from '../search'
import { peopleById, useNow, useStore } from '../store'
import { DEFAULT_TZ, fmtTz, tzLabel } from '../tz'
import type { Calendar } from '../types'

/** До стольких календарей дашборд показывает все карточки сразу, как раньше. */
export const FEW_CALENDARS = 8
const PAGE = 20
const MY_LIMIT = 6

/** Имена, только если их мало; иначе — число. */
function namesOrCount(cals: Calendar[]) {
  return cals.length <= 3 ? cals.map((c) => c.name).join(', ') : `${cals.length} календарей`
}

export function Dashboard() {
  const { state } = useStore()
  const now = useNow()
  const me = peopleById(state.people).get(state.currentUserId!)!
  const { favorites, isFav, toggle } = useFavorites(me.id)
  const few = state.calendars.length <= FEW_CALENDARS
  const [f, setF] = useState<CalFilter>(EMPTY_FILTER)
  const [page, setPage] = useState(0)
  const [showAllMine, setShowAllMine] = useState(false)
  const listRef = useRef<HTMLElement>(null)

  const idx = onCallIndex(state.calendars, now)
  const hourKey = Math.floor(now / HOUR)
  // дыры за 7 дней: для маленького набора сразу, для большого — после первой отрисовки, чтобы не тормозить экран
  const [weekGaps, setWeekGaps] = useState<Calendar[] | null>(() => (few ? state.calendars.filter((c) => hasWeekGap(c, now)) : null))
  useEffect(() => {
    if (few) { setWeekGaps(state.calendars.filter((c) => hasWeekGap(c, now))); return }
    const t = setTimeout(() => setWeekGaps(state.calendars.filter((c) => hasWeekGap(c, now))), 30)
    return () => clearTimeout(t)
  }, [state.calendars, hourKey, few]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => state.calendars.filter((c) => involves(c, me.id)).flatMap((c) =>
    sampleSegments(Math.floor((now - DAY) / HOUR) * HOUR, now + 21 * DAY, (t) => (calendarOnCall(c, t).some((e) => e.personId === me.id) ? me.id : null), HOUR)
      .filter((s) => s.end > now).map((s) => ({ ...s, c }))).sort((a, b) => a.start - b.start).slice(0, 6), [state.calendars, me.id, Math.floor(now / 600000)]) // eslint-disable-line

  const orgOf = useMemo(() => {
    const byId = peopleById(state.people)
    const m = new Map(state.calendars.map((c) => [c.id, calendarOrgUnit(c, byId)]))
    return (c: Calendar) => m.get(c.id) ?? ''
  }, [state.calendars, state.people])
  const orgs = useMemo(() => [...new Set(state.calendars.map(orgOf))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru')), [state.calendars, orgOf])

  const favCals = state.calendars.filter((c) => favorites.includes(c.id))
  const myCals = useMemo(() => state.calendars.filter((c) => me.teams.includes(c.team) || c.leadId === me.id || c.ownerId === me.id), [state.calendars, me])
  const myRest = myCals.filter((c) => !favorites.includes(c.id))
  const filtered = useMemo(() => (few ? [] : filterCalendars(state.calendars, f, now, orgOf)), [few, state.calendars, f, Math.floor(now / 60000), orgOf]) // eslint-disable-line
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const curPage = Math.min(page, pageCount - 1)

  const setFilter = (next: CalFilter) => { setF(next); setPage(0) }
  const showGaps = (coverage: 'now' | 'week') => {
    setFilter({ ...EMPTY_FILTER, coverage })
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const gapsNow = idx.gapsNow
  const gapHint = gapsNow.length
    ? (gapsNow.length <= 3 ? `прямо сейчас: ${namesOrCount(gapsNow)}` : 'прямо сейчас')
    : weekGaps === null ? 'проверяем ближайшие 7 дней…'
    : weekGaps.length ? `сейчас все на смене · за 7 дней дыры: ${namesOrCount(weekGaps)}` : 'прямо сейчас и на 7 дней вперёд дыр нет'
  const gapAction = gapsNow.length ? { label: gapsNow.length <= 3 && few ? null : 'Показать', on: () => showGaps('now') }
    : weekGaps?.length ? { label: weekGaps.length <= 3 && few ? null : 'Показать', on: () => showGaps('week') } : null

  // маленький набор: все карточки, как раньше
  const smallRows = few ? state.calendars.filter((c) => (f.coverage === 'all' || (f.coverage === 'now' ? onCallAt(c, now).length === 0 : hasWeekGap(c, now)))) : []

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Кто дежурит сейчас</h1>
        <p className="mt-1 text-sm text-muted">{fmtTz(now, DEFAULT_TZ, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} {tzLabel(DEFAULT_TZ)}</p>
      </header>

      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat k="Календари" v={String(state.calendars.length)} />
        <Stat k="Сейчас на смене" v={String(idx.totalOnCall)} />
        <Stat k="Сейчас без покрытия" v={String(gapsNow.length)} danger={gapsNow.length > 0} wrap hint={gapHint}
          action={gapAction?.label ? <button type="button" data-testid="gaps-link" className="font-medium text-accent hover:underline" onClick={gapAction.on}>{gapAction.label}</button> : undefined} />
        <Stat k="Моя смена" v={mine[0] ? (mine[0].start <= now ? 'Сейчас' : `${fmtDT(mine[0].start, mine[0].c.timezone)} ${tzLabel(mine[0].c.timezone)}`) : 'Нет'} hint={mine[0]?.c.name} />
      </div>

      {few ? (
        <section ref={listRef} className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {([['all', 'Все'], ['now', 'Без дежурного сейчас'], ['week', 'С дырами за 7 дней']] as const).map(([k, label]) => (
              <button key={k} data-testid={`cov-${k}`} aria-pressed={f.coverage === k} onClick={() => setFilter({ ...f, coverage: k })} className={f.coverage === k ? 'font-medium text-ink' : 'text-muted hover:text-ink'}>
                {label}
              </button>
            ))}
            {f.coverage !== 'all' && <span data-testid="gaps-chip" className="sr-only">{f.coverage === 'now' ? 'Только без дежурного' : 'Только с дырами за 7 дней'}</span>}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {smallRows.map((c) => <OnCallCard key={c.id} c={c} now={now} fav={isFav(c.id)} onFav={() => toggle(c.id)} />)}
          </div>
        </section>
      ) : (
        <>
          {favCals.length > 0 && (
            <section aria-labelledby="fav-h">
              <h2 id="fav-h" className="mb-3 text-sm font-medium">Избранное <span className="font-normal text-faint">{favCals.length}</span></h2>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {favCals.map((c) => <OnCallCard key={c.id} c={c} now={now} fav onFav={() => toggle(c.id)} />)}
              </div>
            </section>
          )}
          <section aria-labelledby="mine-h">
            <h2 id="mine-h" className="mb-1 text-sm font-medium">Мои команды <span className="font-normal text-faint">{myRest.length}</span></h2>
            <p className="mb-3 text-xs text-muted">Где вы в составе, лид или владелец. Звёздочка добавляет календарь в избранное.</p>
            {myRest.length === 0 ? <p className="text-sm text-muted">{myCals.length ? 'Все ваши календари уже в избранном.' : 'Вы пока не состоите в дежурных командах. Найдите нужную через поиск (Ctrl+K) или в списке ниже.'}</p> : (
              <>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {(showAllMine ? myRest : myRest.slice(0, MY_LIMIT)).map((c) => <OnCallCard key={c.id} c={c} now={now} fav={false} onFav={() => toggle(c.id)} />)}
                </div>
                {myRest.length > MY_LIMIT && <button type="button" className="mt-3 text-sm text-accent hover:underline" onClick={() => setShowAllMine(!showAllMine)}>{showAllMine ? 'Свернуть' : `Показать все ${myRest.length}`}</button>}
              </>
            )}
          </section>
          <section ref={listRef} aria-labelledby="all-h" className="scroll-mt-6">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="all-h" className="text-sm font-medium">Все календари <span className="font-normal text-faint" data-testid="all-count">{filtered.length === state.calendars.length ? state.calendars.length : `${filtered.length} из ${state.calendars.length}`}</span></h2>
            </div>
            <CalendarFilters f={f} set={setFilter} orgs={orgs} />
            {filtered.length === 0 ? <p className="py-6 text-sm text-muted">Ничего не нашлось. Измените запрос или сбросьте фильтры.</p> : (
              <ul className="mt-3 divide-y divide-line border-y border-line" aria-label="Календари">
                {filtered.slice(curPage * PAGE, curPage * PAGE + PAGE).map((c) => <CalendarRow key={c.id} c={c} now={now} org={orgOf(c)} fav={isFav(c.id)} onFav={() => toggle(c.id)} />)}
              </ul>
            )}
            <Pager page={curPage} total={filtered.length} size={PAGE} set={setPage} />
          </section>
        </>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium">Мои дежурства</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">На ближайшие три недели пусто.</p>
        ) : (
          <div className="divide-y divide-line">
            {mine.map((s, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="w-44 font-medium">{s.c.name}</span>
                <span className="text-muted">{fmtDT(s.start, s.c.timezone)} — {fmtDT(s.end, s.c.timezone)} {tzLabel(s.c.timezone)}</span>
                <span className="text-faint">{fmtDur(s.end - s.start)}</span>
                {s.start <= now && <span className="text-ok">сейчас</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ k, v, hint, danger, wrap, action }: { k: string; v: string; hint?: string; danger?: boolean; wrap?: boolean; action?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{k}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${danger ? 'text-danger' : ''}`}>{v}</div>
      {(hint || action) && <div className={`mt-0.5 text-xs text-faint ${wrap ? 'leading-snug' : 'truncate'}`} data-testid={wrap ? 'gaps-hint' : undefined}>{hint}{hint && action ? ' · ' : ''}{action}</div>}
    </div>
  )
}
