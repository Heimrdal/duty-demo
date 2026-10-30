/**
 * Время в часовом поясе календаря, а не браузера.
 * Все расчёты расписания идут через эти функции: абсолютный момент (ms UTC) + IANA-зона.
 */
export const DEFAULT_TZ = 'Europe/Moscow'
const DAY = 86_400_000

export const TZ_OPTIONS: { id: string; label: string }[] = [
  { id: 'Europe/Kaliningrad', label: 'Калининград' },
  { id: 'Europe/Moscow', label: 'Москва (МСК)' },
  { id: 'Europe/Samara', label: 'Самара' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург' },
  { id: 'Asia/Novosibirsk', label: 'Новосибирск' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск' },
  { id: 'Asia/Irkutsk', label: 'Иркутск' },
  { id: 'Asia/Vladivostok', label: 'Владивосток' },
  { id: 'Europe/Berlin', label: 'Берлин' },
  { id: 'UTC', label: 'UTC' },
]

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsFmt(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    fmtCache.set(tz, f)
  }
  return f
}

export interface ZParts { y: number; m: number; d: number; h: number; min: number; s: number }

/** Настенное время момента t в зоне tz. m — 1..12. */
export function zparts(t: number, tz: string): ZParts {
  const o: Record<string, number> = {}
  for (const p of partsFmt(tz).formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, min: o.minute, s: o.second }
}

/** Смещение зоны относительно UTC в момент t, мс. */
export function tzOffset(t: number, tz: string) {
  const p = zparts(t, tz)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s)
  return asUtc - Math.floor(t / 1000) * 1000
}

/** Настенное время в зоне → абсолютный момент. Для несуществующего (переход на летнее) берётся время после перехода. */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const wall = Date.UTC(y, m - 1, d, h, min)
  let t = wall - tzOffset(wall, tz)
  const off2 = tzOffset(t, tz)
  if (wall - off2 !== t) {
    const t2 = wall - off2
    // если и второй вариант не совпадает — время в «дыре» перехода, берём более позднее
    t = tzOffset(t2, tz) === off2 ? t2 : Math.max(t, t2)
  }
  return t
}

/** Номер суток (дни от 1970-01-01) для календарной даты в зоне. */
export function dayNumber(t: number, tz: string) {
  const p = zparts(t, tz)
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY)
}
export function dayNumberOfIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
export function isoOfDayNumber(n: number) {
  const x = new Date(n * DAY)
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}
/** Момент начала суток n (или заданного времени этих суток) в зоне. */
export function atDay(n: number, minutes: number, tz: string) {
  const x = new Date(n * DAY)
  return zonedTime(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), Math.floor(minutes / 60), minutes % 60, tz)
}

export function startOfDayTz(t: number, tz: string) {
  return atDay(dayNumber(t, tz), 0, tz)
}
/** Те же часы через n календарных суток (корректно при переходе на летнее время). */
export function addDaysTz(t: number, n: number, tz: string) {
  const p = zparts(t, tz)
  return atDay(dayNumber(t, tz) + n, p.h * 60 + p.min, tz)
}
/** 0 = Пн … 6 = Вс */
export function weekdayTz(t: number, tz: string) {
  return weekdayOfDayNumber(dayNumber(t, tz))
}
export function weekdayOfDayNumber(n: number) {
  return (((n + 3) % 7) + 7) % 7 // 1970-01-01 — четверг
}
export function isoDateTz(t: number, tz: string) {
  return isoOfDayNumber(dayNumber(t, tz))
}
export function minutesOfDayTz(t: number, tz: string) {
  const p = zparts(t, tz)
  return p.h * 60 + p.min
}
export function startOfMonthTz(t: number, offsetMonths: number, tz: string) {
  const p = zparts(t, tz)
  const total = p.y * 12 + (p.m - 1) + offsetMonths
  return zonedTime(Math.floor(total / 12), (total % 12) + 1, 1, 0, 0, tz)
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Значение для <input type="datetime-local"> в зоне календаря. */
export function toInputTz(t: number, tz: string) {
  const p = zparts(t, tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`
}
/** Разбор значения datetime-local как настенного времени зоны календаря. NaN, если пусто. */
export function fromInputTz(s: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (!m) return NaN
  return zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5], tz)
}

/** Короткая подпись зоны: «МСК» только для Москвы. */
export function tzLabel(tz: string = DEFAULT_TZ) {
  if (tz === 'Europe/Moscow') return 'МСК'
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC'
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(Date.now()).find((x) => x.type === 'timeZoneName')
    const city = TZ_OPTIONS.find((o) => o.id === tz)?.label
    const off = p?.value.replace('GMT', 'UTC') ?? tz
    return city ? `${city}, ${off}` : off
  } catch {
    return tz
  }
}
export function tzName(tz: string = DEFAULT_TZ) {
  const o = TZ_OPTIONS.find((x) => x.id === tz)
  return o ? `${o.label} · ${tz}` : tz
}

const ruCache = new Map<string, Intl.DateTimeFormat>()
export function fmtTz(t: number | string | Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts)
  let f = ruCache.get(key)
  if (!f) { f = new Intl.DateTimeFormat('ru-RU', { ...opts, timeZone: tz }); ruCache.set(key, f) }
  return f.format(new Date(t))
}
