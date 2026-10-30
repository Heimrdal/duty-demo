import { layerSlot, manualSlots, removedAt, sampleSegments, type Segment, type TSlot } from './engine'
import type { Calendar } from './types'

const REM = '|снят'
const SUB = '|подмена|'

export interface Lane { key: string; label: string; sub?: string; kind: string; segs: LaneSeg[]; final?: boolean; layerId?: string; manual?: boolean }
export type LaneSeg = Segment & { shiftId?: string; removed?: boolean; replaced?: string; slotId?: string }

/** Раскладка дежурств ручного слоя по строкам: пересекающиеся — на разных строках. */
export function packSlots(slots: TSlot[], min = 1): TSlot[][] {
  const rows: TSlot[][] = []
  for (const x of slots) {
    const row = rows.find((r) => r[r.length - 1].end <= x.start)
    if (row) row.push(x)
    else rows.push([x])
  }
  while (rows.length < min) rows.push([])
  return rows
}

/**
 * Дорожки слоёв календаря на [a, b): по одной на каждое место слоя.
 * Подмена встаёт на место заменяемого в его же дорожке; снятые — серые на своей дорожке.
 * Отдельная дорожка «Разовые дежурства» — только для настоящих разовых добавлений.
 */
export function layerLanes(c: Calendar, a: number, b: number, step: number, breaks: number[] = []): Lane[] {
  const tz = c.timezone
  const out: Lane[] = []
  const overrides = c.shifts.filter((x) => x.replacesPersonId && x.personId && !x.removesPersonId)
  // подмена встаёт на место заменяемого прямо в его дорожке (штриховка «подмена»);
  // снятые с дежурства остаются на своей дорожке, но серые и зачёркнутые
  const mark = (id: string, layerId: string, t: number) => {
    const ov = overrides.find((x) => x.replacesPersonId === id && t >= +new Date(x.start) && t < +new Date(x.end))
    if (ov) return ov.personId + SUB + ov.id
    return removedAt(c, id, layerId, t) ? id + REM : id
  }
  const unmark = (layerId: string) => (sg: Segment): LaneSeg => {
    const sub = sg.personId.indexOf(SUB)
    if (sub >= 0) {
      const shiftId = sg.personId.slice(sub + SUB.length)
      const replaced = c.shifts.find((x) => x.id === shiftId)?.replacesPersonId
      return { ...sg, personId: sg.personId.slice(0, sub), hatch: true, shiftId, replaced }
    }
    if (!sg.personId.endsWith(REM)) return sg
    const pid = sg.personId.slice(0, -REM.length)
    return { ...sg, personId: pid, removed: true, shiftId: removedAt(c, pid, layerId, sg.start + 1)?.id }
  }
  for (const l of c.layers) {
    if (l.mode === 'manual') {
      // ручной график: каждое дежурство — свой отрезок; пересекающиеся — на соседних строках
      const inWin = manualSlots(l).filter((x) => x.end > a && x.start < b)
      const rows = packSlots(inWin, Math.max(1, l.parallel))
      rows.forEach((row, i) => {
        const segs: LaneSeg[] = []
        for (const x of row) {
          const s0 = Math.max(a, x.start), s1 = Math.min(b, x.end)
          const br = [...breaks, s0, s1]
          for (const sg of sampleSegments(s0, s1, (t) => mark(x.personId, l.id, t), step, br)) segs.push({ ...unmark(l.id)(sg), slotId: x.id, extra: x.note })
        }
        out.push({ key: l.id + i, layerId: l.id, manual: true, label: i === 0 ? l.name : '', sub: rows.length > 1 ? `строка ${i + 1}` : undefined, kind: l.kind, segs })
      })
      continue
    }
    const k = Math.min(l.parallel, l.participants.length) || 1
    for (let i = 0; i < k; i++) {
      const segs = sampleSegments(a, b, (t) => {
        const id = layerSlot(l, t, i, tz)
        return id ? mark(id, l.id, t) : null
      }, step, breaks).map(unmark(l.id))
      out.push({ key: l.id + i, layerId: l.id, label: i === 0 ? l.name : '', sub: k > 1 ? `место ${i + 1} из ${k}` : undefined, kind: l.kind, segs })
    }
  }
  // отдельная строка — только настоящие разовые дежурства (и подмены человека, которого нет ни в одном слое)
  const own = c.shifts.filter((x) => !x.removesPersonId && x.personId && (!x.replacesPersonId || !c.layers.some((l) => l.participants.includes(x.replacesPersonId!))))
  const oneoffSegs = own.map((s) => ({ start: Math.max(a, +new Date(s.start)), end: Math.min(b, +new Date(s.end)), personId: s.personId, extra: s.note, hatch: !!s.replacesPersonId, shiftId: s.id })).filter((s) => s.end > s.start)
  if (oneoffSegs.length) out.push({ key: 'shifts', label: 'Разовые дежурства', kind: 'oneoff', segs: oneoffSegs })
  return out
}
