import { calendarOnCall, layerOnCall, managerOf, nextInRotation } from './engine'
import type { Calendar, EscRule, EscTarget, Person } from './types'

export const ESC_LABEL: Record<EscTarget, string> = {
  oncall: 'Дежурные сейчас',
  next: 'Следующий по ротации',
  lead: 'Лид группы',
  manager: 'Руководитель дежурного',
  person: 'Конкретный сотрудник',
  calendar: 'Дежурный другого календаря',
}

export interface ChainLevel {
  level: number
  /** минуты от начала инцидента (в пределах одного цикла) */
  delayMin: number
  label: string
  /** первая цель уровня (для совместимости) */
  target: EscTarget
  targets: EscRule[]
  /** кого уведомляем на этом уровне */
  people: Person[]
  /** подходят под уровень, но уже получили уведомление раньше — повторно не зовём */
  already: { person: Person; level: number }[]
  note?: string
}

/** Подпись одной цели с учётом выбранного сотрудника/календаря. */
export function ruleLabel(r: EscRule, people: Person[], calendars: Calendar[]): string {
  if (r.target === 'person') {
    const p = people.find((x) => x.id === r.personId)
    return p ? p.name : 'Сотрудник не выбран'
  }
  if (r.target === 'calendar') {
    const cal = calendars.find((x) => x.id === r.calendarId)
    return cal ? `Дежурный «${cal.name}»` : 'Календарь не выбран'
  }
  return ESC_LABEL[r.target]
}

/**
 * Разворачивает правила эскалации календаря в конкретных людей на момент t.
 * Уровень 1 всегда начинается с текущих дежурных календаря. Один человек получает одно уведомление за цикл,
 * даже если подходит под несколько уровней (например, лид и руководитель — один человек).
 */
export function resolveChain(c: Calendar, people: Person[], t: number, calendars: Calendar[] = [c]): ChainLevel[] {
  const byId = (id: string) => people.find((p) => p.id === id)
  const list = (ids: string[]) => ids.map(byId).filter((p): p is Person => !!p)
  const onCall = list(calendarOnCall(c, t).map((e) => e.personId))
  const notified = new Map<string, number>()
  let acc = 0
  const resolveRule = (r: EscRule, first: boolean): { ps: Person[]; note?: string } => {
    if (r.target === 'oncall') return { ps: onCall, note: first ? 'кто дежурит в календаре в момент инцидента' : undefined }
    if (r.target === 'next') {
      const l = c.layers.find((x) => layerOnCall(x, t, c.timezone).length) ?? c.layers[0]
      return { ps: l ? list(nextInRotation(l, t, c.timezone)) : [], note: l ? `из слоя «${l.name}»` : undefined }
    }
    if (r.target === 'lead') return { ps: list([c.leadId]), note: `лид календаря «${c.name}»` }
    if (r.target === 'manager') {
      const pairs: { person: Person; manager: Person }[] = []
      const seen = new Set<string>()
      for (const p of onCall) {
        const mg = managerOf(people, p.id)
        if (!mg || seen.has(mg.id)) continue
        seen.add(mg.id)
        pairs.push({ person: p, manager: mg })
      }
      return {
        ps: pairs.map((p) => p.manager),
        note: pairs.length ? pairs.map((p) => `руководитель ${p.person.name}`).join(', ') : 'нет дежурного — руководитель не берётся из другого календаря',
      }
    }
    if (r.target === 'person') return { ps: r.personId ? list([r.personId]) : [], note: r.personId ? undefined : 'сотрудник не выбран' }
    // calendar: текущие дежурные другого календаря; если там пусто — его лид
    const other = calendars.find((x) => x.id === r.calendarId)
    if (!other) return { ps: [], note: 'календарь не выбран или удалён' }
    const ps = list(calendarOnCall(other, t).map((e) => e.personId))
    if (ps.length) return { ps, note: `текущая смена «${other.name}»` }
    return { ps: list([other.leadId]), note: `в «${other.name}» сейчас никого — зовём его лида` }
  }
  return c.escalation.map((s, i) => {
    acc += i === 0 ? 0 : s.delayMin
    const rules: EscRule[] = i === 0
      ? [{ target: 'oncall' }, ...s.targets.filter((r) => r.target !== 'oncall')]
      : s.targets.length ? s.targets : [{ target: 'oncall' }]
    const ps: Person[] = []
    const notes: string[] = []
    for (const r of rules) {
      const res = resolveRule(r, i === 0)
      ps.push(...res.ps)
      if (res.note) notes.push(rules.length > 1 ? `${ruleLabel(r, people, calendars)}: ${res.note}` : res.note)
    }
    const fresh: Person[] = []
    const already: { person: Person; level: number }[] = []
    for (const p of ps) {
      const lv = notified.get(p.id)
      if (lv) { if (lv !== i + 1 && !already.some((a) => a.person.id === p.id)) already.push({ person: p, level: lv }) }
      else { fresh.push(p); notified.set(p.id, i + 1) }
    }
    return {
      level: i + 1, delayMin: acc,
      label: rules.map((r) => ruleLabel(r, people, calendars)).join(' + '),
      target: rules[0].target, targets: rules, people: fresh, already, note: notes.join('; ') || undefined,
    }
  })
}

/** Длительность одного цикла: последний уровень + пауза, равная задержке второго уровня (или 5 мин). */
export function cycleMinutes(c: Calendar, chain: ChainLevel[]) {
  const last = chain[chain.length - 1]?.delayMin ?? 0
  return last + Math.max(1, c.escalation[1]?.delayMin ?? 5)
}
