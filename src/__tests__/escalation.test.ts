import { describe, expect, test } from 'vitest'
import { makeCalendars, migrateState, PEOPLE, STATE_VERSION } from '../data'
import { calendarOnCall } from '../engine'
import { cycleMinutes, resolveChain } from '../escalation'
import type { Calendar } from '../types'

const SEED = Date.UTC(2026, 9, 28, 9, 0)
const T = Date.parse('2026-10-30T07:30:00Z') // пт 10:30 МСК
const cals = makeCalendars(SEED)
const cal = (id: string) => cals.find((c) => c.id === id)!

describe('эскалация', () => {
  test('уровень 1 любой политики — текущие дежурные календаря', () => {
    for (const c of cals) {
      const chain = resolveChain(c, PEOPLE, T, cals)
      expect(chain[0].target).toBe('oncall')
      expect(chain[0].delayMin).toBe(0)
      expect(chain[0].people.map((p) => p.id).sort()).toEqual([...new Set(calendarOnCall(c, T).map((e) => e.personId))].sort())
    }
  })

  test('уровень 1 «Ситуационного центра» — сменный инженер СЦ, а не руководитель', () => {
    const chain = resolveChain(cal('cal-sc'), PEOPLE, T, cals)
    expect(chain[0].people.map((p) => p.id)).toContain('u-sc2')
    expect(chain[0].people.map((p) => p.id)).not.toContain('u-sc-mgr')
  })

  test('уровень «Дежурный другого календаря» (СЦ) — текущая смена СЦ', () => {
    const chain = resolveChain(cal('cal-ib'), PEOPLE, T, cals)
    const sc = chain.find((l) => l.target === 'calendar')!
    expect(sc.label).toBe('Дежурный «Ситуационный центр»')
    expect(sc.people.map((p) => p.id)).toEqual(['u-sc2', 'u-sc3'])
    expect(sc.people.map((p) => p.id)).not.toContain('u-sc-mgr')
  })

  test('каждый человек уведомляется один раз; повтор показан как пропуск', () => {
    // В 10:30 МСК лид «Интернет-банка» сам дежурит на уровне 1 — уровень «Лид группы» его не зовёт повторно.
    const chain = resolveChain(cal('cal-ib'), PEOPLE, T, cals)
    const all = chain.flatMap((l) => l.people.map((p) => p.id))
    expect(new Set(all).size).toBe(all.length)
    const lead = chain.find((l) => l.target === 'lead')!
    expect(lead.people).toHaveLength(0)
    expect(lead.already).toEqual([expect.objectContaining({ level: 1, person: expect.objectContaining({ id: 'u-ib-lead' }) })])
  })

  test('уровень 1 принудительно «дежурные», даже если правило испорчено', () => {
    const broken: Calendar = { ...cal('cal-pay'), escalation: [{ id: 'x', targets: [{ target: 'manager' }], delayMin: 7 }, ...cal('cal-pay').escalation.slice(1)] }
    const chain = resolveChain(broken, PEOPLE, T, cals)
    expect(chain[0].target).toBe('oncall')
    expect(chain[0].delayMin).toBe(0)
  })

  test('длина цикла для повторов', () => {
    const c = cal('cal-ib')
    const chain = resolveChain(c, PEOPLE, T, cals)
    expect(cycleMinutes(c, chain)).toBe(chain[chain.length - 1].delayMin + 5)
  })
})

describe('миграция localStorage v3 → v5', () => {
  test('зона, оргструктура и уровень 1', () => {
    const v3 = {
      version: 3, currentUserId: 'u-ib1',
      people: PEOPLE.map(({ orgUnit, teams: _t, ...p }) => ({ ...p, team: p.id === 'u-ib1' ? 'СБП' : orgUnit })),
      calendars: cals.map((c) => ({ ...c, timezone: undefined, escalation: c.id === 'cal-sc' ? [{ id: 'm', target: 'manager', delayMin: 5 }] : c.escalation })),
      notify: {}, messages: [],
    }
    const s = migrateState(JSON.parse(JSON.stringify(v3)))!
    expect(s.version).toBe(STATE_VERSION)
    const ib1 = s.people.find((p) => p.id === 'u-ib1')!
    expect(ib1.orgUnit).toBe('Интернет-банк') // подразделение восстановлено из справочника
    expect(ib1.teams.sort()).toEqual(['Интернет-банк', 'СБП']) // членство в СБП сохранено
    expect(s.calendars.every((c) => c.timezone === 'Europe/Moscow')).toBe(true)
    const sc = s.calendars.find((c) => c.id === 'cal-sc')!
    expect(sc.escalation.map((e) => e.targets.map((r) => r.target))).toEqual([['oncall'], ['manager']])
  })
  test('чужие версии не принимаются', () => {
    expect(migrateState({ version: 2 })).toBeNull()
    expect(migrateState(null)).toBeNull()
  })
})
