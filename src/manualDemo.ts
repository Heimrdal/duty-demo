import { makeSlot, withSlots } from './engine'
import { atDay, dayNumber, weekdayTz } from './tz'
import type { Layer, ManualSlot } from './types'

/**
 * Демо-график для слоя «Ручной график»: день 08:00–20:00 и ночь 20:00–08:00,
 * с понедельника прошлой недели на `days` суток вперёд. `skip(day, night)` — какие смены оставить пустыми.
 */
export function demoManualSlots(now: number, tz: string, dayPeople: string[], nightPeople: string[], days = 17, skip: (d: number, night: boolean) => boolean = () => false): ManualSlot[] {
  const monday = dayNumber(now, tz) - weekdayTz(now, tz) - 7
  const out: ManualSlot[] = []
  for (let d = 0; d < days; d++) {
    const n = monday + d
    if (!skip(d, false)) out.push(makeSlot({ id: `ms-${n}-d`, personId: dayPeople[d % dayPeople.length], start: atDay(n, 8 * 60, tz), end: atDay(n, 20 * 60, tz) }))
    if (!skip(d, true)) out.push(makeSlot({ id: `ms-${n}-n`, personId: nightPeople[d % nightPeople.length], start: atDay(n, 20 * 60, tz), end: atDay(n + 1, 8 * 60, tz) }))
  }
  return out
}

export function demoManualLayer(base: Omit<Layer, 'participants' | 'slots' | 'mode'>, slots: ManualSlot[]): Layer {
  return withSlots({ ...base, mode: 'manual', participants: [] }, slots)
}
