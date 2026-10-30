import { describe, expect, test } from 'vitest'
import { makeCalendars, migrateState, PEOPLE, STATE_VERSION } from '../data'
import { addGap, calendarOnCall, HOUR, layerOnCall, makeRemoval, personDutySpans, shiftGap } from '../engine'
import { resolveChain } from '../escalation'
import { makeShift } from '../perm'
import type { Calendar, Layer, Shift } from '../types'

const SEED = Date.UTC(2026, 9, 28, 9, 0)
const T = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК
const cals = makeCalendars(SEED)
const ids = (c: Calendar, t = T) => calendarOnCall(c, t).map((e) => e.personId)
const withShifts = (c: Calendar, add: Shift[]): Calendar => ({ ...c, shifts: [...c.shifts, ...add] })
const replaceCal = (list: Calendar[], c: Calendar) => list.map((x) => (x.id === c.id ? c : x))

const layer = (id: string, people: string[]): Layer => ({
  id, name: id, kind: 'primary', participants: people, startsAt: '2026-10-01', handoffTime: '09:00',
  rotation: { unit: 'week', count: 1 }, parallel: 1, restriction: { type: 'none', from: '00:00', to: '00:00', days: [] },
} as unknown as Layer)
const toy = (mode: 'priority' | 'parallel'): Calendar => ({
  ...cals[0], id: 'toy', layerMode: mode, shifts: [],
  layers: [layer('L1', ['u-a']), layer('L2', ['u-b'])],
})

describe('снять с дежурства', () => {
  test('снятый человек исключён из расписания на интервале и возвращается после', () => {
    const c = cals.find((x) => ids(x).length === 1)!
    const [pid] = ids(c)
    const r = makeRemoval({ personId: pid, start: T - HOUR, end: T + HOUR }, T)
    expect(r.personId).toBe('')
    const c2 = withShifts(c, [r])
    expect(ids(c2)).not.toContain(pid)
    expect(ids(c2, T + 2 * HOUR)).toEqual(ids(c, T + 2 * HOUR))
  })

  test('приоритет: опустевший слой уступает следующему; снятие в одном слое не трогает другой', () => {
    const c = toy('priority')
    expect(ids(c)).toEqual(['u-a'])
    expect(ids(withShifts(c, [makeRemoval({ personId: 'u-a', layerId: 'L1', start: T - HOUR, end: T + HOUR })]))).toEqual(['u-b'])
    const p = toy('parallel')
    expect(ids(p).sort()).toEqual(['u-a', 'u-b'])
    expect(ids(withShifts(p, [makeRemoval({ personId: 'u-a', layerId: 'L2', start: T - HOUR, end: T + HOUR })])).sort()).toEqual(['u-a', 'u-b'])
    expect(ids(withShifts(p, [makeRemoval({ personId: 'u-a', layerId: 'L1', start: T - HOUR, end: T + HOUR })]))).toEqual(['u-b'])
  })

  test('без замены — дыра обнаруживается, но снятие допустимо (слот остаётся пустым)', () => {
    const c: Calendar = { ...toy('parallel'), layers: [layer('L1', ['u-a'])] }
    const r = makeRemoval({ personId: 'u-a', layerId: 'L1', start: T, end: T + 3 * HOUR })
    const gap = addGap(c, [r], T)
    expect(gap).not.toBeNull()
    expect(gap!.start).toBe(T)
    expect(gap!.end).toBe(T + 3 * HOUR)
    const empty = withShifts(c, [r])
    expect(ids(empty, T + HOUR)).toEqual([])
    // заполнить можно позже — разовой сменой в этот интервал
    const fill = makeShift({ personId: 'u-b', start: T, end: T + 3 * HOUR })
    expect(ids(withShifts(empty, [fill]), T + HOUR)).toEqual(['u-b'])
    expect(addGap(c, [r, fill], T)).toBeNull()
  })

  test('без дыры, если остаётся другой дежурный', () => {
    const r = makeRemoval({ personId: 'u-a', layerId: 'L1', start: T, end: T + 3 * HOUR })
    expect(addGap(toy('parallel'), [r], T)).toBeNull()
  })

  test('эскалация: уровень 1 не зовёт снятого', () => {
    const c = cals.find((x) => ids(x).length >= 1)!
    const [pid] = ids(c)
    const c2 = withShifts(c, [makeRemoval({ personId: pid, start: T - HOUR, end: T + HOUR })])
    const chain = resolveChain(c2, PEOPLE, T, replaceCal(cals, c2))
    expect(chain[0].people.map((p) => p.id)).not.toContain(pid)
    // СЦ: снятый сменный инженер не попадает и в уровень «Дежурный другого календаря» (СЦ)
    const sc = cals.find((x) => x.id === 'cal-sc')!
    const sc2 = withShifts(sc, [makeRemoval({ personId: 'u-sc2', start: T - HOUR, end: T + HOUR })])
    const ib = resolveChain(cals.find((x) => x.id === 'cal-ib')!, PEOPLE, T, replaceCal(cals, sc2))
    expect(ib.find((l) => l.target === 'calendar')!.people.map((p) => p.id)).not.toContain('u-sc2')
  })

  test('отмена снятия («Вернуть») возвращает человека, и это не создаёт дыру', () => {
    const c = cals.find((x) => ids(x).length === 1)!
    const [pid] = ids(c)
    const r = makeRemoval({ personId: pid, start: T - HOUR, end: T + HOUR })
    const c2 = withShifts(c, [r])
    expect(ids(c2)).not.toContain(pid)
    expect(shiftGap(c2, r, T)).toBeNull()
    const back = { ...c2, shifts: c2.shifts.filter((x) => x.id !== r.id) }
    expect(ids(back)).toEqual(ids(c))
  })

  test('смены человека (личная страница) не включают время снятия', () => {
    const c = toy('parallel')
    const before = personDutySpans([c], 'u-a', T, T + 6 * HOUR)
    expect(before.reduce((s, x) => s + x.end - x.start, 0)).toBe(6 * HOUR)
    const c2 = withShifts(c, [makeRemoval({ personId: 'u-a', start: T + HOUR, end: T + 3 * HOUR })])
    const after = personDutySpans([c2], 'u-a', T, T + 6 * HOUR)
    expect(after.reduce((s, x) => s + x.end - x.start, 0)).toBe(4 * HOUR)
    expect(layerOnCall(c2.layers[0], T + 2 * HOUR, c2.timezone)).toContain('u-a') // ротация не меняется
  })

  test('миграция: снятия сохраняются, битые смены отбрасываются', () => {
    const c = cals[0]
    const r = makeRemoval({ personId: 'u-mon1', start: T, end: T + HOUR })
    const raw = {
      version: STATE_VERSION, people: PEOPLE, currentUserId: 'u-mon1', telegram: [],
      calendars: [{ ...c, shifts: [{ ...r, personId: 'u-x' }, { id: 'bad', start: 'x' }, { id: 'nobody', personId: '', start: r.start, end: r.end }] }],
    }
    const m = migrateState(JSON.parse(JSON.stringify(raw)))!
    expect(m.calendars[0].shifts.map((s) => s.id)).toEqual([r.id])
    expect(m.calendars[0].shifts[0].personId).toBe('')
    expect(m.calendars[0].shifts[0].removesPersonId).toBe('u-mon1')
  })
})
