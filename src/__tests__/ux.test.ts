/** Замечания АЙС-теста: запуск календаря, пересечения, дата старта, подписи карточек, права на экране команды. */
import { describe, expect, test } from 'vitest'
import { hasWeekGap, onCallIndex } from '../cache'
import { initialState } from '../data'
import { calendarLaunch, defaultStartDate, HOUR, isGapAt, layerConflicts, launchNote, readySig, teamCoverage } from '../engine'
import { teamEditors } from '../perm'
import { readiness, readyChecked } from '../readiness'
import { atDay, dayNumberOfIso } from '../tz'
import type { Calendar, Layer } from '../types'
import { cardTime, weekBoard } from '../week'
import { dutyParticipants } from '../pages/TeamView'

const MSK = 'Europe/Moscow'
const NOW = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК
const at = (iso: string, h: number, tz = MSK) => atDay(dayNumberOfIso(iso), h * 60, tz)
const s = initialState(NOW, 'small')
const weekly = (participants: string[], startsAt: string, handoffTime = '10:00'): Layer => ({
  id: 'L-new', name: 'Неделя разработки', kind: 'primary', startsAt, handoffTime, rotation: { unit: 'week', count: 1 }, participants, parallel: 1,
  restriction: { type: 'none', from: '09:00', to: '18:00', days: [] },
})
const cal = (layers: Layer[], extra: Partial<Calendar> = {}): Calendar => ({
  id: 'cal-new', name: 'Интернет-банк — релизы', product: '', description: '', team: 'Интернет-банк', ownerId: 'u-ib-lead', leadId: 'u-ib-lead',
  timezone: MSK, layerMode: 'parallel', repeat: 1, layers, shifts: [], escalation: s.calendars.find((c) => c.id === 'cal-ib')!.escalation, ...extra,
})

describe('дата старта по умолчанию', () => {
  test('сегодня, если передача ещё впереди, иначе завтра', () => {
    expect(defaultStartDate('12:00', NOW, MSK)).toBe('2026-10-30')
    expect(defaultStartDate('10:00', NOW, MSK)).toBe('2026-10-31')
    // в Берлине сейчас 08:30 — передача в 09:00 ещё впереди
    expect(defaultStartDate('09:00', NOW, 'Europe/Berlin')).toBe('2026-10-30')
    expect(defaultStartDate('08:00', NOW, 'Europe/Berlin')).toBe('2026-10-31')
  })
})

describe('«ещё не запущено» — не дыра', () => {
  const c = cal([weekly(['u-ib1', 'u-ib2', 'u-ib3'], '2026-11-02')])
  test('до первого старта нет дыр ни в неделе, ни в команде, ни в счётчиках', () => {
    expect(calendarLaunch(c)).toBe(at('2026-11-02', 10))
    expect(isGapAt(c, NOW)).toBe(false)
    expect(isGapAt(c, at('2026-11-02', 11))).toBe(false)
    const wb = weekBoard(c, at('2026-10-26', 0))
    expect(wb.gaps).toEqual([])
    expect(wb.prelaunch).toEqual({ start: at('2026-10-26', 0), end: at('2026-11-02', 0) })
    const cover = teamCoverage([c], at('2026-10-30', 0), at('2026-11-05', 0))
    expect(cover.some((x) => x.gap)).toBe(false)
    expect(cover[0].pendingNames).toBe('Интернет-банк — релизы')
    expect(cover[cover.length - 1].pendingNames).toBe('')
    expect(hasWeekGap(c, NOW)).toBe(false)
    expect(onCallIndex([c], NOW).gapsNow).toEqual([])
    expect(onCallIndex([c], NOW).pendingNow).toHaveLength(1)
    expect(launchNote(c, NOW)).toMatch(/^ещё не запущено · старт /)
  })
  test('календарь без графика — не запущен; после старта пустые часы — снова дыры', () => {
    const empty = cal([])
    expect(calendarLaunch(empty)).toBe(Infinity)
    expect(isGapAt(empty, NOW)).toBe(false)
    expect(launchNote(empty, NOW)).toBe('ещё не запущено · графика нет')
    const office = cal([{ ...weekly(['u-ib1'], '2026-10-26', '09:00'), restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } }])
    expect(isGapAt(office, at('2026-10-30', 20))).toBe(true)
    expect(hasWeekGap(office, NOW)).toBe(true)
  })
})

describe('подпись карточки недели — по всей смене', () => {
  test('смена пн 10:00 → пн 10:00: не «вс 00:00 (158ч)», а даты и 168ч', () => {
    const c = cal([weekly(['u-ib1', 'u-ib2'], '2026-10-19')])
    const wb = weekBoard(c, at('2026-10-26', 0))
    const cards = wb.groups[0].rows.flat().sort((a, b) => a.start - b.start)
    const mon = cards.find((x) => x.start === at('2026-10-26', 10))!
    expect(mon.full).toEqual({ start: at('2026-10-26', 10), end: at('2026-11-02', 10), hours: 168 })
    expect(mon.cut).toBe(true)
    expect(cardTime(mon, MSK)).toBe('26 окт 10:00 – 2 нояб 10:00 (168ч)')
    // хвост прошлой смены: 19 окт 10:00 – 26 окт 10:00, в неделе видно только 10 часов
    const tail = cards.find((x) => x.start === at('2026-10-26', 0))!
    expect(cardTime(tail, MSK)).toBe('19 окт 10:00 – 26 окт 10:00 (168ч)')
  })
  test('смена внутри недели — дни недели и длительность совпадают', () => {
    const c = cal([{ ...weekly(['u-ib1', 'u-ib2'], '2026-10-26'), rotation: { unit: 'day', count: 3 } }])
    const cards = weekBoard(c, at('2026-10-26', 0)).groups[0].rows.flat().sort((a, b) => a.start - b.start)
    const inside = cards.find((x) => x.start === at('2026-10-26', 10))!
    expect(inside.cut).toBe(false)
    expect(cardTime(inside, MSK)).toBe('пн 10:00 – чт 10:00 (72ч)')
  })
})

describe('пересечения между календарями', () => {
  test('новая ротация тех же людей пересекается с «Интернет-банком»', () => {
    const draft = weekly(['u-ib1', 'u-ib2', 'u-ib3'], '2026-10-31')
    const c = cal([])
    const from = at('2026-10-31', 10)
    const list = layerConflicts(draft, c, s.calendars, from, from + 28 * 24 * HOUR)
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((x) => x.start >= from && x.end > x.start)).toBe(true)
    expect(list.some((x) => x.calendarName === 'Интернет-банк')).toBe(true)
    expect(new Set(list.map((x) => x.personId))).toEqual(new Set(['u-ib1', 'u-ib2', 'u-ib3']))
  })
  test('люди без других дежурств — без пересечений', () => {
    const draft = weekly(['u-head'], '2026-10-31')
    expect(layerConflicts(draft, cal([]), s.calendars, NOW, NOW + 7 * 24 * HOUR)).toEqual([])
  })
})

describe('проверка перед запуском', () => {
  const c = cal([weekly(['u-ib1', 'u-ib2', 'u-ib3'], '2026-10-31')])
  const all = [...s.calendars, c]
  const r = readiness(c, s.people, all, s.notify, NOW, String)
  test('старт, участники, дыры, пересечения, эскалация', () => {
    expect(r.launch).toBe(at('2026-10-31', 10))
    expect(r.from).toBe(at('2026-10-31', 10))
    expect(r.participants[0].ids).toEqual(['u-ib1', 'u-ib2', 'u-ib3'])
    expect(r.holes).toEqual([])
    expect(r.conflicts.length).toBeGreaterThan(0)
    expect(r.chain.length).toBeGreaterThan(0)
    expect(r.chain[0].people.length).toBeGreaterThan(0)
    expect(r.channels.every((x) => x.linked)).toBe(true)
    expect(r.issues.some((x) => x.startsWith('Пересечения с другими дежурствами'))).toBe(true)
    expect(r.issues.some((x) => x.startsWith('Дыры'))).toBe(false)
  })
  test('дыры и неподключённый Telegram попадают в открытые вопросы', () => {
    const office = cal([{ ...weekly(['u-sbp2'], '2026-10-31', '09:00'), restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } }])
    const x = readiness(office, s.people, [...s.calendars, office], s.notify, NOW, String)
    expect(x.holes.length).toBeGreaterThan(0)
    expect(x.issues.some((i) => i.startsWith('Дыры в покрытии'))).toBe(true)
    expect(x.issues.some((i) => i.startsWith('Telegram не подключён'))).toBe(true)
  })
  test('«готовность проверена» сбрасывается при изменении графика', () => {
    expect(readyChecked(c)).toBe(false)
    const ok = { ...c, readyCheck: { at: new Date(NOW).toISOString(), sig: readySig(c) } }
    expect(readyChecked(ok)).toBe(true)
    expect(readyChecked({ ...ok, layers: [{ ...ok.layers[0], participants: ['u-ib1'] }] })).toBe(false)
  })
})

describe('экран команды', () => {
  test('кто настраивает дежурства команды', () => {
    expect(teamEditors('Интернет-банк', s.calendars, s.people)).toContain('u-ib-lead')
    expect(teamEditors('Интернет-банк', s.calendars, s.people)).not.toContain('u-ib1')
    // команда без календаря: руководитель команды и его руководители
    const dbo = teamEditors('Разработка ДБО', s.calendars, s.people)
    expect(dbo).toContain('u-dev-mgr')
    expect(dbo).toContain('u-head')
  })
  test('участники дежурств считаются по графикам, а не по составу LDAP', () => {
    const ib = s.calendars.filter((c) => c.team === 'Интернет-банк')
    const n = dutyParticipants(ib)
    expect(n).toBe(new Set(ib.flatMap((c) => c.layers.flatMap((l) => l.participants))).size)
    expect(n).toBeGreaterThan(s.people.filter((p) => p.teams.includes('Интернет-банк')).length)
  })
})
