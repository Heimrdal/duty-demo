import { describe, expect, test } from 'vitest'
import { makeLargePart } from '../bigdata'
import { onCallIndex } from '../cache'
import { initialState, PEOPLE } from '../data'
import { favKey, loadFavorites, toggleFavorite } from '../favorites'
import { buildIndex, EMPTY_FILTER, filterCalendars, filterPeople, groupHits, norm, search } from '../search'

const NOW = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК

function memStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

describe('большой демо-набор', () => {
  test('генератор детерминирован: тот же seed и время — те же данные', () => {
    const base = initialState(NOW, 'small')
    const a = makeLargePart(base.people, NOW)
    const b = makeLargePart(base.people, NOW)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  test('масштаб: ~300 календарей, ~1500 людей, 25 подразделений, уникальные id и telegram', () => {
    const s = initialState(NOW, 'large')
    expect(s.dataset).toBe('large')
    expect(s.calendars.length).toBeGreaterThanOrEqual(290)
    expect(s.calendars.length).toBeLessThanOrEqual(310)
    expect(s.people.length).toBeGreaterThan(1200)
    expect(s.people.length).toBeLessThan(1800)
    expect(new Set(s.people.map((p) => p.orgUnit)).size).toBe(25)
    expect(new Set(s.people.map((p) => p.id)).size).toBe(s.people.length)
    expect(new Set(s.people.map((p) => p.telegram)).size).toBe(s.people.length)
    expect(new Set(s.calendars.map((c) => c.id)).size).toBe(s.calendars.length)
    // все ссылки на людей валидны
    const ids = new Set(s.people.map((p) => p.id))
    for (const c of s.calendars) {
      expect(ids.has(c.leadId)).toBe(true)
      for (const l of c.layers) for (const p of l.participants) expect(ids.has(p)).toBe(true)
    }
    // исходный маленький набор целиком внутри большого
    for (const p of PEOPLE) expect(ids.has(p.id)).toBe(true)
  })
  test('в большом наборе есть и дыры, и покрытые календари', () => {
    const s = initialState(NOW, 'large')
    const idx = onCallIndex(s.calendars, NOW)
    // календари без графика — «ещё не запущены», а не дыры
    expect(idx.pendingNow.length).toBeGreaterThan(0)
    expect(idx.pendingNow.every((c) => !c.layers.length)).toBe(true)
    // ночью у команд «только рабочие часы» — настоящие дыры
    const night = NOW - (NOW % (24 * 3600_000)) + 22 * 3600_000
    const n = onCallIndex(s.calendars, night)
    expect(n.gapsNow.length).toBeGreaterThan(0)
    expect(n.gapsNow.length).toBeLessThan(s.calendars.length / 3)
  })
})

describe('глобальный поиск', () => {
  const s = initialState(NOW, 'large')
  const index = buildIndex(s.people, s.calendars)
  test('нормализация: регистр и ё', () => {
    expect(norm('Ёлка  Way4!')).toBe('елка way4')
  })
  test('точное совпадение выше префикса, префикс выше вхождения', () => {
    const hits = search(index, 'Мониторинг Zabbix')
    expect(hits[0].item.kind).toBe('calendar')
    expect(hits[0].item.id).toBe('cal-mon')
  })
  test('человек находится по фамилии и по telegram', () => {
    const orl = PEOPLE.find((p) => p.name.includes('Орлова'))!
    expect(search(index, 'орлова').some((h) => h.item.kind === 'person' && h.item.id === orl.id)).toBe(true)
    expect(search(index, orl.telegram)[0].item.id).toBe(orl.id)
  })
  test('порядок слов не важен; пустой запрос — пусто', () => {
    const orl = PEOPLE.find((p) => p.name.includes('Орлова'))!
    const [first, last] = orl.name.split(' ')
    expect(search(index, `${last} ${first}`).some((h) => h.item.id === orl.id)).toBe(true)
    expect(search(index, '   ')).toEqual([])
  })
  test('группировка по типам ограничена', () => {
    const groups = groupHits(search(index, 'а', 100), 6)
    for (const g of groups) expect(g.hits.length).toBeLessThanOrEqual(6)
  })
})

describe('выбор сотрудника', () => {
  const s = initialState(NOW, 'large')
  test('все слова должны совпасть; команда идёт первой', () => {
    const orl = PEOPLE.find((p) => p.name.includes('Орлова'))!
    const r = filterPeople(s.people, orl.name.split(' ')[0], [orl.id])
    expect(r.team.map((p) => p.id)).toContain(orl.id)
    expect(r.rest.some((p) => p.id === orl.id)).toBe(false)
  })
  test('поиск по подразделению и должности', () => {
    const p = s.people[400]
    const r = filterPeople(s.people, `${p.orgUnit} ${p.title}`, [], 5000)
    expect([...r.team, ...r.rest].every((x) => x.orgUnit === p.orgUnit && x.title === p.title)).toBe(true)
    expect(r.total).toBeGreaterThan(0)
  })
  test('лимит выдачи и общее число', () => {
    const r = filterPeople(s.people, '', [], 50)
    expect(r.team.length + r.rest.length).toBe(50)
    expect(r.total).toBe(s.people.length)
  })
})

describe('избранное', () => {
  test('переключение и хранение отдельно для каждого пользователя', () => {
    const st = memStorage()
    expect(loadFavorites('u1', st)).toEqual([])
    expect(toggleFavorite('u1', 'cal-sc', st)).toEqual(['cal-sc'])
    toggleFavorite('u1', 'cal-mon', st)
    expect(loadFavorites('u1', st)).toEqual(['cal-sc', 'cal-mon'])
    expect(loadFavorites('u2', st)).toEqual([])
    expect(toggleFavorite('u1', 'cal-sc', st)).toEqual(['cal-mon'])
    st.setItem(favKey('u3'), 'не json')
    expect(loadFavorites('u3', st)).toEqual([])
  })
})

describe('фильтры календарей', () => {
  const s = initialState(NOW, 'large')
  const orgOf = (c: (typeof s.calendars)[number]) => c.orgUnit ?? ''
  test('«только без покрытия сейчас» совпадает с индексом', () => {
    const f = filterCalendars(s.calendars, { ...EMPTY_FILTER, coverage: 'now' }, NOW, orgOf)
    expect(f.map((c) => c.id).sort()).toEqual(onCallIndex(s.calendars, NOW).gapsNow.map((c) => c.id).sort())
  })
  test('подразделение сужает выдачу; типа календаря больше нет', () => {
    const org = s.calendars[100].orgUnit!
    const f = filterCalendars(s.calendars, { ...EMPTY_FILTER, org }, NOW, orgOf)
    expect(f.length).toBeGreaterThan(0)
    expect(f.every((c) => c.orgUnit === org)).toBe(true)
    expect(Object.keys(EMPTY_FILTER).sort()).toEqual(['coverage', 'org', 'q'])
    expect(s.calendars.some((c) => 'type' in c)).toBe(false)
  })
})

describe('производительность (санити)', () => {
  test('индекс дежурных по 300 календарям и поиск укладываются в бюджет', () => {
    let t = performance.now()
    const s = initialState(NOW, 'large')
    const gen = performance.now() - t
    t = performance.now()
    onCallIndex(s.calendars, NOW + 60_000 * 7)
    const idx = performance.now() - t
    t = performance.now()
    const index = buildIndex(s.people, s.calendars)
    const build = performance.now() - t
    let worst = 0
    for (const q of ['о', 'ор', 'орл', 'орло', 'way4', 'kafka', 'сбп', 'иван петров']) {
      t = performance.now(); search(index, q); worst = Math.max(worst, performance.now() - t)
    }
    console.log(`perf: gen ${gen.toFixed(1)} ms, onCallIndex ${idx.toFixed(1)} ms, buildIndex ${build.toFixed(1)} ms, search worst ${worst.toFixed(2)} ms`)
    expect(gen).toBeLessThan(500)
    expect(idx).toBeLessThan(150)
    expect(build).toBeLessThan(200)
    expect(worst).toBeLessThan(50)
  })
})
