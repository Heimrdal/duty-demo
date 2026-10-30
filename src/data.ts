import { addDays, isoDate, startOfDay, uid } from './engine'
import { makeLargePart } from './bigdata'
import type { Calendar, Dataset, NotifySettings, Person, State, TgMessage } from './types'

const P = (id: string, name: string, title: string, orgUnit: string, managerId: string | undefined, tg: string, phone: string): Person => ({
  id, name, title, orgUnit, teams: [orgUnit], managerId, telegram: '@' + tg, phone, email: `${tg.replace(/_/g, '.')}@bank.example`,
})

export const PEOPLE: Person[] = [
  P('u-head', 'Ольга Смирнова', 'Директор по эксплуатации', 'Дирекция ИТ', undefined, 'o_smirnova', '+7 900 100-00-01'),
  P('u-sc-mgr', 'Андрей Волков', 'Руководитель ситуационного центра', 'Ситуационный центр', 'u-head', 'a_volkov', '+7 900 100-00-02'),
  P('u-sc1', 'Мария Козлова', 'Дежурный инженер СЦ', 'Ситуационный центр', 'u-sc-mgr', 'm_kozlova', '+7 900 100-00-03'),
  P('u-sc2', 'Игорь Павлов', 'Дежурный инженер СЦ', 'Ситуационный центр', 'u-sc-mgr', 'i_pavlov', '+7 900 100-00-04'),
  P('u-sc3', 'Елена Орлова', 'Старший инженер СЦ', 'Ситуационный центр', 'u-sc-mgr', 'e_orlova', '+7 900 100-00-05'),
  P('u-mon-lead', 'Дмитрий Соколов', 'Лид мониторинга', 'Мониторинг', 'u-sc-mgr', 'd_sokolov', '+7 900 100-00-06'),
  P('u-mon1', 'Сергей Новиков', 'Инженер мониторинга (Zabbix)', 'Мониторинг', 'u-mon-lead', 's_novikov', '+7 900 100-00-07'),
  P('u-mon2', 'Анна Лебедева', 'Инженер мониторинга', 'Мониторинг', 'u-mon-lead', 'a_lebedeva', '+7 900 100-00-08'),
  P('u-dev-mgr', 'Павел Морозов', 'Руководитель разработки ДБО', 'Разработка ДБО', 'u-head', 'p_morozov', '+7 900 100-00-09'),
  P('u-ib-lead', 'Алексей Кузнецов', 'Тимлид «Интернет-банк»', 'Интернет-банк', 'u-dev-mgr', 'a_kuznetsov', '+7 900 100-00-10'),
  P('u-ib1', 'Никита Попов', 'Backend-разработчик', 'Интернет-банк', 'u-ib-lead', 'n_popov', '+7 900 100-00-11'),
  P('u-ib2', 'Юлия Васильева', 'Frontend-разработчик', 'Интернет-банк', 'u-ib-lead', 'yu_vasilieva', '+7 900 100-00-12'),
  P('u-ib3', 'Артём Зайцев', 'SRE', 'Интернет-банк', 'u-ib-lead', 'a_zaitsev', '+7 900 100-00-13'),
  P('u-pay-lead', 'Виктория Федорова', 'Тимлид «Платёжный шлюз»', 'Платёжный шлюз', 'u-dev-mgr', 'v_fedorova', '+7 900 100-00-14'),
  P('u-pay1', 'Роман Михайлов', 'Java-разработчик', 'Платёжный шлюз', 'u-pay-lead', 'r_mikhailov', '+7 900 100-00-15'),
  P('u-pay2', 'Ксения Белова', 'Java-разработчик', 'Платёжный шлюз', 'u-pay-lead', 'k_belova', '+7 900 100-00-16'),
  P('u-sbp1', 'Глеб Тарасов', 'Разработчик СБП', 'СБП', 'u-pay-lead', 'g_tarasov', '+7 900 100-00-17'),
  P('u-sbp2', 'Олег Григорьев', 'Разработчик СБП', 'СБП', 'u-pay-lead', 'o_grigoriev', '+7 900 100-00-18'),
]

const TZ = 'Europe/Moscow'
const all = { type: 'none' as const, from: '00:00', to: '00:00', days: [] as number[] }
const defaultEsc = () => [
  { id: uid(), target: 'oncall' as const, delayMin: 0 },
  { id: uid(), target: 'next' as const, delayMin: 5 },
  { id: uid(), target: 'lead' as const, delayMin: 10 },
  { id: uid(), target: 'manager' as const, delayMin: 15 },
  { id: uid(), target: 'sitcenter' as const, delayMin: 20 },
]

/** Демо-календари. Даты считаются в зоне календаря (МСК), поэтому не зависят от часового пояса браузера. */
export function makeCalendars(now: number = Date.now()): Calendar[] {
  const today = startOfDay(now, TZ)
  const anchor = (daysAgo: number) => isoDate(addDays(today, -(daysAgo + 56), TZ), TZ) // ротации начались ~2 месяца назад
  return [
    {
      id: 'cal-sc', name: 'Ситуационный центр', product: 'Ситуационный центр банка', type: 'sitcenter', team: 'Ситуационный центр',
      description: 'Круглосуточная дежурная смена СЦ: первичная реакция на инциденты, координация, оповещение бизнеса.',
      ownerId: 'u-sc-mgr', leadId: 'u-sc3', timezone: 'Europe/Moscow', layerMode: 'parallel', repeat: 2,
      layers: [
        { id: 'l-sc-main', name: 'Сменный инженер 24×7', kind: 'primary', startsAt: anchor(9), handoffTime: '09:00', rotation: { unit: 'day', count: 1 }, participants: ['u-sc1', 'u-sc2', 'u-sc3'], parallel: 1, restriction: all },
        { id: 'l-sc-shadow', name: 'Старший смены (рабочие часы)', kind: 'business', startsAt: anchor(14), handoffTime: '09:00', rotation: { unit: 'week', count: 1 }, participants: ['u-sc3', 'u-sc-mgr'], parallel: 1, restriction: { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] } },
      ],
      shifts: [], escalation: [
        { id: uid(), target: 'oncall', delayMin: 0 }, { id: uid(), target: 'next', delayMin: 5 },
        { id: uid(), target: 'lead', delayMin: 10 }, { id: uid(), target: 'manager', delayMin: 15 },
      ],
    },
    {
      id: 'cal-mon', name: 'Мониторинг Zabbix', product: 'Zabbix / Grafana / алертинг', type: 'monitoring', team: 'Мониторинг',
      description: 'Дежурная служба мониторинга: доступность Zabbix, разбор шумных триггеров, эскалация в продуктовые команды.',
      ownerId: 'u-mon-lead', leadId: 'u-mon-lead', timezone: 'Europe/Moscow', layerMode: 'parallel', repeat: 1,
      layers: [
        { id: 'l-mon-day', name: 'Дневная смена', kind: 'business', startsAt: anchor(6), handoffTime: '09:00', rotation: { unit: 'day', count: 1 }, participants: ['u-mon1', 'u-mon2'], parallel: 1, restriction: { type: 'daily', from: '09:00', to: '21:00', days: [] } },
        { id: 'l-mon-night', name: 'Ночная смена', kind: 'night', startsAt: anchor(6), handoffTime: '21:00', rotation: { unit: 'week', count: 1 }, participants: ['u-mon2', 'u-mon1', 'u-mon-lead'], parallel: 1, restriction: { type: 'daily', from: '21:00', to: '09:00', days: [] } },
      ],
      shifts: [], escalation: defaultEsc(),
    },
    {
      id: 'cal-ib', name: 'Интернет-банк', product: 'Интернет-банк для физлиц (ДБО)', type: 'product', team: 'Интернет-банк',
      description: 'Продуктовое дежурство разработки: ночные релизы, деградации API, ошибки входа клиентов.',
      ownerId: 'u-ib-lead', leadId: 'u-ib-lead', timezone: 'Europe/Moscow', layerMode: 'parallel', repeat: 1,
      layers: [
        { id: 'l-ib-dev', name: 'Разработчики (3 параллельно, по суткам)', kind: 'primary', startsAt: anchor(3), handoffTime: '10:00', rotation: { unit: 'day', count: 1 }, participants: ['u-ib1', 'u-ib2', 'u-ib3', 'u-ib-lead', 'u-pay1', 'u-sbp1'], parallel: 3, restriction: all },
        { id: 'l-ib-sre', name: 'SRE-резерв (2 параллельно, по неделе)', kind: 'secondary', startsAt: anchor(10), handoffTime: '10:00', rotation: { unit: 'week', count: 1 }, participants: ['u-ib3', 'u-mon1', 'u-ib-lead', 'u-mon2'], parallel: 2, restriction: all },
      ],
      shifts: [], escalation: defaultEsc(),
    },
    {
      id: 'cal-pay', name: 'Платёжный шлюз', product: 'Процессинг карточных платежей', type: 'product', team: 'Платёжный шлюз',
      description: 'Разработка дежурит длинными сменами по 2 недели: процессинг, 3-D Secure, интеграции с МПС.',
      ownerId: 'u-pay-lead', leadId: 'u-pay-lead', timezone: 'Europe/Moscow', layerMode: 'priority', repeat: 2,
      layers: [
        { id: 'l-pay-main', name: 'Основной (2 недели)', kind: 'primary', startsAt: anchor(4), handoffTime: '12:00', rotation: { unit: 'week', count: 2 }, participants: ['u-pay1', 'u-pay2'], parallel: 1, restriction: all },
        { id: 'l-pay-backup', name: 'Резерв — лид', kind: 'secondary', startsAt: anchor(4), handoffTime: '12:00', rotation: { unit: 'week', count: 4 }, participants: ['u-pay-lead'], parallel: 1, restriction: all },
      ],
      shifts: [], escalation: defaultEsc(),
    },
    {
      id: 'cal-sbp', name: 'СБП', product: 'Система быстрых платежей', type: 'product', team: 'СБП',
      description: 'Дежурство по интеграции с НСПК: переводы по номеру телефона, QR-оплаты.',
      ownerId: 'u-sbp1', leadId: 'u-pay-lead', timezone: 'Europe/Moscow', layerMode: 'parallel', repeat: 1,
      layers: [
        { id: 'l-sbp-week', name: 'Недельная ротация', kind: 'primary', startsAt: anchor(2), handoffTime: '10:00', rotation: { unit: 'week', count: 1 }, participants: ['u-sbp1', 'u-sbp2'], parallel: 1, restriction: all },
        { id: 'l-sbp-weekend', name: 'Выходные — усиление', kind: 'night', startsAt: anchor(2), handoffTime: '10:00', rotation: { unit: 'week', count: 1 }, participants: ['u-pay2', 'u-ib1'], parallel: 1, restriction: { type: 'weekly', from: '00:00', to: '00:00', days: [5, 6] } },
      ],
      shifts: [
        { id: uid(), personId: 'u-pay1', start: new Date(addDays(today, 2, TZ)).toISOString(), end: new Date(addDays(today, 3, TZ)).toISOString(), replacesPersonId: 'u-sbp2', note: 'Подмена: Олег в отпуске', createdAt: new Date(now).toISOString() },
      ],
      escalation: defaultEsc(),
    },
  ]
}

export function makeNotify(people: Person[] = PEOPLE): Record<string, NotifySettings> {
  const r: Record<string, NotifySettings> = {}
  for (const p of people) r[p.id] = { telegram: p.telegram, chatLinked: p.id !== 'u-sbp2', onShiftStart: true, beforeShift: '1h', onHandover: true, onEscalation: true, quietHours: false }
  return r
}

export function makeMessages(now: number = Date.now()): TgMessage[] {
  const m = (minAgo: number, to: string, kind: TgMessage['kind'], text: string, calendarId?: string): TgMessage => ({ id: uid(), ts: new Date(now - minAgo * 60000).toISOString(), toPersonId: to, kind, text, calendarId })
  return [
    m(600, 'u-sc1', 'shift_start', '🟢 Началось ваше дежурство\nКалендарь: «Ситуационный центр»\nСлой: Сменный инженер 24×7\nДо: завтра 09:00 МСК', 'cal-sc'),
    m(240, 'u-ib-lead', 'escalation', '🚨 ЭСКАЛАЦИЯ (уровень 3 — лид группы)\nКалендарь: «Интернет-банк»\nИнцидент INC-48213: рост 5xx на /api/login\nДежурный не подтвердил за 15 мин.\n[Принять] [Эскалировать дальше]', 'cal-ib'),
    m(120, 'u-mon1', 'reminder', '⏰ Через 1 час начинается ваша смена\nКалендарь: «Мониторинг Zabbix», дневная смена 09:00–21:00', 'cal-mon'),
    m(30, 'u-pay2', 'handover', '🔁 Передача смены\n«Платёжный шлюз»: Роман Михайлов → Ксения Белова\nОткрытых инцидентов: 1 (INC-48190)', 'cal-pay'),
  ]
}

export const STATE_VERSION = 4

export function initialState(now: number = Date.now(), dataset: Dataset = 'small'): State {
  const people = PEOPLE.map((p) => ({ ...p, teams: [...p.teams] }))
  const calendars = makeCalendars(now)
  if (dataset === 'large') {
    const big = makeLargePart(people, now)
    people.push(...big.people)
    calendars.push(...big.calendars)
  }
  return { version: STATE_VERSION, dataset, currentUserId: null, people, calendars, notify: makeNotify(people), messages: makeMessages(now) }
}

type LegacyPerson = Omit<Person, 'orgUnit' | 'teams'> & { team?: string; orgUnit?: string; teams?: string[] }

/** Миграция сохранённого состояния: v3 → v4 (явная зона календаря, оргструктура отдельно от дежурных команд, уровень 1 — дежурные). */
export function migrateState(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as State & { version: number }
  if (s.version !== 3 && s.version !== STATE_VERSION) return null
  const people = (s.people as unknown as LegacyPerson[]).map(({ team, ...p }) => {
    const orgUnit = p.orgUnit ?? team ?? ''
    const teams = Array.isArray(p.teams) ? p.teams : orgUnit ? [orgUnit] : []
    // v3 переносила сотрудника в чужую команду. Исходное подразделение берём из справочника.
    const seed = PEOPLE.find((x) => x.id === p.id)
    const fixedOrg = s.version === 3 && seed ? seed.orgUnit : orgUnit
    const fixedTeams = [...new Set([...(s.version === 3 && seed ? [seed.orgUnit] : []), ...teams])]
    return { ...p, orgUnit: fixedOrg, teams: fixedTeams } as Person
  })
  const calendars = s.calendars.map((c) => {
    const escalation = c.escalation.length && c.escalation[0].target === 'oncall'
      ? c.escalation
      : [{ id: uid(), target: 'oncall' as const, delayMin: 0 }, ...c.escalation]
    // смены: старые записи без поля shifts/без personId приводим к валидному виду; снятия (removesPersonId) сохраняем
    const shifts = (Array.isArray(c.shifts) ? c.shifts : [])
      .filter((x) => x && x.start && x.end && (x.personId || x.removesPersonId))
      .map((x) => (x.removesPersonId ? { ...x, personId: '' } : x))
    return { ...c, timezone: c.timezone || 'Europe/Moscow', shifts, escalation: escalation.map((x, i) => (i === 0 ? { ...x, delayMin: 0 } : x)) }
  })
  return { ...s, version: STATE_VERSION, dataset: s.dataset ?? 'small', people, calendars }
}
