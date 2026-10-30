/**
 * Большой демо-набор: ~300 команд и календарей, ~1500 сотрудников, 25 подразделений.
 * Генерация детерминированная: одинаковые seed и «сейчас» дают одинаковые данные.
 * Маленький набор (5 команд) входит в большой целиком, поэтому вход под теми же людьми работает в обоих.
 */
import { addDays, isoDate, startOfDay } from './engine'
import type { Calendar, EscStep, Layer, Person, Restriction } from './types'

export const LARGE_SEED = 20261030

/** Детерминированный генератор псевдослучайных чисел (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MALE = ['Александр', 'Алексей', 'Андрей', 'Антон', 'Артём', 'Борис', 'Вадим', 'Валерий', 'Василий', 'Виктор', 'Владимир', 'Владислав', 'Вячеслав', 'Геннадий', 'Георгий', 'Глеб', 'Денис', 'Дмитрий', 'Евгений', 'Егор', 'Иван', 'Игорь', 'Илья', 'Кирилл', 'Константин', 'Леонид', 'Максим', 'Марк', 'Михаил', 'Никита', 'Николай', 'Олег', 'Павел', 'Пётр', 'Роман', 'Руслан', 'Сергей', 'Станислав', 'Степан', 'Тимур', 'Фёдор', 'Юрий', 'Ярослав']
const FEMALE = ['Алина', 'Алла', 'Анастасия', 'Анна', 'Валентина', 'Валерия', 'Вера', 'Виктория', 'Галина', 'Дарья', 'Диана', 'Евгения', 'Екатерина', 'Елена', 'Елизавета', 'Жанна', 'Зоя', 'Инна', 'Ирина', 'Карина', 'Кристина', 'Ксения', 'Лариса', 'Любовь', 'Людмила', 'Маргарита', 'Марина', 'Мария', 'Надежда', 'Наталья', 'Нина', 'Оксана', 'Ольга', 'Полина', 'Светлана', 'София', 'Татьяна', 'Ульяна', 'Юлия', 'Яна']
const SURNAMES = ['Абрамов', 'Александров', 'Алексеев', 'Андреев', 'Антонов', 'Баранов', 'Белов', 'Беляев', 'Богданов', 'Борисов', 'Быков', 'Васильев', 'Виноградов', 'Власов', 'Волков', 'Воробьёв', 'Гаврилов', 'Галкин', 'Герасимов', 'Голубев', 'Гончаров', 'Горбунов', 'Григорьев', 'Гусев', 'Давыдов', 'Данилов', 'Дмитриев', 'Егоров', 'Ершов', 'Жуков', 'Журавлёв', 'Зайцев', 'Захаров', 'Зиновьев', 'Иванов', 'Ильин', 'Калинин', 'Карпов', 'Киселёв', 'Ковалёв', 'Козлов', 'Колесников', 'Комаров', 'Кондратьев', 'Королёв', 'Котов', 'Крылов', 'Кудрявцев', 'Кузьмин', 'Куликов', 'Лазарев', 'Лебедев', 'Левин', 'Макаров', 'Максимов', 'Медведев', 'Мельников', 'Миронов', 'Михайлов', 'Морозов', 'Назаров', 'Никитин', 'Николаев', 'Новиков', 'Орлов', 'Осипов', 'Павлов', 'Панов', 'Петров', 'Поляков', 'Пономарёв', 'Попов', 'Прохоров', 'Романов', 'Рябов', 'Савельев', 'Семёнов', 'Сергеев', 'Сидоров', 'Смирнов', 'Соболев', 'Соколов', 'Соловьёв', 'Степанов', 'Суворов', 'Тарасов', 'Тимофеев', 'Титов', 'Третьяков', 'Тихонов', 'Федоров', 'Филиппов', 'Фролов', 'Чернов', 'Шаров', 'Шестаков', 'Щербаков', 'Яковлев', 'Белозерский', 'Вишневский', 'Ковальчук', 'Шевченко', 'Черных', 'Седых', 'Толстой']

function femaleSurname(s: string) {
  if (/(ов|ев|ёв|ин|ын)$/.test(s)) return s + 'а'
  if (/ский$/.test(s)) return s.replace(/ский$/, 'ская')
  if (/цкий$/.test(s)) return s.replace(/цкий$/, 'цкая')
  if (/ой$/.test(s)) return s.replace(/ой$/, 'ая')
  return s
}

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
export const translit = (s: string) => [...s.toLowerCase()].map((ch) => TR[ch] ?? ch).join('')

/** 25 подразделений: 7 из маленького набора + 18 новых. tz — зона региональных центров. */
export const ORG_UNITS: { name: string; tz?: string }[] = [
  { name: 'Дирекция ИТ' }, { name: 'Ситуационный центр' }, { name: 'Мониторинг' }, { name: 'Разработка ДБО' },
  { name: 'Интернет-банк' }, { name: 'Платёжный шлюз' }, { name: 'СБП' },
  { name: 'Департамент розничных технологий' }, { name: 'Департамент корпоративных систем' }, { name: 'Управление карточного бизнеса' },
  { name: 'Управление кредитных систем' }, { name: 'Управление казначейских систем' }, { name: 'Департамент инфраструктуры' },
  { name: 'Управление сетей и связи' }, { name: 'Управление баз данных' }, { name: 'Платформа и DevOps' },
  { name: 'Департамент информационной безопасности' }, { name: 'Управление данных и отчётности' }, { name: 'Управление клиентских каналов' },
  { name: 'Управление платёжных систем' }, { name: 'Управление сопровождения АБС' }, { name: 'Управление интеграций' },
  { name: 'Региональный ИТ-центр (Екатеринбург)', tz: 'Asia/Yekaterinburg' }, { name: 'Региональный ИТ-центр (Новосибирск)', tz: 'Asia/Novosibirsk' },
  { name: 'Дальневосточный ИТ-центр', tz: 'Asia/Vladivostok' },
]

type Sys = [name: string, product: string, type: Calendar['type'], org: number]
/** Банковские системы: [короткое имя, продукт, тип, индекс подразделения] */
const SYSTEMS: Sys[] = [
  ['АБС ЦФТ', 'Автоматизированная банковская система ЦФТ-Банк', 'product', 20],
  ['Мобильный банк iOS', 'Мобильное приложение для физлиц, iOS', 'product', 18],
  ['Мобильный банк Android', 'Мобильное приложение для физлиц, Android', 'product', 18],
  ['Интернет-банк ЮЛ', 'Дистанционное обслуживание юрлиц', 'product', 8],
  ['Кредитный конвейер', 'Заявки, скоринг и выдача кредитов', 'product', 10],
  ['Скоринг', 'Модели оценки заёмщиков', 'product', 10],
  ['Ипотечный портал', 'Ипотека: заявки, сделки, электронная регистрация', 'product', 10],
  ['Автокредиты', 'Автокредитование и партнёрские дилеры', 'product', 10],
  ['Вклады', 'Депозиты и накопительные счета', 'product', 7],
  ['Брокерское обслуживание', 'Брокерский счёт и ИИС', 'product', 11],
  ['Валютный контроль', 'Валютный контроль ВЭД', 'product', 8],
  ['Казначейство Kondor+', 'Фронт-офис казначейства', 'product', 11],
  ['Эквайринг', 'Торговый и интернет-эквайринг', 'product', 9],
  ['Процессинг Way4', 'Карточный процессинг OpenWay Way4', 'product', 9],
  ['Токенизация карт', 'Mir Pay, токены и кошельки', 'product', 9],
  ['Антифрод', 'Фрод-мониторинг операций', 'product', 16],
  ['СБП C2B', 'Оплата по QR-коду через СБП', 'product', 19],
  ['Платёжный хаб', 'Маршрутизация платежей и переводов', 'product', 19],
  ['SWIFT-шлюз', 'Международные переводы', 'product', 19],
  ['Зарплатные проекты', 'Зарплатные реестры корпоративных клиентов', 'product', 8],
  ['Программа лояльности', 'Кешбэк, баллы и спецпредложения', 'product', 7],
  ['Контакт-центр Genesys', 'Телефония и маршрутизация обращений', 'product', 18],
  ['CRM розницы', 'Клиентская база и продажи в рознице', 'product', 7],
  ['CRM корпоративного блока', 'Продажи и сопровождение юрлиц', 'product', 8],
  ['Онбординг клиентов', 'Открытие счетов и KYC', 'product', 7],
  ['Биометрия ЕБС', 'Единая биометрическая система', 'product', 16],
  ['СМЭВ и Госуслуги', 'Интеграция с государственными сервисами', 'product', 21],
  ['Отчётность ЦБ', 'Обязательная отчётность в Банк России', 'product', 17],
  ['Хранилище данных DWH', 'Корпоративное хранилище данных', 'product', 17],
  ['BI-отчётность', 'Аналитические витрины и дашборды', 'product', 17],
  ['Банкоматная сеть', 'Банкоматы и терминалы самообслуживания', 'product', 9],
  ['Кассовое обслуживание', 'Кассы отделений', 'product', 20],
  ['Чат-бот', 'Виртуальный ассистент в приложении', 'product', 18],
  ['SMS и push-шлюз', 'Доставка уведомлений клиентам', 'product', 21],
  ['СЭД', 'Электронный документооборот', 'product', 8],
  ['Инвестиции', 'Инвестиционные продукты в приложении', 'product', 11],
  ['Страхование', 'Страховые продукты партнёров', 'product', 7],
  ['Взыскание', 'Работа с просроченной задолженностью', 'product', 10],
  ['Лимиты и риски', 'Лимиты, риск-метрики, ПОД/ФТ', 'product', 11],
  ['Комплаенс 115-ФЗ', 'Контроль операций по 115-ФЗ', 'product', 16],
  ['Kubernetes-платформа', 'Контейнерная платформа банка', 'infra', 15],
  ['Oracle', 'Кластеры Oracle и Exadata', 'infra', 14],
  ['PostgreSQL', 'Кластеры PostgreSQL и Patroni', 'infra', 14],
  ['Kafka', 'Шина событий Apache Kafka', 'infra', 21],
  ['Сеть ЦОД', 'Сетевое ядро центров обработки данных', 'infra', 13],
  ['Каналы связи филиалов', 'WAN и каналы отделений', 'infra', 13],
  ['Резервное копирование', 'Бэкапы и восстановление', 'infra', 12],
  ['Виртуализация', 'Кластеры виртуализации', 'infra', 12],
  ['Каталог LDAP', 'Учётные записи и группы (LDAP/AD)', 'infra', 12],
  ['Почта', 'Корпоративная почта и календари', 'infra', 12],
  ['PKI и HSM', 'Сертификаты, криптография, HSM', 'infra', 16],
  ['API-шлюз', 'Внешний и внутренний API-шлюз', 'infra', 21],
  ['CI/CD', 'Сборка и доставка релизов', 'infra', 15],
  ['Системы хранения', 'СХД и SAN', 'infra', 12],
  ['Межсетевые экраны', 'NGFW и политики доступа', 'infra', 13],
  ['Удалённый доступ', 'VPN и VDI сотрудников', 'infra', 13],
  ['APM', 'Мониторинг производительности приложений', 'monitoring', 2],
  ['Логи ELK', 'Сбор и поиск логов', 'monitoring', 2],
  ['SOC', 'Центр мониторинга информационной безопасности', 'monitoring', 16],
  ['NOC', 'Мониторинг сети', 'monitoring', 13],
  ['Синтетический мониторинг', 'Проверки клиентских сценариев', 'monitoring', 2],
  ['СЦ — региональная сеть', 'Ситуационный центр: отделения и регионы', 'sitcenter', 1],
  ['Региональная инфраструктура', 'Инфраструктура региональных офисов', 'infra', 22],
  ['Процессинг (резервный ЦОД)', 'Резервная площадка процессинга', 'infra', 23],
  ['Дальневосточные отделения', 'ИТ-поддержка отделений ДФО', 'infra', 24],
]
const ROLES = ['', ' — разработка', ' — сопровождение', ' — интеграции', ' — SRE', ' — L2', ' — релизы', ' — тестовые стенды', ' — DBA']
const TITLES: Record<Calendar['type'], string[]> = {
  product: ['Backend-разработчик', 'Java-разработчик', 'Frontend-разработчик', 'Инженер сопровождения', 'SRE', 'Аналитик', 'QA-инженер', 'Разработчик интеграций'],
  infra: ['Системный администратор', 'Сетевой инженер', 'DBA', 'Инженер платформы', 'DevOps-инженер', 'Инженер СХД'],
  monitoring: ['Инженер мониторинга', 'Аналитик SOC', 'Инженер NOC'],
  sitcenter: ['Дежурный инженер СЦ', 'Старший инженер СЦ'],
}
const NOTES = ['Подмена: отпуск', 'Подмена: больничный', 'Подмена: командировка', 'Подмена: обмен сменами']

export interface LargePart { people: Person[]; calendars: Calendar[] }

/**
 * Генерирует дополнительную часть большого набора (без 5 базовых календарей).
 * existing — сотрудники маленького набора: их id и имена не повторяются.
 */
export function makeLargePart(existing: Person[], now: number, seed = LARGE_SEED, teamCount = 295): LargePart {
  const r = rng(seed)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const names = new Set(existing.map((p) => p.name))
  const handles = new Set(existing.map((p) => p.telegram))
  const people: Person[] = []
  let seq = 0
  const person = (orgUnit: string, title: string, managerId: string | undefined, team?: string): Person => {
    let name = ''
    for (let i = 0; i < 20; i++) {
      const female = r() < 0.42
      const first = female ? pick(FEMALE) : pick(MALE)
      const sur = pick(SURNAMES)
      name = `${first} ${female ? femaleSurname(sur) : sur}`
      if (!names.has(name)) break
    }
    names.add(name)
    const [first, last] = name.split(' ')
    const base = `${translit(first[0])}_${translit(last)}`
    let tg = '@' + base
    for (let i = 2; handles.has(tg); i++) tg = `@${base}${i}`
    handles.add(tg)
    seq++
    const n = 2000 + seq
    const phone = `+7 9${String(10 + (seq % 89)).padStart(2, '0')} ${String(n % 1000).padStart(3, '0')}-${String(Math.floor(n / 10) % 100).padStart(2, '0')}-${String((seq * 37) % 100).padStart(2, '0')}`
    const p: Person = { id: `g-${seq}`, name, title, orgUnit, teams: team ? [team] : [], managerId, phone, telegram: tg, email: `${tg.slice(1).replace(/_/g, '.')}@bank.example` }
    people.push(p)
    return p
  }

  // Руководители подразделений (новых). Базовые подразделения уже возглавляют люди маленького набора.
  const heads = new Map<number, Person>()
  const baseHead: Record<number, string> = { 0: 'u-head', 1: 'u-sc-mgr', 2: 'u-mon-lead', 3: 'u-dev-mgr', 4: 'u-ib-lead', 5: 'u-pay-lead', 6: 'u-pay-lead' }
  ORG_UNITS.forEach((o, i) => {
    if (i < 7) return
    heads.set(i, person(o.name, `Руководитель: ${o.name}`, 'u-head'))
  })
  const headId = (i: number) => heads.get(i)?.id ?? baseHead[i]

  // Команды: система × роль. Порядок детерминированный.
  const teams: { name: string; sys: Sys }[] = []
  for (const sys of SYSTEMS) {
    const roles = [...ROLES]
    for (let k = roles.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [roles[k], roles[j]] = [roles[j], roles[k]] }
    roles.length = int(3, 6)
    for (const role of roles) teams.push({ name: sys[0] + role, sys })
  }
  const chosen = teams.slice(0, teamCount)

  const today = startOfDay(now, 'Europe/Moscow')
  const calendars: Calendar[] = []
  const all: Restriction = { type: 'none', from: '00:00', to: '00:00', days: [] }
  const esc = (id: string): EscStep[] => [
    { id: `${id}-e1`, target: 'oncall', delayMin: 0 }, { id: `${id}-e2`, target: 'next', delayMin: 5 },
    { id: `${id}-e3`, target: 'lead', delayMin: 10 }, { id: `${id}-e4`, target: 'manager', delayMin: 15 },
  ]
  const shared: Person[] = [] // инженеры, которые дежурят в нескольких командах

  chosen.forEach((t, i) => {
    const [, product, type, org] = t.sys
    const unit = ORG_UNITS[org]
    const tz = unit.tz ?? 'Europe/Moscow'
    const lead = person(unit.name, `Тимлид «${t.name}»`, headId(org), t.name)
    const members = [lead]
    const size = type === 'sitcenter' ? 5 : int(3, 5)
    for (let k = 0; k < size; k++) members.push(person(unit.name, pick(TITLES[type]), lead.id, t.name))
    // каждый десятый — с «чужим» инженером из другой команды
    if (shared.length && i % 10 === 3) {
      const extra = pick(shared)
      if (!extra.teams.includes(t.name)) { extra.teams.push(t.name); members.push(extra) }
    }
    shared.push(members[members.length - 1])

    const id = `cal-g${i + 1}`
    const tf = (n: number) => isoDate(addDays(today, -n, tz), tz)
    const start = tf(56 + int(0, 13))
    const handoff = pick(['09:00', '10:00', '10:00', '12:00'])
    const ids = members.map((m) => m.id)
    const engineers = ids.slice(1)
    const L = (lid: string, name: string, kind: Layer['kind'], unitR: 'day' | 'week', count: number, participants: string[], restriction: Restriction = all, parallel = 1, ho = handoff): Layer =>
      ({ id: `${id}-${lid}`, name, kind, startsAt: start, handoffTime: ho, rotation: { unit: unitR, count }, participants, parallel, restriction })
    const roll = r()
    let layers: Layer[]
    if (i % 97 === 50) layers = [] // календарь заведён, но ротации нет — дыра всегда
    else if (roll < 0.25) layers = [L('main', 'Основная ротация, по неделе', 'primary', 'week', 1, engineers)]
    else if (roll < 0.45) layers = [L('main', 'Сутки через трое', 'primary', 'day', 1, engineers.slice(0, 4))]
    else if (roll < 0.62) layers = [
      L('main', 'Основной, 2 недели', 'primary', 'week', 2, engineers),
      L('backup', 'Резерв — лид', 'secondary', 'week', 4, [lead.id]),
    ]
    else if (roll < 0.8) layers = [
      L('day', 'Рабочие часы', 'business', 'week', 1, engineers, { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] }, 1, '09:00'),
      L('night', 'Ночь', 'night', 'week', 1, [...engineers].reverse(), { type: 'daily', from: '18:00', to: '09:00', days: [] }, 1, '18:00'),
      // у части команд выходные днём не закрыты — это и есть «дыры за 7 дней»
      ...(r() < 0.7 ? [L('weekend', 'Выходные днём', 'secondary', 'week', 1, engineers, { type: 'weekly', from: '09:00', to: '18:00', days: [5, 6] }, 1, '09:00')] : []),
    ]
    else if (roll < 0.9) layers = [L('main', 'Только рабочие часы', 'business', 'day', 1, engineers, { type: 'weekly', from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] }, 1, '09:00')]
    else layers = [L('main', 'Пара дежурных, по неделе', 'primary', 'week', 1, engineers, all, 2)]

    const shifts: Calendar['shifts'] = []
    if (layers.length && r() < 0.15) {
      const l = layers[0]
      const from = addDays(today, int(-1, 4), tz)
      const replaced = l.participants[int(0, l.participants.length - 1)]
      const by = pick(ids.filter((x) => x !== replaced))
      shifts.push({ id: `${id}-s1`, personId: by, start: new Date(from).toISOString(), end: new Date(addDays(from, int(1, 3), tz)).toISOString(), replacesPersonId: replaced, note: pick(NOTES), createdAt: new Date(today).toISOString() })
    }

    calendars.push({
      id, name: t.name, product, type, team: t.name, orgUnit: unit.name,
      description: `Дежурство «${t.name}»: ${product.toLowerCase()}.`,
      ownerId: r() < 0.2 ? headId(org) : lead.id, leadId: lead.id, timezone: tz,
      layerMode: layers.length === 2 && layers[1].kind === 'secondary' ? 'priority' : 'parallel', repeat: 1,
      layers, shifts, escalation: esc(id),
    })
  })
  return { people, calendars }
}
