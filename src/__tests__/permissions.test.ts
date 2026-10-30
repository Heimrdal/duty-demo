import { describe, expect, test } from 'vitest'
import { makeCalendars, PEOPLE } from '../data'
import { calendarOnCall } from '../engine'
import { canCancelShift, canEditSchedule, makeShift, managerChain, scheduleEditors, teamFirstIds, upsertShift } from '../perm'

const SEED = Date.UTC(2026, 9, 28, 9, 0)
const T = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК
const HOUR = 3600_000
const cals = makeCalendars(SEED)
const cal = (id: string) => cals.find((c) => c.id === id)!

describe('права на расписание', () => {
  test('цепочка руководителей', () => {
    expect(managerChain(PEOPLE, 'u-sc3')).toEqual(['u-sc-mgr', 'u-head'])
    expect(managerChain(PEOPLE, 'u-head')).toEqual([])
  })

  test('СЦ: лид Елена Орлова, владелец Андрей Волков и директор могут менять расписание', () => {
    const sc = cal('cal-sc')
    expect(scheduleEditors(sc, PEOPLE).sort()).toEqual(['u-head', 'u-sc-mgr', 'u-sc3'].sort())
    for (const id of ['u-sc3', 'u-sc-mgr', 'u-head']) expect(canEditSchedule(sc, PEOPLE, id)).toBe(true)
  })

  test('рядовые инженеры и лиды других команд — только просмотр', () => {
    const sc = cal('cal-sc')
    for (const id of ['u-sc1', 'u-sc2', 'u-mon-lead', 'u-ib-lead']) expect(canEditSchedule(sc, PEOPLE, id)).toBe(false)
    expect(canEditSchedule(sc, PEOPLE, null)).toBe(false)
  })

  test('лид продуктовой команды и его руководитель редактируют свой календарь, но не чужой', () => {
    expect(canEditSchedule(cal('cal-ib'), PEOPLE, 'u-ib-lead')).toBe(true)
    expect(canEditSchedule(cal('cal-ib'), PEOPLE, 'u-dev-mgr')).toBe(true)
    expect(canEditSchedule(cal('cal-pay'), PEOPLE, 'u-ib-lead')).toBe(false)
  })

  test('свою смену отменяет сам, чужую — только редактор', () => {
    const s = makeShift({ personId: 'u-sc1', start: T, end: T + HOUR })
    const sc = cal('cal-sc')
    expect(canCancelShift(sc, PEOPLE, 'u-sc1', s)).toBe(true)
    expect(canCancelShift(sc, PEOPLE, 'u-sc2', s)).toBe(false)
    expect(canCancelShift(sc, PEOPLE, 'u-sc3', s)).toBe(true)
  })

  test('в выборе дежурного сначала команда календаря', () => {
    const ids = teamFirstIds(cal('cal-sc'), PEOPLE)
    expect(ids).toEqual(expect.arrayContaining(['u-sc1', 'u-sc2', 'u-sc3', 'u-sc-mgr']))
    expect(ids).not.toContain('u-ib1')
  })
})

describe('назначение лидом', () => {
  test('замена текущего дежурного другим человеком', () => {
    const sc = cal('cal-sc')
    const onCall = calendarOnCall(sc, T).find((e) => e.layerId === 'l-sc-main')!.personId
    const s = makeShift({ personId: 'u-mon1', start: T - HOUR, end: T + 2 * HOUR, replacesPersonId: onCall, note: 'больничный' })
    const next = upsertShift(sc, s)
    const now = calendarOnCall(next, T)
    expect(now.map((e) => e.personId)).toContain('u-mon1')
    expect(now.map((e) => e.personId)).not.toContain(onCall)
    expect(now.find((e) => e.personId === 'u-mon1')).toMatchObject({ kind: 'override', replaced: onCall, layerId: 'l-sc-main' })
    // после окончания замены возвращается ротация
    expect(calendarOnCall(next, T + 3 * HOUR).map((e) => e.personId)).toContain(onCall)
  })

  test('разовое назначение добавляется параллельно ротации', () => {
    const sc = cal('cal-sc')
    const next = upsertShift(sc, makeShift({ personId: 'u-mon2', start: T, end: T + HOUR }))
    const e = calendarOnCall(next, T + 1)
    expect(e.find((x) => x.personId === 'u-mon2')?.kind).toBe('oneoff')
    expect(e.length).toBe(calendarOnCall(sc, T + 1).length + 1)
  })

  test('правка смены заменяет её по id, а не дублирует', () => {
    const sc = cal('cal-sc')
    const s = makeShift({ personId: 'u-mon2', start: T, end: T + HOUR })
    const once = upsertShift(sc, s)
    const twice = upsertShift(once, { ...s, personId: 'u-mon1' })
    expect(twice.shifts.length).toBe(once.shifts.length)
    expect(twice.shifts.find((x) => x.id === s.id)?.personId).toBe('u-mon1')
  })

  test('некорректные интервалы и подмена самого себя отклоняются', () => {
    expect(() => makeShift({ personId: 'u-sc1', start: T, end: T })).toThrow()
    expect(() => makeShift({ personId: 'u-sc1', start: T, end: T + HOUR, replacesPersonId: 'u-sc1' })).toThrow()
  })
})
