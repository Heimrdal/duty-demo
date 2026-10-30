/** t51u/t52u: слой «Ручной график» и расписание по неделям. */
import { describe, expect, test } from 'vitest'
import { initialState, makeCalendars, migrateState, STATE_VERSION } from '../data'
import { calendarOnCall, HOUR, layerOnCall, makeSlot, manualGaps, nextHandoff, nextInRotation, overlapWarning, personDutySpans, repeatSlots, teamCoverage, withSlots } from '../engine'
import { resolveChain } from '../escalation'
import { layerLanes } from '../lanes'
import { onCallIndex } from '../cache'
import { buildIndex, search } from '../search'
import { slotErrors } from '../forms'
import { layerStepErrors } from '../validation'
import { atDay, dayNumberOfIso, fmtTz } from '../tz'
import { cardsOfLane, cardTime, isoWeek, monthWeeks, snapToHour, surnameInitial, weekBoard, weekStart, weekTitle } from '../week'
import type { Calendar, Layer, Shift } from '../types'

const MSK = 'Europe/Moscow'
const SEED = Date.UTC(2026, 9, 28, 9, 0) // ср 28.10.2026 12:00 МСК
const at = (iso: string, h: number, tz = MSK) => atDay(dayNumberOfIso(iso), h * 60, tz)
const base = (p: Partial<Layer> = {}): Layer => ({
  id: 'L', name: 'Ручной', kind: 'primary', startsAt: '2026-10-01', handoffTime: '08:00', rotation: { unit: 'day', count: 1 },
  participants: [], parallel: 1, restriction: { type: 'none', from: '00:00', to: '00:00', days: [] }, mode: 'manual', slots: [], ...p,
})
const S = (personId: string, day: string, h1: number, h2: number, id?: string) => makeSlot({ id, personId, start: at(day, h1), end: h2 > h1 ? at(day, h2) : at(day, h2) + 24 * HOUR })
const L1 = withSlots(base(), [S('a', '2026-10-26', 8, 20, 's1'), S('b', '2026-10-26', 20, 8, 's2'), S('c', '2026-10-28', 8, 20, 's3')])
const calOf = (l: Layer, shifts: Shift[] = []): Calendar => ({ id: 'cal-x', name: 'X', product: '', team: 'X', description: '', ownerId: 'lead', leadId: 'lead', timezone: MSK, layerMode: 'parallel', repeat: 1, layers: [l], shifts, escalation: [] } as Calendar)

describe('t51u. ручной график: движок', () => {
  test('кто дежурит — по записям графика, без ротации; участники = люди из графика', () => {
    expect(L1.participants).toEqual(['a', 'b', 'c'])
    expect(layerOnCall(L1, at('2026-10-26', 9), MSK)).toEqual(['a'])
    expect(layerOnCall(L1, at('2026-10-26', 23), MSK)).toEqual(['b'])
    expect(layerOnCall(L1, at('2026-10-27', 9), MSK)).toEqual([]) // не заполнено — пусто
  })
  test('следующий и ближайшая смена состава', () => {
    expect(nextInRotation(L1, at('2026-10-26', 9), MSK)).toEqual(['b'])
    expect(nextHandoff(L1, at('2026-10-26', 9), MSK)).toBe(at('2026-10-26', 20))
    expect(nextHandoff(L1, at('2026-10-27', 12), MSK)).toBe(at('2026-10-28', 8))
    expect(nextHandoff(L1, at('2026-10-29', 12), MSK)).toBe(Infinity)
  })
  test('дыры ручного слоя', () => {
    expect(manualGaps(L1, at('2026-10-26', 0), at('2026-10-29', 0))).toEqual([
      { start: at('2026-10-26', 0), end: at('2026-10-26', 8) },
      { start: at('2026-10-27', 8), end: at('2026-10-28', 8) },
      { start: at('2026-10-28', 20), end: at('2026-10-29', 0) },
    ])
  })
  test('пересечения: одно место — предупреждение; несколько — только сверх мест или тот же человек', () => {
    expect(overlapWarning(L1, 'd', at('2026-10-26', 18), at('2026-10-26', 22))).toMatch(/одно место/)
    expect(overlapWarning(L1, 'd', at('2026-10-27', 9), at('2026-10-27', 18))).toBeNull()
    const two = { ...L1, parallel: 2 }
    expect(overlapWarning(two, 'd', at('2026-10-26', 9), at('2026-10-26', 12))).toBeNull()
    expect(overlapWarning(two, 'a', at('2026-10-26', 9), at('2026-10-26', 12))).toMatch(/уже дежурит/)
    const full = withSlots(two, [...two.slots!, S('d', '2026-10-26', 9, 12)])
    expect(overlapWarning(full, 'e', at('2026-10-26', 10), at('2026-10-26', 11))).toMatch(/2 места, а здесь одновременно 3/)
    expect(overlapWarning(L1, 'a', at('2026-10-26', 9), at('2026-10-26', 12), 's1')).toBeNull() // редактирование той же записи
  })
  test('при нескольких местах дежурят все пересекающиеся', () => {
    const two = withSlots({ ...L1, parallel: 2 }, [...L1.slots!, S('d', '2026-10-26', 9, 12)])
    expect(layerOnCall(two, at('2026-10-26', 10), MSK)).toEqual(['a', 'd'])
  })
  test('«Скопировать неделю» и «Повторить на N недель»: время на часах сохраняется, дубли не создаются', () => {
    const ws = at('2026-10-26', 0), we = at('2026-11-02', 0)
    const r = repeatSlots(L1, ws, we, 1, MSK)
    expect(r.added).toBe(3)
    expect(layerOnCall(r.layer, at('2026-11-02', 9), MSK)).toEqual(['a'])
    expect(layerOnCall(r.layer, at('2026-11-04', 19), MSK)).toEqual(['c'])
    expect(repeatSlots(r.layer, ws, we, 1, MSK).added).toBe(0) // повторно — ничего не добавляет
    const r4 = repeatSlots(L1, ws, we, 4, MSK)
    expect(r4.added).toBe(12)
    expect(layerOnCall(r4.layer, at('2026-11-23', 9), MSK)).toEqual(['a'])
    // через переход на зимнее время (Берлин, 25.10.2026): 08:00 остаётся 08:00
    const BER = 'Europe/Berlin'
    const lb = withSlots(base(), [makeSlot({ personId: 'a', start: at('2026-10-19', 8, BER), end: at('2026-10-19', 20, BER) })])
    const rb = repeatSlots(lb, at('2026-10-19', 0, BER), at('2026-10-26', 0, BER), 1, BER)
    const copied = rb.layer.slots!.find((x) => x.start !== lb.slots![0].start)!
    expect(fmtTz(copied.start, BER, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('08:00')
    expect(+new Date(copied.start) - +new Date(lb.slots![0].start)).toBe(7 * 24 * HOUR + HOUR)
  })
  test('снятие и подмена работают и в ручном слое', () => {
    const t = at('2026-10-26', 10)
    const rem: Shift = { id: 'r1', personId: '', removesPersonId: 'a', layerId: 'L', start: new Date(at('2026-10-26', 9)).toISOString(), end: new Date(at('2026-10-26', 12)).toISOString(), createdAt: '' }
    expect(calendarOnCall(calOf(L1, [rem]), t)).toEqual([])
    const ov: Shift = { id: 'o1', personId: 'z', replacesPersonId: 'a', start: new Date(at('2026-10-26', 9)).toISOString(), end: new Date(at('2026-10-26', 12)).toISOString(), createdAt: '' }
    expect(calendarOnCall(calOf(L1, [ov]), t)).toMatchObject([{ personId: 'z', replaced: 'a', layerId: 'L' }])
    // на дорожке слоя: подменяющий стоит на месте заменяемого, внутри той же записи
    const lanes = layerLanes(calOf(L1, [ov]), at('2026-10-26', 0), at('2026-10-27', 0), HOUR, [])
    const segs = lanes[0].segs.filter((s) => s.slotId === 's1')
    expect(segs.map((s) => [s.personId, !!s.hatch])).toEqual([['a', false], ['z', true], ['a', false]])
  })
  test('дорожки: пересекающиеся записи — на разных строках', () => {
    const two = withSlots({ ...L1, parallel: 1 }, [...L1.slots!, S('d', '2026-10-26', 9, 12)])
    const lanes = layerLanes(calOf(two), at('2026-10-26', 0), at('2026-10-27', 0), HOUR, [])
    expect(lanes.filter((l) => l.layerId === 'L')).toHaveLength(2)
    expect(lanes[1].segs.map((s) => s.personId)).toEqual(['d'])
  })
  test('эскалация: уровень 1 — дежурный из графика, «следующий» — из следующей записи', () => {
    const c = { ...calOf(L1), escalation: [{ id: 'e1', delayMin: 0, targets: [{ target: 'oncall' as const }] }, { id: 'e2', delayMin: 5, targets: [{ target: 'next' as const }] }] } as Calendar
    const people = ['a', 'b', 'c', 'lead'].map((id) => ({ id, name: id.toUpperCase(), title: '', orgUnit: '', teams: [], telegram: '', phone: '' }))
    const chain = resolveChain(c, people as never, at('2026-10-26', 10))
    expect(chain[0].people.map((p) => p.id)).toEqual(['a'])
    expect(chain[1].people.map((p) => p.id)).toEqual(['b'])
  })
  test('покрытие команды и смены человека', () => {
    const cov = teamCoverage([calOf(L1)], at('2026-10-26', 0), at('2026-10-27', 0))
    expect(cov.filter((x) => x.gap).map((x) => [x.start, x.end])).toEqual([[at('2026-10-26', 0), at('2026-10-26', 8)]])
    const spans = personDutySpans([calOf(L1)], 'c', at('2026-10-26', 0), at('2026-10-30', 0))
    expect(spans.map((s) => [s.start, s.end])).toEqual([[at('2026-10-28', 8), at('2026-10-28', 20)]])
  })
  test('валидация: слой с ручным графиком требует только название; запись — человека и интервал', () => {
    expect(Object.keys(layerStepErrors(0, { ...base({ name: '' }), startDate: '' }))).toEqual(['name'])
    expect(Object.keys(slotErrors({ personId: '', start: 1, end: 0 }))).toEqual(['person', 'end'])
    expect(Object.keys(slotErrors({ personId: 'a', start: NaN, end: NaN }))).toEqual(['start', 'end'])
    expect(slotErrors({ personId: 'a', start: 0, end: HOUR })).toEqual({})
  })
})

describe('t51u. демо-данные с ручным графиком', () => {
  const small = makeCalendars(SEED)
  test('в малом наборе — календарь «Вторая линия поддержки» с ручным графиком и дырой на следующей неделе', () => {
    const c = small.find((x) => x.id === 'cal-l2')!
    expect(c.layers[0].mode).toBe('manual')
    expect(c.layers[0].participants.length).toBeGreaterThanOrEqual(3)
    expect(calendarOnCall(c, SEED).length).toBe(1)
    // ночь вт→ср следующей недели не заполнена
    expect(calendarOnCall(c, at('2026-11-03', 23)).length).toBe(0)
    expect(calendarOnCall(c, at('2026-11-03', 12)).length).toBe(1)
  })
  test('в наборе 300 команд — несколько календарей с ручным графиком, сейчас у них есть дежурный', () => {
    const s = initialState(SEED, 'large')
    const manual = s.calendars.filter((c) => c.layers.some((l) => l.mode === 'manual'))
    expect(manual.length).toBeGreaterThanOrEqual(5)
    expect(manual.every((c) => calendarOnCall(c, SEED).length > 0)).toBe(true)
    // «кто дежурит сейчас»: человек из ручного графика находится в индексе и поиском
    const c = manual[0]
    const who = calendarOnCall(c, SEED)[0].personId
    expect(onCallIndex(s.calendars, SEED).byPerson.get(who)?.some((x) => x.id === c.id)).toBe(true)
    const p = s.people.find((x) => x.id === who)!
    expect(search(buildIndex(s.people, s.calendars), p.name).some((h) => h.item.id === who || h.item.href?.includes(who))).toBe(true)
  })
  test('миграция сохраняет режим и записи графика', () => {
    const st = initialState(SEED)
    const back = migrateState(JSON.parse(JSON.stringify({ ...st, version: STATE_VERSION })))!
    const l = back.calendars.find((c) => c.id === 'cal-l2')!.layers[0]
    expect(l.mode).toBe('manual')
    expect(l.slots!.length).toBe(st.calendars.find((c) => c.id === 'cal-l2')!.layers[0].slots!.length)
  })
})

describe('t52u. расписание по неделям', () => {
  test('неделя: понедельник, ISO-номер, заголовок', () => {
    const ws = weekStart(SEED, MSK)
    expect(ws).toBe(at('2026-10-26', 0))
    expect(isoWeek(ws, MSK)).toBe(44)
    expect(isoWeek(at('2025-12-01', 0), MSK)).toBe(49) // как в макете: «49 неделя, 1 - 7 дек 2025»
    expect(weekTitle(at('2025-12-01', 0), MSK)).toBe('49 неделя, 1 – 7 дек 2025')
    expect(weekTitle(ws, MSK)).toBe('44 неделя, 26 окт – 1 нояб 2026')
    expect(isoWeek(at('2027-01-01', 0), MSK)).toBe(53)
  })
  test('месяц — стопка недель', () => {
    const w = monthWeeks(at('2026-11-15', 0), MSK)
    expect(w[0]).toBe(at('2026-10-26', 0))
    expect(w).toHaveLength(6) // 1 ноября — воскресенье
    expect(monthWeeks(at('2027-02-10', 0), MSK)).toHaveLength(4) // февраль 2027: с понедельника, 28 дней
  })
  test('подписи: «Фамилия И.» и «08:00 – 20:00 (12ч)»', () => {
    expect(surnameInitial('Мария Козлова')).toBe('Козлова М.')
    expect(cardTime({ start: at('2026-10-26', 8), end: at('2026-10-26', 20), active: [{ start: at('2026-10-26', 8), end: at('2026-10-26', 20) }] }, MSK)).toBe('08:00 – 20:00 (12ч)')
    const multi = { start: at('2026-10-26', 9), end: at('2026-10-30', 18), active: [0, 1, 2, 3, 4].map((d) => ({ start: at('2026-10-26', 9) + d * 24 * HOUR, end: at('2026-10-26', 18) + d * 24 * HOUR })) }
    expect(cardTime(multi, MSK)).toBe('пн 09:00 – пт 18:00 (45ч)')
    expect(cardTime(multi, MSK, true)).toBe('пн–пт')
  })
  test('привязка к часу при протягивании', () => {
    const ws = at('2026-10-26', 0), we = at('2026-11-02', 0)
    const f = (t: number) => (t - ws) / (we - ws)
    expect(snapToHour(ws, we, f(at('2026-10-27', 9) + 20 * 60_000), MSK, 'floor')).toBe(at('2026-10-27', 9))
    expect(snapToHour(ws, we, f(at('2026-10-27', 9) + 20 * 60_000), MSK, 'ceil')).toBe(at('2026-10-27', 10))
  })
  test('карточки: смена ротации с ограничением часов — одна карточка со штриховкой внутри', () => {
    const c = makeCalendars(SEED).find((x) => x.id === 'cal-sc')!
    const ws = at('2026-10-26', 0)
    const lanes = layerLanes(c, ws, ws + 7 * 24 * HOUR, HOUR, [])
    const senior = lanes.find((l) => l.layerId === 'l-sc-shadow')!
    const cards = cardsOfLane(c, senior, c.layers[1])
    const multi = cards.find((x) => x.active.length > 1)!
    expect(multi).toBeTruthy()
    expect(multi.active.every((x) => x.end - x.start === 9 * HOUR)).toBe(true) // 09–18, ночи — штриховка
  })
  test('доска недели: группы слоёв, подмена в строке слоя, дыры ручного графика и календаря', () => {
    const c0 = makeCalendars(SEED).find((x) => x.id === 'cal-sbp')!
    const who = layerOnCall(c0.layers[0], at('2026-10-27', 12), MSK)[0]
    const c = { ...c0, shifts: [{ id: 'ov', personId: 'u-pay1', replacesPersonId: who, start: new Date(at('2026-10-27', 10)).toISOString(), end: new Date(at('2026-10-28', 10)).toISOString(), createdAt: '' }] }
    const b = weekBoard(c, at('2026-10-26', 0))
    expect(b.groups.map((g) => g.label)).toEqual(['Недельная ротация', 'Выходные — усиление'])
    const subst = b.groups.flatMap((g) => g.rows.flat()).filter((x) => x.state === 'subst')
    expect(subst.length).toBeGreaterThan(0)
    expect(subst[0]).toMatchObject({ personId: 'u-pay1', replaced: who, start: at('2026-10-27', 10), end: at('2026-10-28', 10) })
    expect(b.groups[0].rows).toHaveLength(1) // подмена — в той же строке, на месте заменяемого
    const l2 = makeCalendars(SEED).find((x) => x.id === 'cal-l2')!
    const next = weekBoard(l2, at('2026-11-02', 0))
    expect(next.groups[0].gaps[0]).toEqual({ start: at('2026-11-03', 20), end: at('2026-11-04', 8) })
    expect(next.gaps[0]).toEqual({ start: at('2026-11-03', 20), end: at('2026-11-04', 8) })
    // запись графика — отдельная карточка (соседние смены одного человека не склеиваются)
    expect(next.groups[0].rows[0].every((x) => !!x.slotId)).toBe(true)
  })
})
