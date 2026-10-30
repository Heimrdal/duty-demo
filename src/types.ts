/** Тип дежурства слоя: только «Основной» и «Резерв». */
export type LayerKind = 'primary' | 'secondary'
export type RotationUnit = 'day' | 'week'
export type RestrictionType = 'none' | 'daily' | 'weekly'

export interface Person {
  id: string
  name: string
  title: string
  /** Подразделение по оргструктуре. Не меняется при работе с дежурствами. */
  orgUnit: string
  /** Дежурные команды, в которых участвует сотрудник. Их может быть несколько. */
  teams: string[]
  managerId?: string
  phone: string
  telegram: string
  email: string
}

export interface Restriction {
  type: RestrictionType
  from: string // HH:MM
  to: string // HH:MM
  days: number[] // 0=Пн..6=Вс (для weekly)
}

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  startsAt: string // ISO дата начала ротации (дата), время = handoffTime
  handoffTime: string // HH:MM
  rotation: { unit: RotationUnit; count: number }
  participants: string[]
  parallel: number // сколько человек дежурят одновременно в этом слое
  restriction: Restriction
  /** 'manual' — «Ручной график»: без ротации, дежурства расставляют по часам (slots). По умолчанию — ротация. */
  mode?: LayerMode
  slots?: ManualSlot[]
}

export type LayerMode = 'rotation' | 'manual'

/** Дежурство в слое с ручным графиком: кто и с какого по какое время (ISO). */
export interface ManualSlot {
  id: string
  personId: string
  start: string
  end: string
  note?: string
}

export interface Shift {
  id: string
  personId: string
  start: string
  end: string
  replacesPersonId?: string
  /** «Снять с дежурства»: этот человек не дежурит в интервале (personId пустой). Слот остаётся пустым, если никого не поставили. */
  removesPersonId?: string
  /** снятие только в этом слое; без layerId — во всех слоях календаря */
  layerId?: string
  note?: string
  createdAt: string
}

/** Кого звать на уровне эскалации. calendar — текущие дежурные другого календаря. */
export type EscTarget = 'oncall' | 'next' | 'lead' | 'manager' | 'person' | 'calendar'
export interface EscRule {
  target: EscTarget
  personId?: string
  calendarId?: string
}
export interface EscStep {
  id: string
  /** на уровне можно звать несколько целей сразу */
  targets: EscRule[]
  /** минут после предыдущего уровня (у первого — 0) */
  delayMin: number
}

export interface Calendar {
  id: string
  name: string
  product: string
  description: string
  team: string
  /** Подразделение, которому принадлежит календарь. Если не задано — подразделение лида. */
  orgUnit?: string
  ownerId: string
  leadId: string
  /** IANA-зона календаря: в ней считаются передачи смен, часы слоёв и дни недели. */
  timezone: string
  layerMode: 'parallel' | 'priority'
  layers: Layer[]
  shifts: Shift[]
  escalation: EscStep[]
  repeat: number
}

export interface NotifySettings {
  telegram: string
  chatLinked: boolean
  onShiftStart: boolean
  beforeShift: 'off' | '1h' | '1d'
  onHandover: boolean
  onEscalation: boolean
  quietHours: boolean
}

export type TgKind = 'shift_start' | 'reminder' | 'handover' | 'escalation' | 'test' | 'signup'
export interface TgMessage {
  id: string
  ts: string
  toPersonId: string
  kind: TgKind
  text: string
  calendarId?: string
  incidentId?: string
}

export type Dataset = 'small' | 'large'

export interface State {
  version: number
  /** Демо-набор: 6 команд или ~300 команд. По умолчанию small. */
  dataset?: Dataset
  currentUserId: string | null
  people: Person[]
  calendars: Calendar[]
  notify: Record<string, NotifySettings>
  messages: TgMessage[]
}

/** Пользовательский шаблон ротации (хранится в localStorage отдельно от данных). */
export interface RotationTemplate {
  id: string
  name: string
  kind: LayerKind
  rotation: { unit: RotationUnit; count: number }
  /** отдых между сменами, в тех же единицах: «сутки через трое» = 1 сут. дежурства, 3 сут. отдыха */
  offCount: number
  handoffTime: string
  parallel: number
  restriction: Restriction
}
