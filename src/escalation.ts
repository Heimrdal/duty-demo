import { calendarOnCall, layerOnCall, managerOf, nextInRotation } from './engine'
import type { Calendar, EscStep, Person } from './types'

export const ESC_LABEL: Record<EscStep['target'], string> = {
  oncall: 'Дежурные сейчас',
  next: 'Следующий по ротации',
  lead: 'Лид группы',
  manager: 'Руководитель дежурного',
  person: 'Конкретный сотрудник',
  sitcenter: 'Дежурный ситуационного центра',
}

export interface ChainLevel {
  level: number
  /** минуты от начала инцидента (в пределах одного цикла) */
  delayMin: number
  label: string
  target: EscStep['target']
  /** кого уведомляем на этом уровне */
  people: Person[]
  /** подходят под уровень, но уже получили уведомление раньше — повторно не зовём */
  already: { person: Person; level: number }[]
  note?: string
}

/**
 * Разворачивает правила эскалации календаря в конкретных людей на момент t.
 * Уровень 1 всегда — текущие дежурные календаря. Один человек получает одно уведомление за цикл,
 * даже если подходит под несколько уровней (например, лид и руководитель — один человек).
 */
export function resolveChain(c: Calendar, people: Person[], t: number, calendars: Calendar[] = [c]): ChainLevel[] {
  const byId = (id: string) => people.find((p) => p.id === id)
  const list = (ids: string[]) => ids.map(byId).filter((p): p is Person => !!p)
  const onCall = list(calendarOnCall(c, t).map((e) => e.personId))
  const notified = new Map<string, number>()
  let acc = 0
  return c.escalation.map((s, i) => {
    acc += i === 0 ? 0 : s.delayMin
    const target: EscStep['target'] = i === 0 ? 'oncall' : s.target
    let ps: Person[] = []
    let note: string | undefined
    if (target === 'oncall') {
      ps = onCall
      note = i === 0 ? 'кто дежурит в календаре в момент инцидента' : undefined
    }
    if (target === 'next') {
      const l = c.layers.find((x) => layerOnCall(x, t, c.timezone).length) ?? c.layers[0]
      ps = l ? list(nextInRotation(l, t, c.timezone)) : []
      note = l ? `из слоя «${l.name}»` : undefined
    }
    if (target === 'lead') {
      ps = list([c.leadId])
      note = `лид календаря «${c.name}»`
    }
    if (target === 'manager') {
      const pairs: { person: Person; manager: Person }[] = []
      const seen = new Set<string>()
      for (const p of onCall) {
        const mg = managerOf(people, p.id)
        if (!mg || seen.has(mg.id)) continue
        seen.add(mg.id)
        pairs.push({ person: p, manager: mg })
      }
      ps = pairs.map((p) => p.manager)
      note = pairs.length
        ? pairs.map((p) => `руководитель ${p.person.name}`).join(', ')
        : 'нет дежурного — руководитель не берётся из другого календаря'
    }
    if (target === 'person' && s.personId) ps = list([s.personId])
    if (target === 'sitcenter') {
      const sc = calendars.find((x) => x.type === 'sitcenter' && x.id !== c.id) ?? calendars.find((x) => x.type === 'sitcenter')
      if (sc) {
        ps = list(calendarOnCall(sc, t).map((e) => e.personId))
        note = ps.length ? `текущая смена «${sc.name}»` : `в «${sc.name}» сейчас никого — зовём лида календаря СЦ`
        if (!ps.length) ps = list([sc.leadId])
      } else note = 'календарь ситуационного центра не найден'
    }
    const fresh: Person[] = []
    const already: { person: Person; level: number }[] = []
    for (const p of ps) {
      const lv = notified.get(p.id)
      if (lv) already.push({ person: p, level: lv })
      else if (!fresh.some((x) => x.id === p.id)) { fresh.push(p); notified.set(p.id, i + 1) }
    }
    return { level: i + 1, delayMin: acc, label: ESC_LABEL[target], target, people: fresh, already, note }
  })
}

/** Длительность одного цикла: последний уровень + пауза, равная задержке второго уровня (или 5 мин). */
export function cycleMinutes(c: Calendar, chain: ChainLevel[]) {
  const last = chain[chain.length - 1]?.delayMin ?? 0
  return last + Math.max(1, c.escalation[1]?.delayMin ?? 5)
}
