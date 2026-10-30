import { describe, expect, test } from 'vitest'
import { defaultEscalation, initialState, makeCalendars, migrateEscalation, migrateKind, migrateState, PEOPLE, STATE_VERSION } from '../data'
import { calendarOnCall, HOUR, layerOnCall, personDutySpans } from '../engine'
import { ESC_LABEL, resolveChain } from '../escalation'
import { layerLanes } from '../lanes'
import { allTemplates, BUILTIN_TEMPLATES, queueSize, templatePatch } from '../templates'
import { KIND_META } from '../ui'
import { calendarFormErrors, layerStepErrors } from '../validation'
import type { Calendar, Layer, Shift } from '../types'

const SEED = Date.UTC(2026, 9, 28, 9, 0)
const T = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК
const cals = makeCalendars(SEED)
const cal = (id: string) => cals.find((c) => c.id === id)!
const iso = (t: number) => new Date(t).toISOString()
const shift = (p: Partial<Shift>): Shift => ({ id: 's-' + Math.random().toString(36).slice(2), personId: '', start: iso(T - HOUR), end: iso(T + 2 * HOUR), createdAt: iso(SEED), ...p } as Shift)
const layer = (id: string, people: string[]): Layer => ({
  id, name: id, kind: 'primary', participants: people, startsAt: '2026-10-01', handoffTime: '09:00',
  rotation: { unit: 'week', count: 1 }, parallel: 1, restriction: { type: 'none', from: '00:00', to: '00:00', days: [] },
})

describe('1. подмена заменяет человека в его строке', () => {
  const sc = cal('cal-sc')
  const main = sc.layers[0]
  const pid = layerOnCall(main, T, sc.timezone)[0]
  const ov = shift({ personId: 'u-mon1', replacesPersonId: pid, note: 'Подмена' })
  const c: Calendar = { ...sc, shifts: [ov] }
  const lanes = layerLanes(c, T - 6 * HOUR, T + 6 * HOUR, HOUR, [+new Date(ov.start), +new Date(ov.end)])

  test('в дорожке слоя на месте заменяемого стоит подменяющий со штриховкой', () => {
    const lane = lanes.find((l) => l.layerId === main.id)!
    const seg = lane.segs.find((s) => s.start <= T && T < s.end)!
    expect(seg.personId).toBe('u-mon1')
    expect(seg.hatch).toBe(true)
    expect(seg.replaced).toBe(pid)
    expect(seg.shiftId).toBe(ov.id)
    expect(seg.start).toBe(+new Date(ov.start)) // точная граница подмены
    expect(seg.end).toBe(+new Date(ov.end))
  })
  test('строки «Разовые…» нет, если нет настоящих разовых', () => {
    expect(lanes.some((l) => l.key === 'shifts')).toBe(false)
  })
  test('разовое добавление — в своей строке «Разовые дежурства»', () => {
    const c2: Calendar = { ...c, shifts: [ov, shift({ personId: 'u-mon2' })] }
    const l2 = layerLanes(c2, T - 6 * HOUR, T + 6 * HOUR, HOUR)
    const one = l2.find((l) => l.key === 'shifts')!
    expect(one.label).toBe('Разовые дежурства')
    expect(one.segs.map((s) => s.personId)).toEqual(['u-mon2'])
  })
  test('итог и таймлайн команды: подменяющий в слое заменяемого, заменяемого нет', () => {
    const e = calendarOnCall(c, T)
    expect(e.find((x) => x.personId === 'u-mon1')).toMatchObject({ kind: 'override', replaced: pid, layerId: main.id })
    expect(e.some((x) => x.personId === pid && x.layerId === main.id)).toBe(false)
    const spans = personDutySpans([c], 'u-mon1', T - 6 * HOUR, T + 6 * HOUR)
    expect(spans).toEqual([expect.objectContaining({ kind: 'override', layerName: main.name, replacedId: pid })])
    expect(personDutySpans([c], pid, T - 6 * HOUR, T + 6 * HOUR).some((s) => s.layerId === main.id && s.start < T && T < s.end)).toBe(false)
  })
  test('человек в двух слоях заменяется в обоих', () => {
    const toy: Calendar = { ...sc, id: 'toy', layerMode: 'parallel', layers: [layer('L1', ['u-ib1']), layer('L2', ['u-ib1'])], shifts: [shift({ personId: 'u-ib2', replacesPersonId: 'u-ib1' })] }
    expect(calendarOnCall(toy, T).map((e) => e.personId)).toEqual(['u-ib2'])
    const ln = layerLanes(toy, T - HOUR, T + HOUR, HOUR)
    expect(ln.map((l) => l.segs.find((s) => s.start <= T && T < s.end)?.personId)).toEqual(['u-ib2', 'u-ib2'])
  })
})

describe('2. гибкая эскалация', () => {
  test('нет «Дежурного ситуационного центра»; есть «Дежурный другого календаря»', () => {
    expect(Object.keys(ESC_LABEL)).not.toContain('sitcenter')
    expect(ESC_LABEL.calendar).toBe('Дежурный другого календаря')
  })
  test('цель «другой календарь»: его текущие дежурные; если там пусто — его лид', () => {
    const other: Calendar = { ...cal('cal-pay'), escalation: [...defaultEscalation(), { id: 'c', delayMin: 5, targets: [{ target: 'calendar', calendarId: 'cal-mon' }] }] }
    const chain = resolveChain(other, PEOPLE, T, cals)
    const lv = chain[chain.length - 1]
    expect(lv.label).toBe('Дежурный «Мониторинг Zabbix»')
    expect(lv.people.map((p) => p.id).sort()).toEqual(calendarOnCall(cal('cal-mon'), T).map((e) => e.personId).sort())
    const empty = { ...cal('cal-mon'), layers: [] }
    const ch2 = resolveChain(other, PEOPLE, T, cals.map((x) => (x.id === 'cal-mon' ? empty : x)))
    expect(ch2[ch2.length - 1].people.map((p) => p.id)).toEqual(['u-mon-lead'])
  })
  test('несколько целей на уровне, дубли за цикл не зовём', () => {
    const c: Calendar = { ...cal('cal-ib'), escalation: [
      { id: '1', delayMin: 0, targets: [{ target: 'oncall' }] },
      { id: '2', delayMin: 5, targets: [{ target: 'person', personId: 'u-head' }, { target: 'manager' }, { target: 'person', personId: 'u-head' }] },
    ] }
    const [, lv2] = resolveChain(c, PEOPLE, T, cals)
    expect(lv2.targets).toHaveLength(3)
    expect(lv2.label).toContain(' + ')
    const ids = lv2.people.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('u-head')
    expect(lv2.delayMin).toBe(5)
  })
  test('порядок уровней — как в правилах; уровень 1 всегда начинается с дежурных', () => {
    const c: Calendar = { ...cal('cal-pay'), escalation: [
      { id: '1', delayMin: 9, targets: [{ target: 'lead' }] },
      { id: '2', delayMin: 3, targets: [{ target: 'manager' }] },
      { id: '3', delayMin: 4, targets: [{ target: 'next' }] },
    ] }
    const chain = resolveChain(c, PEOPLE, T, cals)
    expect(chain.map((l) => l.target)).toEqual(['oncall', 'manager', 'next'])
    expect(chain[0].targets.map((r) => r.target)).toEqual(['oncall', 'lead'])
    expect(chain.map((l) => l.delayMin)).toEqual([0, 3, 7])
  })
  test('миграция: sitcenter → дежурный календаря СЦ; в самом СЦ уровень убирается', () => {
    const old = [{ id: 'a', target: 'oncall', delayMin: 0 }, { id: 'b', target: 'lead', delayMin: 10 }, { id: 'c', target: 'sitcenter', delayMin: 20 }]
    expect(migrateEscalation(old, 'cal-ib', 'cal-sc').map((s) => s.targets)).toEqual([[{ target: 'oncall' }], [{ target: 'lead' }], [{ target: 'calendar', calendarId: 'cal-sc' }]])
    expect(migrateEscalation(old, 'cal-sc', 'cal-sc').map((s) => s.targets.map((r) => r.target))).toEqual([['oncall'], ['lead']])
    expect(migrateEscalation(old, 'cal-ib', undefined)).toHaveLength(2)
    // уровень 1 не «дежурные» → дежурные вставляются первым уровнем, старый уровень сдвигается
    expect(migrateEscalation([{ id: 'x', target: 'manager', delayMin: 7 }], 'c', 'cal-sc').map((x) => [x.delayMin, x.targets])).toEqual([[0, [{ target: 'oncall' }]], [7, [{ target: 'manager' }]]])
  })
  test('большой набор: у каждого календаря правило «дежурный СЦ» указывает на cal-sc', () => {
    const big = initialState(SEED, 'large')
    const c = big.calendars[200]
    expect(c.escalation.some((s) => s.targets.some((r) => r.target === 'calendar' && r.calendarId === 'cal-sc'))).toBe(true)
  })
})

describe('3 и 5. без типа календаря; тип дежурства только Основной/Резерв', () => {
  test('KIND_META: Основной и Резерв (+ подмена/разовое для смен)', () => {
    expect(Object.keys(KIND_META).sort()).toEqual(['oneoff', 'override', 'primary', 'secondary'])
    expect(KIND_META.primary.label).toBe('Основной')
    expect(KIND_META.secondary.label).toBe('Резерв')
  })
  test('наборы данных: только primary/secondary и без поля type', () => {
    for (const ds of ['small', 'large'] as const) {
      const s = initialState(SEED, ds)
      expect(new Set(s.calendars.flatMap((c) => c.layers.map((l) => l.kind)))).toEqual(new Set(['primary', 'secondary']))
      expect(s.calendars.some((c) => 'type' in c)).toBe(false)
      expect(JSON.stringify(s.calendars)).not.toContain('sitcenter')
    }
  })
  test('migrateKind', () => {
    expect(['primary', 'business', 'night', 'shadow', undefined, 'secondary'].map(migrateKind)).toEqual(['primary', 'primary', 'primary', 'primary', 'primary', 'secondary'])
  })
  test('миграция v4 → v5: тип убран, виды слоёв и эскалация приведены', () => {
    const v4 = JSON.parse(JSON.stringify({ ...initialState(SEED), version: 4 }))
    for (const c of v4.calendars) {
      c.type = c.id === 'cal-sc' ? 'sitcenter' : 'product'
      c.escalation = [{ id: 'a', target: 'oncall', delayMin: 0 }, { id: 'b', target: 'next', delayMin: 5 }, { id: 'c', target: 'sitcenter', delayMin: 20 }]
      c.layers.forEach((l: { kind: string }, i: number) => { l.kind = ['business', 'night', 'shadow', 'secondary'][i % 4] })
    }
    const s = migrateState(v4)!
    expect(s.version).toBe(STATE_VERSION)
    expect(s.calendars.some((c) => 'type' in c)).toBe(false)
    expect(s.calendars.flatMap((c) => c.layers.map((l) => l.kind)).every((k) => k === 'primary' || k === 'secondary')).toBe(true)
    const ib = s.calendars.find((c) => c.id === 'cal-ib')!
    expect(ib.escalation[2].targets).toEqual([{ target: 'calendar', calendarId: 'cal-sc' }])
    const sc = s.calendars.find((c) => c.id === 'cal-sc')!
    expect(sc.escalation.flatMap((x) => x.targets).some((r) => r.target === 'calendar')).toBe(false)
    // повторная миграция v5 ничего не меняет
    expect(migrateState(JSON.parse(JSON.stringify(s)))!.calendars).toEqual(s.calendars)
  })
})

describe('4. валидация форм', () => {
  test('новый календарь: что не заполнено', () => {
    const e = calendarFormErrors({ name: ' ', teamChoice: '', newTeam: '', leadId: '' })
    expect(Object.values(e).map((x) => x!.label)).toEqual(['название', 'команда', 'лид'])
    expect(Object.keys(calendarFormErrors({ name: 'X', teamChoice: '__new', newTeam: '', leadId: 'u' }))).toEqual(['newTeam'])
    expect(calendarFormErrors({ name: 'X', teamChoice: 'СБП', newTeam: '', leadId: 'u' })).toEqual({})
  })
  test('мастер ротации: ошибки по шагам', () => {
    const l = { ...layer('L', []), name: '', startDate: '2026-10-01' }
    expect(Object.keys(layerStepErrors(0, l))).toEqual(['name'])
    expect(Object.keys(layerStepErrors(1, { ...l, rotation: { unit: 'day', count: 0 }, startDate: '' }))).toEqual(['count', 'start'])
    expect(Object.keys(layerStepErrors(2, l))).toEqual(['participants'])
    expect(Object.keys(layerStepErrors(3, { ...l, restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [] } }))).toEqual(['days'])
    expect(layerStepErrors(4, l)).toEqual({})
  })
})

describe('6. шаблоны ротаций: только встроенные (своих шаблонов нет)', () => {
  test('короткий встроенный набор, в т.ч. «Сутки через трое» и «2/2»', () => {
    const all = allTemplates()
    expect(all.map((t) => t.name)).toEqual(['Сутки через трое', 'Неделя разработки', '2/2 по 12 часов', 'Только выходные', 'Рабочие часы 9-18'])
    expect(all.every((t) => t.builtin && (t.kind === 'primary' || t.kind === 'secondary'))).toBe(true)
  })
  test('ритм «N через M» → размер очереди', () => {
    expect(queueSize(BUILTIN_TEMPLATES[0])).toBe(4) // сутки через трое
    expect(queueSize(BUILTIN_TEMPLATES[2])).toBe(2) // 2/2
    expect(queueSize(BUILTIN_TEMPLATES[1])).toBeNull()
  })
  test('шаблон → поля слоя; старт — ближайшая передача смены, а не понедельник', () => {
    // пт 10:30 МСК: передача в 09:00 и в 10:00 уже прошла — старт завтра
    expect(templatePatch(BUILTIN_TEMPLATES[2], T, 'Europe/Moscow')).toMatchObject({ handoffTime: '09:00', rotation: { unit: 'day', count: 2 }, startsAt: '2026-10-31' })
    expect(templatePatch(BUILTIN_TEMPLATES[1], T, 'Europe/Moscow').startsAt).toBe('2026-10-31')
    // передача в 12:00 ещё впереди — старт сегодня
    expect(templatePatch({ ...BUILTIN_TEMPLATES[1], handoffTime: '12:00' }, T, 'Europe/Moscow').startsAt).toBe('2026-10-30')
  })
})

describe('t50u. поиск календарей по команде, «Дежурства команды»', () => {
  test('«Все календари»: запрос по названию команды находит календарь, даже если в названии календаря его нет (300 команд)', async () => {
    const { filterCalendars, EMPTY_FILTER } = await import('../search')
    const s = initialState(SEED, 'large')
    expect(s.calendars.length).toBeGreaterThanOrEqual(290)
    const target = s.calendars[150]
    const cs = s.calendars.map((c) => (c.id === target.id ? { ...c, team: 'Команда Фобос' } : c))
    const hit = filterCalendars(cs, { ...EMPTY_FILTER, q: 'фобос' }, T, () => '')
    expect(hit.map((c) => c.id)).toEqual([target.id])
    // несколько слов, ё/е, регистр
    expect(filterCalendars(cs, { ...EMPTY_FILTER, q: 'КОМАНДА фобос' }, T, () => '').map((c) => c.id)).toEqual([target.id])
    // по каждой команде 300-набора находится её календарь
    for (const c of s.calendars) expect(filterCalendars(s.calendars, { ...EMPTY_FILTER, q: c.team }, T, () => '').some((x) => x.id === c.id)).toBe(true)
  })
  test('в глобальном поиске команда — «Дежурства команды»', async () => {
    const { buildIndex, search, KIND_LABEL } = await import('../search')
    const s = initialState(SEED, 'small')
    const idx = buildIndex(s.people, s.calendars)
    const team = idx.find((x) => x.kind === 'team')!
    expect(team.sub.startsWith('Дежурства команды')).toBe(true)
    expect(KIND_LABEL.team).toBe('Дежурства команд')
    // календарь ищется по команде
    const c = s.calendars.find((x) => x.team !== x.name) ?? s.calendars[0]
    expect(search(idx, c.team).some((h) => h.item.kind === 'calendar' && h.item.id === c.id)).toBe(true)
  })
})
