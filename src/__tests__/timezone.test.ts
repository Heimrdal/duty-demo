/**
 * Регрессия F-01: одно и то же сохранённое состояние и один и тот же момент времени
 * дают одинаковых дежурных при любом часовом поясе браузера (TZ процесса).
 * `npm run test:tz` дополнительно гоняет весь набор под TZ=UTC, Europe/Moscow, Europe/Berlin, Asia/Vladivostok.
 */
import { afterAll, describe, expect, test } from 'vitest'
import { makeCalendars } from '../data'
import { calendarOnCall, layerOnCall, nextHandoff, startOfDay, weekday } from '../engine'
import { fromInputTz, toInputTz, tzLabel } from '../tz'
import type { Calendar, Layer } from '../types'

const ZONES = ['UTC', 'Europe/Moscow', 'Europe/Berlin', 'Asia/Vladivostok']
const SEED = Date.UTC(2026, 9, 28, 9, 0) // 28.10.2026 12:00 МСК — момент, когда «сохранили» состояние
const STORED = JSON.stringify(makeCalendars(SEED)) // как в localStorage
const ORIGINAL_TZ = process.env.TZ

function withTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  return fn()
}
afterAll(() => { process.env.TZ = ORIGINAL_TZ })

const onCall = (cals: Calendar[], iso: string) =>
  Object.fromEntries(cals.map((c) => [c.id, calendarOnCall(c, Date.parse(iso)).map((e) => `${e.personId}@${e.layerId ?? 'shift'}`)]))

/** Моменты: случай из аудита, передача 09:00 МСК, полночь МСК (пятница → суббота), передача 10:00 МСК. */
const EXPECTED: Record<string, Record<string, string[]>> = {
  '2026-10-30T05:59:59Z': { // пт 08:59:59 МСК
    'cal-sc': ['u-sc1@l-sc-main'],
    'cal-mon': ['u-mon2@l-mon-night'],
    'cal-ib': ['u-ib1@l-ib-dev', 'u-ib2@l-ib-dev', 'u-ib3@l-ib-dev', 'u-ib-lead@l-ib-sre', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay1@shift'],
    'cal-l2': ['u-sc2@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
  '2026-10-30T06:00:00Z': { // пт 09:00 МСК — передача СЦ и мониторинга
    'cal-sc': ['u-sc2@l-sc-main', 'u-sc3@l-sc-shadow'],
    'cal-mon': ['u-mon1@l-mon-day'],
    'cal-ib': ['u-ib1@l-ib-dev', 'u-ib2@l-ib-dev', 'u-ib3@l-ib-dev', 'u-ib-lead@l-ib-sre', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay1@shift'],
    'cal-l2': ['u-sc2@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
  '2026-10-30T07:30:00Z': { // пт 10:30 МСК — случай из аудита F-01
    'cal-sc': ['u-sc2@l-sc-main', 'u-sc3@l-sc-shadow'],
    'cal-mon': ['u-mon1@l-mon-day'],
    'cal-ib': ['u-ib-lead@l-ib-dev', 'u-pay1@l-ib-dev', 'u-sbp1@l-ib-dev', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay1@shift'],
    'cal-l2': ['u-sc2@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
  '2026-10-30T20:59:59Z': { // пт 23:59:59 МСК
    'cal-sc': ['u-sc2@l-sc-main'],
    'cal-mon': ['u-mon2@l-mon-night'],
    'cal-ib': ['u-ib-lead@l-ib-dev', 'u-pay1@l-ib-dev', 'u-sbp1@l-ib-dev', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay1@shift'],
    'cal-l2': ['u-mon1@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
  '2026-10-30T21:00:00Z': { // сб 00:00 МСК — начинается слой выходных СБП, разовая смена заканчивается
    'cal-sc': ['u-sc2@l-sc-main'],
    'cal-mon': ['u-mon2@l-mon-night'],
    'cal-ib': ['u-ib-lead@l-ib-dev', 'u-pay1@l-ib-dev', 'u-sbp1@l-ib-dev', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay2@l-sbp-weekend'],
    'cal-l2': ['u-mon1@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
  '2026-10-31T07:00:00Z': { // сб 10:00 МСК
    'cal-sc': ['u-sc3@l-sc-main'],
    'cal-mon': ['u-mon2@l-mon-day'],
    'cal-ib': ['u-ib1@l-ib-dev', 'u-ib2@l-ib-dev', 'u-ib3@l-ib-dev', 'u-ib-lead@l-ib-sre', 'u-mon2@l-ib-sre'],
    'cal-pay': ['u-pay1@l-pay-main'],
    'cal-sbp': ['u-sbp1@l-sbp-week', 'u-pay2@l-sbp-weekend'],
    'cal-l2': ['u-sc1@l-l2-manual'], // ручной график: день 08–20, ночь 20–08
  },
}

describe('дежурные не зависят от часового пояса браузера', () => {
  test('смена TZ процесса действительно меняет локальное время (иначе тест бессмысленен)', () => {
    const t = Date.parse('2026-10-30T07:30:00Z')
    const hours = ZONES.map((z) => withTz(z, () => new Date(t).getHours()))
    expect(hours).toEqual([7, 10, 8, 17])
  })

  for (const iso of Object.keys(EXPECTED)) {
    test(`${iso}: одинаковый результат во всех поясах`, () => {
      for (const z of ZONES) {
        const cals = withTz(z, () => JSON.parse(STORED) as Calendar[])
        expect(withTz(z, () => onCall(cals, iso)), `TZ=${z}`).toEqual(EXPECTED[iso])
      }
    })
  }

  test('состояние, созданное в любом поясе, одинаково', () => {
    const made = ZONES.map((z) => withTz(z, () => JSON.stringify(makeCalendars(SEED).map((c) => ({ ...c, escalation: [], shifts: c.shifts.map((s) => ({ ...s, id: '' })) })))))
    for (const m of made) expect(m).toBe(made[1])
  })

  test('следующая передача смены — 09:00 в зоне календаря', () => {
    const cals = JSON.parse(STORED) as Calendar[]
    const sc = cals.find((c) => c.id === 'cal-sc')!
    for (const z of ZONES) {
      const h = withTz(z, () => nextHandoff(sc.layers[0], Date.parse('2026-10-30T07:30:00Z'), sc.timezone))
      expect(new Date(h).toISOString(), `TZ=${z}`).toBe('2026-10-31T06:00:00.000Z')
    }
  })

  test('начало суток и день недели — в зоне календаря', () => {
    const t = Date.parse('2026-10-30T21:30:00Z') // сб 00:30 МСК, но ещё пт в UTC и Берлине
    for (const z of ZONES) withTz(z, () => {
      expect(new Date(startOfDay(t, 'Europe/Moscow')).toISOString()).toBe('2026-10-30T21:00:00.000Z')
      expect(weekday(t, 'Europe/Moscow')).toBe(5)
      expect(weekday(t, 'Europe/Berlin')).toBe(4)
      expect(weekday(t, 'Asia/Vladivostok')).toBe(5)
    })
  })
})

describe('календарь в другом поясе и переход на зимнее время', () => {
  const layer: Layer = {
    id: 'l', name: 'Берлин', kind: 'primary', startsAt: '2026-10-19', handoffTime: '09:00', rotation: { unit: 'day', count: 1 },
    participants: ['a', 'b'], parallel: 1, restriction: { type: 'none', from: '00:00', to: '00:00', days: [] },
  }
  const TZB = 'Europe/Berlin' // 25.10.2026 03:00 CEST → 02:00 CET

  test('передача в 09:00 по Берлину и до, и после перевода часов', () => {
    for (const z of ZONES) withTz(z, () => {
      // 24.10 (CEST, UTC+2): 09:00 = 07:00Z
      expect(layerOnCall(layer, Date.parse('2026-10-24T06:59:59Z'), TZB)).toEqual(['a'])
      expect(layerOnCall(layer, Date.parse('2026-10-24T07:00:00Z'), TZB)).toEqual(['b'])
      // 26.10 (CET, UTC+1): 09:00 = 08:00Z
      expect(layerOnCall(layer, Date.parse('2026-10-26T07:59:59Z'), TZB)).toEqual(['a'])
      expect(layerOnCall(layer, Date.parse('2026-10-26T08:00:00Z'), TZB)).toEqual(['b'])
      expect(new Date(nextHandoff(layer, Date.parse('2026-10-24T22:00:00Z'), TZB)).toISOString()).toBe('2026-10-25T08:00:00.000Z')
    })
  })

  test('ограничение по часам и дням считается в зоне календаря (Владивосток)', () => {
    const l: Layer = { ...layer, restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } }
    for (const z of ZONES) withTz(z, () => {
      expect(layerOnCall(l, Date.parse('2026-10-29T23:00:00Z'), 'Asia/Vladivostok')).toHaveLength(1) // пт 09:00
      expect(layerOnCall(l, Date.parse('2026-10-29T22:59:59Z'), 'Asia/Vladivostok')).toHaveLength(0) // пт 08:59
      expect(layerOnCall(l, Date.parse('2026-10-30T08:00:00Z'), 'Asia/Vladivostok')).toHaveLength(0) // пт 18:00
      expect(layerOnCall(l, Date.parse('2026-10-30T23:00:00Z'), 'Asia/Vladivostok')).toHaveLength(0) // сб 09:00
    })
  })
})

describe('datetime-local вводится и выводится в зоне календаря', () => {
  const t = Date.parse('2026-10-30T07:30:00Z')
  test.each([
    ['Europe/Moscow', '2026-10-30T10:30'],
    ['Europe/Berlin', '2026-10-30T08:30'],
    ['Asia/Vladivostok', '2026-10-30T17:30'],
    ['UTC', '2026-10-30T07:30'],
  ])('%s', (zone, local) => {
    for (const z of ZONES) withTz(z, () => {
      expect(toInputTz(t, zone)).toBe(local)
      expect(fromInputTz(local, zone)).toBe(t)
    })
  })
  test('пустое значение — NaN, несуществующее время (весенний перевод) не ломается', () => {
    expect(fromInputTz('', 'Europe/Moscow')).toBeNaN()
    expect(Number.isFinite(fromInputTz('2026-03-29T02:30', 'Europe/Berlin'))).toBe(true)
  })
  test('подпись пояса: МСК только для Москвы', () => {
    expect(tzLabel('Europe/Moscow')).toBe('МСК')
    expect(tzLabel('UTC')).toBe('UTC')
    expect(tzLabel('Europe/Berlin')).not.toContain('МСК')
    expect(tzLabel('Asia/Vladivostok')).toMatch(/UTC\+10/)
  })
})
