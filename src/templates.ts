import { defaultStartDate } from './engine'
import type { Layer, LayerKind, Restriction, RotationTemplate, RotationUnit } from './types'

export interface TemplateItem extends RotationTemplate { builtin: boolean }

const noneR = (): Restriction => ({ type: 'none', from: '00:00', to: '00:00', days: [] })
const T = (id: string, name: string, kind: LayerKind, unit: RotationUnit, count: number, offCount: number, handoffTime: string, restriction: Restriction): TemplateItem =>
  ({ id, name, kind, rotation: { unit, count }, offCount, handoffTime, parallel: 1, restriction, builtin: true })

export const BUILTIN_TEMPLATES: TemplateItem[] = [
  T('sutki', 'Сутки через трое', 'primary', 'day', 1, 3, '09:00', noneR()),
  T('dev-week', 'Неделя разработки', 'primary', 'week', 1, 0, '10:00', noneR()),
  T('two-two', '2/2 по 12 часов', 'primary', 'day', 2, 2, '09:00', { type: 'daily', from: '09:00', to: '21:00', days: [] }),
  T('weekends', 'Только выходные', 'primary', 'week', 1, 0, '00:00', { type: 'weekly', from: '00:00', to: '00:00', days: [5, 6] }),
  T('office', 'Рабочие часы 9-18', 'primary', 'week', 1, 0, '09:00', { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] }),
]

const unitWord = (u: RotationUnit, n: number) => {
  const m10 = n % 10, m100 = n % 100
  const one = m10 === 1 && m100 !== 11, few = m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
  return u === 'day' ? (one ? 'сутки' : 'суток') : one ? 'неделя' : few ? 'недели' : 'недель'
}
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Сколько человек нужно в очереди, чтобы ритм «N через M» вышел точно (движок — очередь по кругу). */
export function queueSize(t: Pick<RotationTemplate, 'rotation' | 'offCount' | 'parallel'>): number | null {
  if (!t.offCount) return null
  if (t.offCount % t.rotation.count) return null
  return Math.max(1, t.parallel) * (1 + t.offCount / t.rotation.count)
}

/** Строка-описание шаблона для списка. */
export function templateHint(t: RotationTemplate): string {
  const on = `${t.rotation.count} ${unitWord(t.rotation.unit, t.rotation.count)}`
  const parts = [t.offCount ? `${on} дежурства / ${t.offCount} ${unitWord(t.rotation.unit, t.offCount)} отдыха` : `смена ${on}`]
  const q = queueSize(t)
  if (q) parts.push(`очередь из ${q}`)
  parts.push(`передача в ${t.handoffTime}`)
  if (t.restriction.type === 'daily') parts.push(`${t.restriction.from}–${t.restriction.to}`)
  if (t.restriction.type === 'weekly') parts.push(`${t.restriction.days.map((d) => DAYS[d]).join(' ')}${t.restriction.from !== t.restriction.to ? ` ${t.restriction.from}–${t.restriction.to}` : ''}`)
  if (t.parallel > 1) parts.push(`${t.parallel} одновременно`)
  return parts.join(', ')
}

/** Поля слоя из шаблона. Старт — ближайшая передача смены (сегодня или завтра), а не начало недели. */
export function templatePatch(t: RotationTemplate, now: number, tz: string): Partial<Layer> {
  return {
    kind: t.kind, startsAt: defaultStartDate(t.handoffTime, now, tz), handoffTime: t.handoffTime,
    rotation: { ...t.rotation }, parallel: t.parallel,
    restriction: { ...t.restriction, days: [...t.restriction.days] },
  }
}

/** Встроенные шаблоны. Своих шаблонов нет: набор короткий и общий для всех календарей. */
export function allTemplates(): TemplateItem[] {
  return BUILTIN_TEMPLATES
}
